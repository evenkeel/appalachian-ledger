"""Regressions for defects found in the November 15, 2026 audit."""

from datetime import date
from conftest import new_account, post, transaction


def upload(client, account, body):
    return client.post(
        "/api/import/csv", data={"account_id": account}, files={"file": ("transactions.csv", body, "text/csv")}
    )


def test_csv_malformed_rows_are_rejected_not_crashed(owner):
    checking = new_account(owner)
    header = b"date,kind,amount,description,category\n"
    short = upload(owner, checking, header + b"2026-01-05,expense,12.00,Coffee\n")
    assert short.status_code == 422, short.text
    assert "row 2" in short.text
    extra = upload(owner, checking, header + b"2026-01-05,expense,12.00,Coffee,Dining,surplus,cells\n")
    assert extra.status_code == 422, extra.text
    assert owner.get("/api/transactions").json() == []


def test_csv_kind_is_trimmed_and_case_insensitive(owner):
    checking = new_account(owner)
    body = b"date,kind,amount,description,category\n2026-01-05, Expense ,12.00,Coffee,Dining\n"
    assert upload(owner, checking, body).json() == {"imported": 1, "duplicates": 0}


def test_csv_rows_deleted_after_import_can_be_imported_again(owner):
    checking = new_account(owner)
    body = b"date,kind,amount,description,category\n2026-01-05,expense,12.00,Coffee,Dining\n"
    assert upload(owner, checking, body).json() == {"imported": 1, "duplicates": 0}
    (entry,) = owner.get("/api/transactions").json()
    assert owner.delete(f"/api/transactions/{entry['id']}").status_code == 200
    assert upload(owner, checking, body).json() == {"imported": 1, "duplicates": 0}
    assert upload(owner, checking, body).json() == {"imported": 0, "duplicates": 1}
    assert len(owner.get("/api/transactions").json()) == 1


def test_deleting_a_category_clears_its_payment_default(owner):
    checking = new_account(owner)
    created = post(owner, "/categories", {"name": "Hobbies", "kind": "expense"})
    saved = owner.put(
        "/api/settings/payment-defaults", json={"category_payment_defaults": {str(created["id"]): checking}}
    )
    assert saved.status_code == 200, saved.text
    assert owner.delete(f"/api/categories/{created['id']}").status_code == 200
    preferences = owner.get("/api/settings").json()["preferences"]
    assert preferences.get("category_payment_defaults", {}) == {}
    again = owner.put("/api/settings/payment-defaults", json={"category_payment_defaults": {}})
    assert again.status_code == 200, again.text


def test_successful_logins_do_not_count_toward_the_throttle(client):
    credentials = {"username": "owner", "password": "correct-horse-battery-staple"}
    assert client.post("/api/auth/setup", json=credentials).status_code == 200
    for _ in range(12):
        assert client.post("/api/auth/login", json=credentials).status_code == 200


def test_a_bill_whose_payment_was_deleted_can_be_recorded_again(owner):
    checking = new_account(owner)
    category = next(c["id"] for c in owner.get("/api/categories").json() if c["kind"] == "expense")
    tx = {
        "date": "2026-01-05",
        "kind": "expense",
        "account_id": checking,
        "amount": "40.00",
        "description": "Internet",
        "category_id": category,
    }
    bill = post(owner, "/recurring-bills", {"transaction": tx, "frequency": "monthly", "record_now": False})
    recorded = post(
        owner,
        f"/recurring-bills/{bill['id']}/record",
        {"due_date": "2026-01-05", "date": "2026-01-05", "amount": "400.00"},
    )
    assert owner.delete(f"/api/transactions/{recorded['entry_id']}").status_code == 200
    moved = owner.put(
        f"/api/recurring-bills/{bill['id']}", json={"transaction": tx, "frequency": "monthly", "record_now": False}
    )
    assert moved.status_code == 200, moved.text
    again = post(
        owner,
        f"/recurring-bills/{bill['id']}/record",
        {"due_date": "2026-01-05", "date": "2026-01-05", "amount": "40.00"},
    )
    assert not again.get("already_recorded")
    (payment,) = [t for t in owner.get("/api/transactions").json() if t["kind"] == "expense"]
    assert payment["amount"] == "40.00"


def test_demo_classifies_spending_plans_bills_and_leaves_accounts_usable(owner):
    assert owner.post("/api/demo").status_code == 200
    today = date.today().isoformat()
    accounts = {a["name"]: a for a in owner.get("/api/accounts").json()}
    transfer = owner.post(
        "/api/transactions",
        json={
            "date": today,
            "kind": "transfer",
            "account_id": accounts["Everyday checking"]["id"],
            "destination_id": accounts["Long-term brokerage"]["id"],
            "amount": "25.00",
            "description": "Extra contribution",
        },
    )
    assert transfer.status_code == 200, transfer.text
    types = {c["name"]: c["spending_type"] for c in owner.get("/api/categories").json() if c["kind"] == "expense"}
    assert types["Housing"] == "fixed" and types["Dining"] == "discretionary"
    bills = owner.get("/api/recurring-bills").json()
    assert len(bills) == 8
    assert all(bill["next_due"] > today for bill in bills)


def test_starting_position_never_reports_negative_cash(owner):
    checking = new_account(owner, amount="10")
    transaction(owner, checking, amount="60.00")
    position = owner.get("/api/planning/starting-position")
    assert position.status_code == 200, position.text
    assert position.json()["cash_usd"] == "0.00"
