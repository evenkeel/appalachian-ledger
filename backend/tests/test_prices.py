import sqlite3
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, func
from app import prices, price_sync
from app.accounting import current_rate, rate_for
from app.db import SessionLocal, engine
from app.models import ExchangeRate, PriceQuote, PriceSync, JournalEntry, Posting
from app.prices import Coinbase, Reference, RateUnavailable, save_reference
from app.models import ConversionAttachment
from conftest import new_account, post, transaction

HTTPX_CLIENT = httpx.Client
CLOCK = datetime(2026, 2, 3, 12, 0, tzinfo=timezone.utc)


def select_source(owner, automatic=False, source="coinbase"):
    response = owner.put("/api/settings", json={"rate_source": source, "automatic_prices": automatic})
    assert response.status_code == 200, response.text


def mock_http(monkeypatch, handler):
    client = HTTPX_CLIENT
    monkeypatch.setattr(prices.httpx, "Client", lambda **kw: client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(prices, "utcnow", lambda: CLOCK)
    monkeypatch.setattr(prices.time, "sleep", lambda _: None)


def test_current_quote_decimal_timestamp_and_staleness(monkeypatch):
    payload = {"price": "123456.789012345", "time": "2026-02-03T11:59:00Z"}
    mock_http(monkeypatch, lambda req: httpx.Response(200, json=payload))
    ref = Coinbase().current()
    assert ref.value == "123456.789012345"
    assert ref.observed_at == "2026-02-03T11:59:00+00:00"
    for invalid in ("2026-02-03T11:00:00Z", "2026-02-03T12:05:00Z", "2026-02-03T12:00:00"):
        payload["time"] = invalid
        with pytest.raises(RateUnavailable):
            Coinbase().current()
    payload.update(time="2026-02-03T12:00:00Z", price="NaN")
    with pytest.raises(RateUnavailable):
        Coinbase().current()


def test_candles_parse_exactly_sort_deduplicate_and_exclude_extra_days(monkeypatch):
    def handler(req):
        assert req.url.params["granularity"] == "86400"
        assert req.url.params["start"] == "2026-02-01T00:00:00+00:00"
        assert req.url.params["end"] == "2026-02-03T00:00:00+00:00"
        return httpx.Response(
            200,
            text="[[1770076800,100,130,105,120.123456789,2],"
            "[1769990400,100,130,105,121.123456789,2],"
            "[1769904000,100,130,105,122.123456789,2],"
            "[1769904000,100,130,105,122.123456789,2]]",
        )

    mock_http(monkeypatch, handler)
    refs = Coinbase().history(date(2026, 2, 1), date(2026, 2, 2))
    assert [str(r.day) for r in refs] == ["2026-02-01", "2026-02-02"]
    assert refs[0].value == "122.123456789"
    assert refs[0].observed_at == "2026-02-02T00:00:00+00:00"
    with pytest.raises(RateUnavailable):
        Coinbase().history(date(2026, 2, 3), date(2026, 2, 3))
    with pytest.raises(RateUnavailable):
        Coinbase().history(date(2025, 1, 1), date(2026, 2, 2))


@pytest.mark.parametrize(
    "payload",
    [
        [[1769904001, 100, 130, 105, 122, 2]],
        [[1769904000, 130, 100, 105, 122, 2]],
        [[1769904000, 100, 130, 105, 140, 2]],
        [[1769904000, 100, 130, 105, 122, 2], [1769904000, 100, 130, 105, 123, 2]],
        {"error": "not candles"},
    ],
)
def test_invalid_candles_rejected(monkeypatch, payload):
    mock_http(monkeypatch, lambda req: httpx.Response(200, json=payload))
    with pytest.raises(RateUnavailable):
        Coinbase().history(date(2026, 2, 1), date(2026, 2, 1))


def test_retry_is_bounded_and_missing_days_are_not_filled(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(429 if len(calls) < 3 else 200, text="[]", headers={"Retry-After": "0"})

    mock_http(monkeypatch, handler)
    assert Coinbase().history(date(2026, 2, 1), date(2026, 2, 2)) == []
    assert len(calls) == 3
    calls.clear()
    mock_http(monkeypatch, lambda req: calls.append(req) or httpx.Response(503))
    with pytest.raises(RateUnavailable):
        Coinbase().current()
    assert len(calls) == 3


class FakeCoinbase:
    name, method, batch_days = "Coinbase", "daily_close", 300
    history_calls = []
    quote_calls = 0
    fail = False

    def current(self):
        self.quote_calls += 1
        return Reference(CLOCK.date(), "120000.123456789", CLOCK.isoformat(), "spot")

    def history(self, start, end):
        self.history_calls.append((start, end))
        if self.fail:
            raise RateUnavailable("Provider is down")
        return [
            Reference(
                start + timedelta(days=i),
                "100000.123456789",
                str(start + timedelta(days=i + 1)) + "T00:00:00+00:00",
                self.method,
            )
            for i in range((end - start).days + 1)
        ]


def test_resumable_sync_separate_current_quotes_cache_and_retry(owner, monkeypatch):
    select_source(owner)
    provider = FakeCoinbase()
    provider.history_calls = []
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    monkeypatch.setattr(price_sync, "utcnow", lambda: CLOCK)
    post(owner, "/prices/history", {"start": "2025-01-01"})
    post(owner, "/prices/refresh", {})
    price_sync.tick(CLOCK)
    assert provider.quote_calls == 1
    assert provider.history_calls == [(date(2025, 1, 1), date(2025, 10, 27))]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(PriceQuote)) == 1
        assert db.scalar(select(func.count()).select_from(ExchangeRate)) == 300
        assert db.get(PriceSync, "coinbase").status == "pending"
    provider.fail = True
    price_sync.tick(CLOCK + timedelta(seconds=2))
    with SessionLocal() as db:
        assert db.get(PriceSync, "coinbase").status == "error"
        next_day = db.get(PriceSync, "coinbase").next_day
    price_sync.tick(CLOCK + timedelta(seconds=4))
    assert len(provider.history_calls) == 2  # Backoff, no busy retry.
    provider.fail = False
    price_sync.tick(CLOCK + timedelta(minutes=6))
    assert provider.history_calls[-1][0] == date.fromisoformat(next_day)
    status = owner.get("/api/prices/status").json()
    assert status["history"]["status"] == "complete"
    assert status["history"]["days_missing"] == 0
    assert status["history"]["days_saved"] == 398
    # A repeat backfill consumes no provider history calls for cached batches.
    post(owner, "/prices/history", {"start": "2025-01-01"})
    count = len(provider.history_calls)
    price_sync.tick(CLOCK + timedelta(minutes=7))
    price_sync.tick(CLOCK + timedelta(minutes=8))
    assert len(provider.history_calls) == count


def test_enabling_prices_restores_mixed_currency_net_worth_without_changing_balances(owner, monkeypatch):
    new_account(owner, "Wallet", "BITCOIN", "1250000", "bitcoin_wallet")
    new_account(owner, "Checking", amount="1000")
    new_account(owner, "Debt", amount="250.64", kind="credit_card")
    before = owner.get("/api/reports?month=2026-01").json()
    assert before["dual"]["USD"]["net_worth"] is None
    assert before["dual"]["BITCOIN"]["net_worth"] is None
    select_source(owner, automatic=True)
    monkeypatch.setattr(price_sync, "provider_for", lambda _: FakeCoinbase())
    monkeypatch.setattr(price_sync, "utcnow", lambda: CLOCK)
    price_sync.tick(CLOCK)
    after = owner.get("/api/reports?month=2026-01").json()
    assert after["dual"]["USD"]["net_worth"] is not None
    assert after["dual"]["BITCOIN"]["net_worth"] is not None
    assert not after["missing_rates"]
    assert [(a["id"], a["balance_minor"]) for a in after["accounts"]] == [
        (a["id"], a["balance_minor"]) for a in before["accounts"]
    ]


def test_automatic_schedule_offline_and_quote_age(owner, monkeypatch):
    provider = FakeCoinbase()
    provider.history_calls = []
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    monkeypatch.setattr("app.accounting.utcnow", lambda: CLOCK)
    assert price_sync.tick(CLOCK) is False  # Manual prices perform no HTTP.
    assert provider.quote_calls == 0
    select_source(owner, automatic=True)
    price_sync.tick(CLOCK)
    price_sync.tick(CLOCK + timedelta(minutes=4))
    assert provider.quote_calls == 1
    with SessionLocal() as db:
        assert current_rate(db).usd_per_btc == "120000.123456789"
        assert rate_for(db, CLOCK.date()) is None  # Spot quote is not a historical rate.
        assert db.get(PriceSync, "coinbase").status == "complete"
    monkeypatch.setattr("app.accounting.utcnow", lambda: CLOCK + timedelta(minutes=11))
    with SessionLocal() as db:
        assert current_rate(db) is None
    select_source(owner, source="manual")
    price_sync.tick(CLOCK + timedelta(hours=1))
    assert provider.quote_calls == 1


def test_a_new_owner_starts_on_automatic_coinbase_prices(coinbase_owner, monkeypatch):
    provider = FakeCoinbase()
    provider.history_calls = []
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    monkeypatch.setattr("app.accounting.utcnow", lambda: CLOCK)
    preferences = coinbase_owner.get("/api/settings").json()["preferences"]
    assert preferences["rate_source"] == "coinbase"
    assert preferences["automatic_prices"] is True
    # No setup step: the first tick fetches a quote and the checklist does not ask for a source.
    price_sync.tick(CLOCK)
    assert provider.quote_calls == 1
    assert coinbase_owner.get("/api/dashboard").json()["setup"]["has_price_source"] is True


def test_review_conversions_is_audited_and_does_not_edit_journals(owner):
    checking = new_account(owner)
    entry = transaction(owner, checking, amount="10")
    select_source(owner)
    with SessionLocal() as db:
        rate = save_reference(
            db, Coinbase(), Reference(date(2026, 1, 5), "100000", "2026-01-06T00:00:00+00:00", "daily_close")
        )
        rate_id = rate.id
        db.commit()
    before = owner.get("/api/accounts").json()[0]["balance"]
    preview = owner.get("/api/prices/conversions").json()
    assert len(preview["items"]) == 1
    assert preview["items"][0]["bitcoin"] == "10000"
    payload = {"items": [{"entry_id": entry["id"], "rate_id": rate_id}]}
    assert post(owner, "/prices/conversions", payload) == {"attached": 1}
    assert post(owner, "/prices/conversions", payload) == {"attached": 0}
    result = owner.get("/api/transactions").json()[0]
    assert result["bitcoin"] == "10000"
    assert result["original_rate_snapshot"] is None
    assert result["conversion_attachment_rate_id"] == rate_id
    assert owner.get("/api/accounts").json()[0]["balance"] == before
    report = owner.get("/api/reports?month=2026-01").json()
    assert report["expenses"] == "10000"
    assert any(a["action"] == "conversion.attach" for a in owner.get("/api/audit").json())
    with SessionLocal() as db:
        assert db.get(JournalEntry, entry["id"]).rate_snapshot is None
        assert db.scalar(select(func.sum(Posting.amount_minor)).where(Posting.entry_id == entry["id"])) == 0
    with sqlite3.connect(engine.url.database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            db.execute("DELETE FROM conversion_attachments")
    assert owner.delete(f"/api/transactions/{entry['id']}").status_code == 200
    assert owner.get("/api/reports?month=2026-01").json()["expenses"] == "0"


def test_existing_fictional_and_manual_snapshots_preserved_and_review_cannot_overwrite(owner):
    checking = new_account(owner)
    with SessionLocal() as db:
        db.add(ExchangeRate(day="2026-01-05", usd_per_btc="50000", source="Fictional demo rate"))
        db.commit()
    entry = transaction(owner, checking, amount="10")
    select_source(owner)
    with SessionLocal() as db:
        rate = save_reference(
            db, Coinbase(), Reference(date(2026, 1, 5), "100000", "2026-01-06T00:00:00+00:00", "daily_close")
        )
        rate_id = rate.id
        db.commit()
    assert owner.get("/api/transactions").json()[0]["bitcoin"] == "20000"
    assert owner.get("/api/prices/conversions").json()["items"] == []
    assert (
        owner.post(
            "/api/prices/conversions", json={"items": [{"entry_id": entry["id"], "rate_id": rate_id}]}
        ).status_code
        == 422
    )
    assert owner.get("/api/transactions").json()[0]["rate_snapshot"] == "50000"


def test_review_rejects_newer_manual_override_and_reversed_entries(owner):
    checking = new_account(owner)
    entry = transaction(owner, checking)
    rate = post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    payload = {"items": [{"entry_id": entry["id"], "rate_id": rate["id"]}]}
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "120000"})
    assert owner.post("/api/prices/conversions", json=payload).status_code == 422
    owner.delete(f"/api/transactions/{entry['id']}")
    assert owner.get("/api/prices/conversions").json()["items"] == []


