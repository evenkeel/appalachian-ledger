from datetime import date, timedelta
from decimal import Decimal
import json

import httpx
from sqlalchemy import select
from app import investments
from app.db import SessionLocal
from app.models import Holding, JournalEntry, Portfolio, StockQuote
from app.prices import utcnow
from conftest import new_account, post, transaction


def quote(price="200", previous="180"):
    return {"price": price, "previous_close": previous, "observed_at": utcnow().isoformat()}


def expire():
    with SessionLocal() as db:
        old = (utcnow() - timedelta(minutes=5)).isoformat()
        for row in db.scalars(select(StockQuote)):
            row.fetched_at = old
        for row in db.scalars(select(Portfolio)):
            row.attempted_at = old
        db.commit()


def save(owner, account, shares="10.5", cash="100", cost="1500"):
    return owner.put(
        f"/api/accounts/{account}/holdings",
        json={"cash": cash, "holdings": [{"symbol": "mstr", "shares": shares, "cost_basis": cost}]},
    )


def test_shares_mark_equity_not_income_and_update_net_worth(owner, monkeypatch):
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote())
    account = new_account(owner, "MSTR", amount="1000", kind="brokerage")
    post(owner, "/rates", {"day": str(date.today()), "usd_per_btc": "100000"})
    response = save(owner, account)
    assert response.status_code == 200, response.text
    holding = response.json()["holdings"][0]
    assert holding["symbol"] == "MSTR"
    assert holding["value"] == "2100.00"
    assert holding["gain"] == "600.00"
    assert holding["gain_percent"] == "40.00"
    assert holding["day_change"] == "210.00"
    report = owner.get("/api/reports").json()
    assert report["dual"]["USD"]["net_worth"] == "2200.00"
    assert report["dual"]["BITCOIN"]["net_worth"] == "2200000"
    assert Decimal(report["income"]) == 0
    expire()
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote("220"))
    assert post(owner, "/investments/refresh", {})["changed"]
    account_row = owner.get("/api/accounts").json()[0]
    assert account_row["balance"] == "2410.00"
    assert account_row["portfolio"]["cash"] == "100.00"
    assert account_row["portfolio"]["holdings"][0]["gain"] == "810.00"
    with SessionLocal() as db:
        entry = db.scalar(select(JournalEntry).order_by(JournalEntry.id.desc()))
        assert entry.kind == "valuation"
    assert not post(owner, "/investments/refresh", {})["changed"]


def test_deposits_are_cash_and_quantity_edits_are_not_market_gains(owner, monkeypatch):
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote())
    account = new_account(owner, "MSTR", amount="0", kind="stock")
    checking = new_account(owner)
    assert save(owner, account, shares="10", cash="100").status_code == 200
    transaction(owner, checking, kind="transfer", amount="50", destination_id=account, date=str(date.today()))
    assert owner.get("/api/accounts").json()[0]["portfolio"]["cash"] == "150.00"
    assert save(owner, account, shares="11", cash="150").status_code == 200
    with SessionLocal() as db:
        entry = db.scalar(select(JournalEntry).order_by(JournalEntry.id.desc()))
        assert entry.kind == "adjustment" and entry.amount_minor == 20000
    assert owner.get("/api/accounts").json()[0]["balance"] == "2350.00"


def test_provider_failure_preserves_values_and_exposes_error(owner, monkeypatch):
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote())
    account = new_account(owner, "MSTR", kind="brokerage")
    assert save(owner, account).status_code == 200
    expire()

    def failure(symbol):
        raise ValueError("Quote unavailable for MSTR")

    monkeypatch.setattr(investments, "fetch_quote", failure)
    post(owner, "/investments/refresh", {})
    row = owner.get("/api/accounts").json()[0]
    assert row["balance"] == "2200.00"
    assert "unavailable" in row["portfolio"]["error"]
    assert row["portfolio"]["holdings"][0]["stale"]
    assert save(owner, account, shares="99").status_code == 422
    assert owner.get("/api/accounts").json()[0]["portfolio"]["holdings"][0]["shares"] == "10.5"


def test_positions_validation_cost_basis_and_removal(owner, monkeypatch):
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote())
    account = new_account(owner, "MSTR", kind="brokerage")
    for shares in ("0", "-1", "NaN", "1.123456789", "1000000001"):
        assert save(owner, account, shares=shares).status_code == 422
    assert save(owner, account, cost="-1").status_code == 422
    assert save(owner, account, cash="-1").status_code == 422
    assert save(owner, account, cost=None).status_code == 200
    assert owner.get("/api/accounts").json()[0]["portfolio"]["holdings"][0]["gain"] is None
    result = owner.put(f"/api/accounts/{account}/holdings", json={"cash": "2200", "holdings": []})
    assert result.status_code == 200
    assert result.json()["holdings"] == [] and result.json()["cash"] == "2200.00"
    with SessionLocal() as db:
        assert db.scalar(select(Holding)) is None


def test_multiple_holdings_and_duplicate_symbols(owner, monkeypatch):
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote("200" if symbol == "MSTR" else "50"))
    account = new_account(owner, "Brokerage", kind="brokerage")
    rows = [{"symbol": "MSTR", "shares": "2"}, {"symbol": "SPY", "shares": "1.25"}]
    response = owner.put(f"/api/accounts/{account}/holdings", json={"cash": "5", "holdings": rows})
    assert response.status_code == 200, response.text
    assert owner.get("/api/accounts").json()[0]["balance"] == "467.50"
    rows[1]["symbol"] = "mstr"
    assert owner.put(f"/api/accounts/{account}/holdings", json={"holdings": rows}).status_code == 422
    assert owner.get("/api/accounts").json()[0]["balance"] == "467.50"


