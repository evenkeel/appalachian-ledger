"""Single-worker, resumable price synchronization. Never hold the ledger lock during HTTP."""

import json
import logging
import os
import threading
from datetime import date, timedelta
from sqlalchemy import func, select
from .db import SessionLocal, write_lock
from .models import ExchangeRate, JournalEntry, PriceQuote, PriceSync, User
from .prices import parse_time, provider_for, save_reference, utcnow, validate_current, RateUnavailable
from .accounting import DEFAULT_AUTOMATIC_PRICES, DEFAULT_RATE_SOURCE, audit
from .costs import capture, unpriced_today

log = logging.getLogger(__name__)
_epoch = 0


def invalidate_inflight():
    global _epoch
    _epoch += 1


def preferences(db):
    user = db.scalar(select(User))
    return json.loads(user.preferences) if user else {}


def sync_state(db, source):
    state = db.get(PriceSync, source)
    if state is None:
        state = PriceSync(source=source)
        db.add(state)
        db.flush()
    return state


def queue_history(db, source, start=None, clock=None):
    clock = clock or utcnow()
    start = start or date.fromisoformat(db.scalar(select(func.min(JournalEntry.date))) or str(clock.date()))
    start = max(start, date(2009, 1, 1))
    end = clock.date() - timedelta(days=1)
    if start > end:
        start = end
    state = sync_state(db, source)
    if state.status in ("pending", "running"):
        return state
    state.start_day, state.end_day, state.next_day = str(start), str(end), str(start)
    state.status, state.error, state.history_attempt_at = "pending", None, None
    state.scheduled_day = str(clock.date())
    state.generation += 1
    audit(db, "prices.history_queued", source, {"start": str(start), "end": str(end)})
    return state


def quote_payload(quote, clock=None):
    if quote is None:
        return None
    clock = clock or utcnow()
    age = (clock - parse_time(quote.observed_at)).total_seconds()
    return {
        "source": quote.source,
        "usd_per_btc": quote.usd_per_btc,
        "observed_at": quote.observed_at,
        "fetched_at": quote.fetched_at,
        "stale": age > 600 or age < -60,
    }


def price_status(db):
    prefs = preferences(db)
    source = prefs.get("rate_source", DEFAULT_RATE_SOURCE)
    if source == "manual":
        return {"source": source, "automatic": False, "quote": None, "history": None}
    provider = provider_for(source)
    state = db.get(PriceSync, source)
    history = None
    if state:
        count = db.scalar(
            select(func.count(func.distinct(ExchangeRate.day))).where(
                ExchangeRate.source == provider.name,
                ExchangeRate.method == provider.method,
                ExchangeRate.day >= (state.start_day or "9999"),
                ExchangeRate.day <= (state.end_day or "0000"),
            )
        )
        expected = (
            (date.fromisoformat(state.end_day) - date.fromisoformat(state.start_day)).days + 1 if state.start_day else 0
        )
        history = {
            "status": state.status,
            "start": state.start_day,
            "end": state.end_day,
            "next": state.next_day,
            "days_saved": count,
            "days_missing": max(0, expected - count),
            "error": state.error,
            "quote_error": state.quote_error,
            "last_success_at": state.last_success_at,
        }
    return {
        "source": source,
        "automatic": prefs.get("automatic_prices", DEFAULT_AUTOMATIC_PRICES),
        "quote": quote_payload(db.get(PriceQuote, provider.name)),
        "history": history,
    }


def seconds_since(stamp, clock):
    return (clock - parse_time(stamp)).total_seconds() if stamp else float("inf")


