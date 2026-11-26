"""An expense gets its bitcoin cost right away, from Coinbase, instead of waiting for tomorrow's close."""

from datetime import date, datetime, timedelta, timezone
from app import price_sync
from app.db import SessionLocal
from app.models import ExpenseCost, PriceQuote, PriceSync
from app.prices import Reference
from conftest import new_account, transaction

NOW = datetime.now(timezone.utc)


def quote(value="80000.00", age=timedelta(seconds=30)):
    with SessionLocal() as db:
        db.merge(PriceQuote(source="Coinbase", usd_per_btc=value, observed_at=(NOW - age).isoformat(), fetched_at=NOW.isoformat()))
        db.commit()


class LiveCoinbase:
    name, method, batch_days = "Coinbase", "daily_close", 300
    quote_calls = 0

    def current(self):
        self.quote_calls += 1
        return Reference(NOW.date(), "50000.00", NOW.isoformat(), "spot")

    def history(self, start, end):
        return [Reference(start + timedelta(days=i), "40000.00", f"{start + timedelta(days=i + 1)}T00:00:00+00:00", self.method) for i in range((end - start).days + 1)]


def cost(entry_id):
    with SessionLocal() as db:
        return db.get(ExpenseCost, entry_id)


def test_an_expense_dated_today_is_priced_at_the_live_coinbase_quote(coinbase_owner):
    quote("80000.00")
    cash = new_account(coinbase_owner)
    entry = transaction(coinbase_owner, cash, amount="40.00", date=str(date.today()))["id"]
    saved = cost(entry)
    assert (saved.usd_per_btc, saved.source, saved.method, saved.bitcoin) == ("80000.00", "Coinbase", "spot", "50000")
    # It is the price on the day it was bought; a later quote never rewrites it.
    quote("90000.00")
    with SessionLocal() as db:
        assert db.get(ExpenseCost, entry).usd_per_btc == "80000.00"


def test_an_expense_saved_before_the_quote_arrives_is_priced_when_it_does(coinbase_owner, monkeypatch):
    cash = new_account(coinbase_owner)
    entry = transaction(coinbase_owner, cash, amount="25.00", date=str(date.today()))["id"]
    assert cost(entry) is None
    with SessionLocal() as db:
        assert db.get(PriceSync, "coinbase").quote_requested is True
    provider = LiveCoinbase()
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    price_sync.tick()
    assert provider.quote_calls == 1
    assert (cost(entry).usd_per_btc, cost(entry).method) == ("50000.00", "spot")


def test_a_backdated_expense_fetches_that_days_close(coinbase_owner, monkeypatch):
    provider = LiveCoinbase()
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    price_sync.tick()  # the first daily download, before any entry exists
    cash = new_account(coinbase_owner)
    day = date.today() - timedelta(days=20)
    entry = transaction(coinbase_owner, cash, amount="10.00", date=str(day))["id"]
    with SessionLocal() as db:
        assert db.get(PriceSync, "coinbase").start_day == str(day)
    while price_sync.tick():
        pass
    assert (cost(entry).usd_per_btc, cost(entry).method) == ("40000.00", "daily_close")


def test_manual_prices_never_reach_coinbase(owner, monkeypatch):
    provider = LiveCoinbase()
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    cash = new_account(owner)
    entry = transaction(owner, cash, date=str(date.today()))["id"]
    price_sync.tick()
    assert cost(entry) is None
    assert provider.quote_calls == 0
