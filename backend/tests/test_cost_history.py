from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
import pytest
from app.db import SessionLocal
from app.models import JournalEntry
from conftest import new_account, post, transaction
from test_recurring_bills import bill_payload, create, pay


def rate(owner, day, value):
    return post(owner, "/rates", {"day": day, "usd_per_btc": value})


def test_cost_is_frozen_to_purchase_date_not_recording_date_or_later_rate(owner):
    account = new_account(owner)
    rate(owner, "2026-01-05", "100000")
    first = transaction(owner, account, amount="20", description="HBO")
    rate(owner, "2026-01-05", "200000")
    rate(owner, "2026-02-05", "110000")
    transaction(owner, account, amount="22", date="2026-02-05", description="HBO")
    result = owner.get("/api/expense-costs?search=HBO").json()
    assert [p["bitcoin"] for p in result["payments"]] == ["20000", "20000"]
    assert [p["usd"] for p in result["payments"]] == ["22.00", "20.00"]
    assert result["months"][0]["change_usd"] == "10.00"
    assert result["months"][0]["change_bitcoin"] == "0.00"
    import csv
    import io

    exported_csv = list(csv.DictReader(io.StringIO(owner.get("/api/export/csv").text)))
    assert next(p for p in exported_csv if p["id"] == str(first["id"]))["historical_bitcoin_equivalent"] == "20000"
    original = next(p for p in result["payments"] if p["id"] == first["id"])
    assert original["rate"] == "100000" and original["source"] == "Manual"
    assert original["quote_at"] == "2026-01-05"
    assert owner.get("/api/transactions").json()[-1]["purchase_cost"]["bitcoin"] == "20000"
    exported = owner.get("/api/export/journal").json()
    assert next(p for p in exported if p["entry_id"] == first["id"])["purchase_cost"]["bitcoin"] == "20000"


def test_missing_references_never_become_zero_and_fill_once_when_daily_rate_arrives(owner):
    account = new_account(owner)
    transaction(owner, account, amount="20")
    data = owner.get("/api/expense-costs").json()
    assert data["months"][0]["usd"] == "20.00"
    assert data["months"][0]["bitcoin"] is None
    assert data["months"][0]["missing_bitcoin"] == 1
    rate(owner, "2026-01-06", "90000")
    assert owner.get("/api/expense-costs").json()["payments"][0]["bitcoin"] is None
    rate(owner, "2026-01-05", "100000")
    assert owner.get("/api/expense-costs").json()["payments"][0]["bitcoin"] == "20000"
    rate(owner, "2026-01-05", "200000")
    assert owner.get("/api/expense-costs").json()["payments"][0]["bitcoin"] == "20000"
    with SessionLocal() as db:
        assert db.scalar(select(JournalEntry).where(JournalEntry.kind == "expense")).rate_snapshot is None
        with pytest.raises(IntegrityError):
            db.execute(text("UPDATE expense_costs SET bitcoin='1'"))
        db.rollback()