def test_price_routes_require_authentication_and_csrf(client, owner):
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as anonymous:
        for path in ("/prices/status", "/prices/conversions"):
            assert anonymous.get("/api" + path).status_code == 401
    select_source(owner)
    token = owner.headers.pop("X-CSRF-Token")
    assert owner.post("/api/prices/history", json={}).status_code == 403
    owner.headers["X-CSRF-Token"] = token
    assert owner.post("/api/prices/history", json={"start": "2099-01-01"}).status_code == 422


def test_sync_reports_gaps_without_using_another_source(owner, monkeypatch):
    select_source(owner)
    provider = FakeCoinbase()
    monkeypatch.setattr(provider, "history", lambda start, end: [])
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    monkeypatch.setattr(price_sync, "utcnow", lambda: CLOCK)
    with SessionLocal() as db:
        db.add(ExchangeRate(day="2026-02-02", usd_per_btc="99999", source="CoinGecko", method="midnight"))
        db.commit()
    post(owner, "/prices/history", {"start": "2026-02-02"})
    price_sync.tick(CLOCK)
    result = owner.get("/api/prices/status").json()
    assert result["history"]["status"] == "complete"
    assert result["history"]["days_missing"] == 1
    with SessionLocal() as db:
        assert rate_for(db, "2026-02-02") is None