def test_provider_parses_exact_prices_and_rejects_non_usd(monkeypatch):
    meta = {
        "currency": "USD",
        "symbol": "MSTR",
        "regularMarketPrice": "200.12345",
        "chartPreviousClose": "199.12",
        "regularMarketTime": int(utcnow().timestamp()),
    }

    def response(*args, **kwargs):
        return httpx.Response(
            200,
            text=json.dumps({"chart": {"result": [{"meta": meta}]}}),
            request=httpx.Request("GET", "https://example.test"),
        )

    monkeypatch.setattr(httpx, "get", response)
    assert investments.fetch_quote("MSTR")["price"] == "200.12345"
    assert investments.market_minor("0.125", "200.12345") == 2502
    meta["currency"] = "GBP"
    import pytest

    with pytest.raises(ValueError, match="Quote unavailable"):
        investments.fetch_quote("MSTR")


def test_income_reversals_mixed_currencies_and_fixed_lifestyle(owner):
    usd = new_account(owner)
    btc = new_account(owner, "Wallet", "BITCOIN", "0", "bitcoin_wallet")
    for day, rate in [
        ("2026-01-05", "100000"),
        ("2026-01-31", "100000"),
        ("2026-02-05", "200000"),
        ("2026-02-28", "200000"),
    ]:
        post(owner, "/rates", {"day": day, "usd_per_btc": rate})
    salary = transaction(owner, usd, "income", "1000")
    transaction(owner, btc, "income", "100000", date="2026-01-05")
    transaction(owner, usd, "expense", "100")
    transaction(owner, usd, "expense", "100", date="2026-02-05")
    transaction(owner, usd, "transfer", "10", destination_id=btc, destination_amount="10000")
    r = owner.get("/api/reports?month=2026-02&months=2").json()
    first, last = r["history"]
    assert first["dual"]["USD"]["income"] == "1100.00"
    assert first["dual"]["BITCOIN"]["income"] == "1100000"
    assert first["lifestyle"] == {"USD": "100.00", "BITCOIN": "100000"}
    assert last["lifestyle"] == {"USD": "100.00", "BITCOIN": "50000"}
    assert owner.delete(f"/api/transactions/{salary['id']}").status_code == 200
    r = owner.get("/api/reports?month=2026-01").json()
    assert r["dual"]["USD"]["income"] == "100.00"
    assert r["dual"]["USD"]["income_categories"][0]["value"] == "100.00"
    transaction(owner, usd, "income", "200", date="2026-01-06")
    r = owner.get("/api/reports?month=2026-01").json()
    assert r["dual"]["BITCOIN"]["income"] is None
    assert r["dual"]["USD"]["income"] == "300.00"


def test_each_position_retains_the_quote_used_for_its_balance(owner, monkeypatch):
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote("200"))
    first = new_account(owner, "First", kind="stock")
    second = new_account(owner, "Second", kind="stock")
    assert save(owner, first, shares="1").status_code == 200
    expire()
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote("250"))
    assert save(owner, second, shares="2").status_code == 200
    rows = owner.get("/api/accounts").json()
    old = rows[0]["portfolio"]["holdings"][0]
    new = rows[1]["portfolio"]["holdings"][0]
    assert old["price"] == "200" and old["value"] == "200.00"
    assert new["price"] == "250" and new["value"] == "500.00"


def test_share_tracking_protects_history_and_overrides_manual_valuation_path(owner, monkeypatch):
    monkeypatch.setattr(investments, "fetch_quote", lambda symbol: quote())
    account = new_account(owner, "MSTR", kind="brokerage")
    asset = post(owner, "/assets", {"account_id": account})["id"]
    post(owner, f"/assets/{asset}/valuations", {"date": str(date.today()), "value": "2000"})
    assert save(owner, account, shares="10").status_code == 200
    assert save(owner, account, shares="11").status_code == 200
    blocked = owner.post(f"/api/assets/{asset}/valuations", json={"date": str(date.today()), "value": "5000"})
    assert blocked.status_code == 422 and "shares" in blocked.json()["detail"]
    blocked = owner.post(
        f"/api/accounts/{account}/adjustments",
        json={"date": "2026-01-02", "amount": "100", "description": "Backdated adjustment"},
    )
    assert blocked.status_code == 422


def test_income_edit_restates_source_totals_without_double_counting(owner):
    account = new_account(owner)
    entry = transaction(owner, account, "income", "100")
    category = next(c for c in owner.get("/api/categories").json() if c["name"] == "Freelance")
    edited = owner.put(
        f"/api/transactions/{entry['id']}",
        json={
            "date": "2026-01-05",
            "account_id": account,
            "kind": "income",
            "amount": "250",
            "description": "Corrected payment",
            "category_id": category["id"],
        },
    )
    assert edited.status_code == 200
    summary = owner.get("/api/reports?month=2026-01").json()["dual"]["USD"]
    assert summary["income"] == "250.00"
    assert summary["income_categories"] == [{"name": "Freelance", "value": "250.00"}]