def test_bill_history_survives_rename_amount_change_account_change_and_correction(owner):
    account = new_account(owner)
    other = new_account(owner, "Prime", kind="credit_card")
    payload = bill_payload(owner, account, due="2026-01-05")
    payload["transaction"].update(description="HBO", amount="20")
    bill = create(owner, payload)
    rate(owner, "2026-01-05", "100000")
    assert pay(owner, bill, "20", "2026-01-05").status_code == 200
    payload["transaction"].update(description="HBO Max", amount="22", date="2026-02-05", account_id=other)
    bill = owner.put(f"/api/recurring-bills/{bill['id']}", json=payload).json()
    rate(owner, "2026-02-05", "110000")
    assert pay(owner, bill, "22", "2026-02-05").status_code == 200
    original = owner.get("/api/transactions").json()[0]
    rate(owner, "2026-02-05", "220000")
    corrected = owner.put(
        f"/api/transactions/{original['id']}",
        json={
            "date": "2026-02-05",
            "kind": "expense",
            "account_id": other,
            "category_id": bill["category_id"],
            "description": "HBO correction",
            "amount": "23",
        },
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["bitcoin"] == "20909"
    report = owner.get("/api/reports?month=2026-02").json()
    assert report["dual"]["BITCOIN"]["expenses"] == "20909"
    budget = owner.get("/api/budget-overview?month=2026-02").json()[0]
    assert budget["spent_bitcoin"] == "20909"
    data = owner.get(f"/api/expense-costs?bill_id={bill['id']}").json()
    assert len(data["payments"]) == 2
    assert data["payments"][0]["rate"] == "110000"
    assert data["payments"][0]["usd"] == "23.00"
    assert data["payments"][1]["usd"] == "20.00"
    assert owner.delete(f"/api/transactions/{corrected.json()['id']}").status_code == 200
    assert len(owner.get(f"/api/expense-costs?bill_id={bill['id']}").json()["payments"]) == 1


def test_monthly_totals_follow_category_search_and_exclude_transfers_and_income(owner):
    account = new_account(owner)
    transaction(owner, account, amount="30", description="Groceries")
    transaction(owner, account, amount="40", description="Groceries")
    transaction(owner, account, kind="income", amount="500", description="Groceries")
    data = owner.get("/api/expense-costs?search=groceries").json()
    assert data["months"][0]["usd"] == "70.00"
    assert data["months"][0]["payments"] == 2
    assert owner.get("/api/expense-costs?category_id=9999").json()["payments"] == []


def test_spot_quote_is_never_used_and_daily_sync_freezes_the_purchase_day(owner):
    from datetime import date
    from test_reporting_conversions import live_quote
    from app.prices import Coinbase, Reference, save_reference

    account = new_account(owner)
    live_quote("100000")
    transaction(owner, account, amount="20", date=str(date.today()))
    assert owner.get("/api/expense-costs").json()["payments"][0]["bitcoin"] is None
    with SessionLocal() as db:
        save_reference(
            db, Coinbase(), Reference(date.today(), "110000", str(date.today()) + "T23:59:59+00:00", "daily_close")
        )
        db.commit()
    row = owner.get("/api/expense-costs").json()["payments"][0]
    assert row["bitcoin"] == "18182"
    assert row["source"] == "Coinbase" and row["method"] == "daily_close"
    owner.put("/api/settings", json={"rate_source": "manual"})
    rate(owner, str(date.today()), "220000")
    assert owner.get("/api/expense-costs").json()["payments"][0] == row


def test_native_bitcoin_cost_is_known_even_when_dollar_reference_is_missing(owner):
    account = new_account(owner, "Wallet", "BITCOIN", "100000", "bitcoin_wallet")
    transaction(owner, account, amount="20000")
    data = owner.get("/api/expense-costs").json()
    assert data["months"][0]["bitcoin"] == "20000"
    assert data["months"][0]["usd"] is None
    rate(owner, "2026-01-05", "100000")
    data = owner.get("/api/expense-costs").json()
    assert data["months"][0]["usd"] == "20.00"


def test_corrections_preserve_late_cost_reference_but_changed_purchase_date_uses_its_own_rate(owner):
    account = new_account(owner)
    first = transaction(owner, account, amount="20")
    assert first["rate_snapshot"] is None
    rate(owner, "2026-01-05", "100000")
    rate(owner, "2026-01-05", "200000")
    payload = {
        "date": "2026-01-05",
        "kind": "expense",
        "account_id": account,
        "category_id": first["category_id"],
        "amount": "30",
        "description": "Corrected amount",
    }
    corrected = owner.put(f"/api/transactions/{first['id']}", json=payload)
    assert corrected.status_code == 200
    assert corrected.json()["bitcoin"] == corrected.json()["purchase_cost"]["bitcoin"] == "30000"
    assert corrected.json()["rate_snapshot"] == "100000"
    rate(owner, "2026-01-06", "300000")
    payload["date"] = "2026-01-06"
    moved = owner.put(f"/api/transactions/{corrected.json()['id']}", json=payload)
    assert moved.status_code == 200
    assert moved.json()["bitcoin"] == moved.json()["purchase_cost"]["bitcoin"] == "10000"
    assert moved.json()["purchase_cost"]["observed_at"] == "2026-01-06"