def test_encrypted_backup_restores_price_provenance_and_attachments(owner):
    checking = new_account(owner)
    entry = transaction(owner, checking, amount="10")
    rate = post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    post(owner, "/prices/conversions", {"items": [{"entry_id": entry["id"], "rate_id": rate["id"]}]})
    with SessionLocal() as db:
        db.add(
            PriceQuote(
                source="Coinbase", usd_per_btc="120000.123", observed_at=CLOCK.isoformat(), fetched_at=CLOCK.isoformat()
            )
        )
        db.commit()
    phrase = "price-backup-passphrase"
    backup = owner.post("/api/backup", json={"passphrase": phrase})
    assert backup.status_code == 200
    result = owner.post(
        "/api/restore", data={"passphrase": phrase}, files={"file": ("prices.albackup", backup.content)}
    )
    assert result.status_code == 200, result.text
    with SessionLocal() as db:
        assert db.get(ConversionAttachment, entry["id"]).rate_id == rate["id"]
        assert db.get(JournalEntry, entry["id"]).rate_snapshot is None
        assert db.get(ExchangeRate, rate["id"]).method == "manual"
        assert db.get(PriceQuote, "Coinbase").usd_per_btc == "120000.123"


def test_restore_invalidates_inflight_provider_result(owner, monkeypatch):
    select_source(owner)
    provider = FakeCoinbase()

    def history(start, end):
        price_sync.invalidate_inflight()
        return [Reference(start, "100000", str(start) + "T00:00:00+00:00", "daily_close")]

    monkeypatch.setattr(provider, "history", history)
    monkeypatch.setattr(price_sync, "provider_for", lambda _: provider)
    monkeypatch.setattr(price_sync, "utcnow", lambda: CLOCK)
    post(owner, "/prices/history", {"start": "2026-02-02"})
    price_sync.tick(CLOCK)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ExchangeRate)) == 0