def tick(clock=None):
    """One quote and at most one historical batch. All external requests happen unlocked."""
    clock = clock or utcnow()
    epoch = _epoch
    with write_lock, SessionLocal() as db:
        prefs = preferences(db)
        source = prefs.get("rate_source", DEFAULT_RATE_SOURCE)
        if source == "manual":
            return False
        provider = provider_for(source)
        state = sync_state(db, source)
        automatic = prefs.get("automatic_prices", DEFAULT_AUTOMATIC_PRICES)
        if automatic and state.scheduled_day != str(clock.date()) and state.status not in ("pending", "running"):
            queue_history(db, source, clock=clock)
        quote_due = state.quote_requested or (automatic and seconds_since(state.quote_attempt_at, clock) >= 300)
        if quote_due:
            state.quote_attempt_at = clock.isoformat()
            state.quote_requested = False
        batch = None
        if state.status in ("pending", "running", "error") and seconds_since(state.history_attempt_at, clock) >= (
            300 if state.status == "error" else 1
        ):
            start = date.fromisoformat(state.next_day)
            end = min(start + timedelta(days=provider.batch_days - 1), date.fromisoformat(state.end_day))
            outside_coverage = source == "coingecko" and start < clock.date() - timedelta(days=365)
            if outside_coverage:
                end = min(clock.date() - timedelta(days=366), date.fromisoformat(state.end_day))
            # Skip already verified days; retries/resumes never redownload completed batches.
            cached = set(
                db.scalars(
                    select(ExchangeRate.day).where(
                        ExchangeRate.source == provider.name,
                        ExchangeRate.method == provider.method,
                        ExchangeRate.day >= str(start),
                        ExchangeRate.day <= str(end),
                    )
                )
            )
            batch = (start, end, outside_coverage or len(cached) == (end - start).days + 1, state.generation)
            state.status, state.history_attempt_at = "running", clock.isoformat()
        db.commit()
    if quote_due:
        try:
            ref = provider.current()
            validate_current(ref.value, ref.observed_at, clock)
            with write_lock, SessionLocal() as db:
                if epoch != _epoch or preferences(db).get("rate_source", DEFAULT_RATE_SOURCE) != source:
                    return False
                db.merge(
                    PriceQuote(
                        source=provider.name,
                        usd_per_btc=ref.value,
                        observed_at=ref.observed_at,
                        fetched_at=clock.isoformat(),
                    )
                )
                state = sync_state(db, source)
                state.quote_error, state.last_success_at = None, clock.isoformat()
                db.flush()
                # Expenses saved today before this quote arrived are priced with it now.
                for entry_id in unpriced_today(db):
                    capture(db, entry_id=entry_id)
                db.commit()
        except RateUnavailable as exc:
            with write_lock, SessionLocal() as db:
                if epoch == _epoch:
                    sync_state(db, source).quote_error = str(exc)
                    db.commit()
    if batch:
        start, end, cached, generation = batch
        try:
            refs = [] if cached else provider.history(start, end)
            with write_lock, SessionLocal() as db:
                state = db.get(PriceSync, source)
                # A settings change, restore, or replacement job invalidates an in-flight batch.
                if (
                    epoch != _epoch
                    or preferences(db).get("rate_source", DEFAULT_RATE_SOURCE) != source
                    or not state
                    or state.generation != generation
                    or state.status != "running"
                ):
                    return False
                for ref in refs:
                    save_reference(db, provider, ref)
                state.next_day = str(end + timedelta(days=1))
                state.error = None
                state.last_success_at = clock.isoformat()
                state.status = "complete" if state.next_day > state.end_day else "pending"
                if state.status == "complete":
                    audit(db, "prices.history_synced", source, {"start": state.start_day, "end": state.end_day})
                db.commit()
        except RateUnavailable as exc:
            with write_lock, SessionLocal() as db:
                state = db.get(PriceSync, source)
                if epoch == _epoch and state and state.generation == generation and state.status == "running":
                    state.status, state.error = "error", str(exc)
                    db.commit()
    return batch is not None


class PriceWorker:
    def __init__(self):
        self.stop = threading.Event()
        self.thread = None

    def run(self):
        while not self.stop.is_set():
            delay = 15
            try:
                if tick():
                    delay = 2
            except Exception:
                log.exception("Price sync failed; ledger remains available")
            self.stop.wait(delay)

    def start(self):
        if os.getenv("PRICE_WORKER_ENABLED", "true").lower() == "true":
            self.thread = threading.Thread(target=self.run, name="ledger-prices", daemon=True)
            self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=45)
