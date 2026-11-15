from datetime import date, timedelta
from sqlalchemy import select
from app.db import SessionLocal
from app.models import ConversionAttachment, JournalEntry, PriceQuote, User
from app.prices import utcnow
from conftest import new_account, post, transaction


def live_quote(value="100000", age=0):
    with SessionLocal() as db:
        user = db.scalar(select(User))
        user.preferences = '{"rate_source":"coinbase"}'
        db.merge(
            PriceQuote(
                source="Coinbase",
                usd_per_btc=value,
                observed_at=(utcnow() - timedelta(seconds=age)).isoformat(),
                fetched_at=utcnow().isoformat(),
            )
        )
        db.commit()


def test_cached_date_reference_fills_reporting_gap_without_editing_journal(owner):
    cash = new_account(owner)
    tx = transaction(owner, cash, amount="50")
    assert tx["rate_snapshot"] is None
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    summary = owner.get("/api/reports?month=2026-01").json()["dual"]["BITCOIN"]
    assert summary["expenses"] == "50000"
    assert summary["conversion_status"] == {"current_estimate": 0, "dated_reference": 1, "missing": 0}
    row = owner.get("/api/transactions").json()[0]
    assert row["bitcoin"] == "50000" and row["conversion_basis"] == "dated_reference"
    assert row["rate_snapshot"] is None
    with SessionLocal() as db:
        assert db.get(JournalEntry, tx["id"]).rate_snapshot is None
        assert db.get(ConversionAttachment, tx["id"]) is None


def test_today_uses_fresh_quote_for_totals_and_budgets_without_counting_native_amounts_as_estimates(owner):
    wallet = new_account(owner, "Wallet", "BITCOIN", "100000", "bitcoin_wallet")
    cash = new_account(owner)
    live_quote()
    tx = transaction(owner, wallet, "income", "25000", date=str(date.today()))
    transaction(owner, cash, "expense", "50", date=str(date.today()))
    report = owner.get("/api/reports").json()
    assert report["dual"]["USD"]["income"] == "25.00"
    assert report["dual"]["BITCOIN"]["expenses"] == "50000"
    assert report["dual"]["USD"]["conversion_status"]["current_estimate"] == 1
    assert report["dual"]["BITCOIN"]["conversion_status"]["current_estimate"] == 1
    row = next(r for r in owner.get("/api/transactions").json() if r["id"] == tx["id"])
    assert row["conversion_basis"] == "current_estimate" and row["rate_snapshot"] is None
    budget = owner.get(f"/api/budget-overview?month={str(date.today())[:7]}").json()[0]
    assert budget["spent_bitcoin"] == "50000" and budget["estimated"]
    live_quote("200000")
    assert owner.get("/api/reports").json()["dual"]["USD"]["income"] == "50.00"
    # Exports retain recorded snapshot provenance rather than silently exporting live estimates.
    journal = owner.get("/api/export/journal").json()
    assert next(r for r in journal if r["entry_id"] == tx["id"])["effective_rate"] is None


def test_missing_past_date_never_borrows_today_and_stale_today_quote_is_not_used(owner):
    cash = new_account(owner)
    transaction(owner, cash, amount="50")
    live_quote()
    past = owner.get("/api/reports?month=2026-01").json()["dual"]["BITCOIN"]
    assert past["expenses"] is None and past["conversion_status"]["missing"] == 1
    transaction(owner, cash, amount="10", date=str(date.today()))
    live_quote(age=900)
    assert owner.get("/api/reports").json()["dual"]["BITCOIN"]["expenses"] is None


def test_saved_rates_win_over_new_references_and_current_quotes(owner):
    cash = new_account(owner)
    post(owner, "/rates", {"day": str(date.today()), "usd_per_btc": "100000"})
    transaction(owner, cash, amount="50", date=str(date.today()))
    post(owner, "/rates", {"day": str(date.today()), "usd_per_btc": "200000"})
    live_quote("300000")
    report = owner.get("/api/reports").json()["dual"]["BITCOIN"]
    assert report["expenses"] == "50000"
    assert report["conversion_status"] == {"current_estimate": 0, "dated_reference": 0, "missing": 0}


def test_monthly_history_sums_transaction_date_conversions(owner):
    cash = new_account(owner)
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "250"})
    transaction(owner, cash, amount="75", date="2026-01-05")
    post(owner, "/rates", {"day": "2026-01-06", "usd_per_btc": "100000"})
    transaction(owner, cash, amount="75", date="2026-01-06")
    live_quote("200000")
    report = owner.get("/api/reports?month=2026-01&denomination=BITCOIN").json()
    assert report["dual"]["USD"]["expenses"] == "150.00"
    assert report["dual"]["BITCOIN"]["expenses"] == "30075000"
    assert report["expenses"] == "30075000"
    assert report["history"][-1]["expenses"] == "30075000"
