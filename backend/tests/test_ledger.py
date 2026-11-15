import sqlite3
import pytest
from app.db import engine
from conftest import new_account, transaction, post, category


def test_income_expense_transfer_and_net_worth(owner):
    checking = new_account(owner)
    savings = new_account(owner, "Savings", amount="0", kind="savings")
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    transaction(owner, checking, "income", "500")
    transaction(owner, checking, "expense", "100")
    transaction(owner, checking, "transfer", "200", destination_id=savings)
    accounts = owner.get("/api/accounts").json()
    assert accounts[0]["balance"] == "1200.00"
    assert accounts[1]["balance"] == "200.00"
    post(owner, "/rates", {"day": "2026-01-31", "usd_per_btc": "100000"})
    report = owner.get("/api/reports?month=2026-01").json()
    assert report["income"] == "500000"
    assert report["expenses"] == "100000"
    assert report["savings_rate"] == "80.0"
    assert report["net_worth"] == "1400000"
    with sqlite3.connect(engine.url.database) as db:
        assert not list(db.execute("SELECT entry_id FROM postings GROUP BY entry_id HAVING SUM(amount_minor) != 0"))


def test_cross_currency_transfer_preserves_actual_received(owner):
    source = new_account(owner)
    target = new_account(owner, "Wallet", "BITCOIN", "0", "bitcoin_wallet")
    transaction(owner, source, "transfer", "100", destination_id=target, destination_amount="85000")
    accounts = owner.get("/api/accounts").json()
    assert accounts[0]["balance"] == "900.00"
    assert accounts[1]["balance"] == "85000"
    with sqlite3.connect(engine.url.database) as db:
        assert not list(
            db.execute(
                "SELECT p.entry_id,a.currency FROM postings p JOIN accounts a ON a.id=p.account_id GROUP BY p.entry_id,a.currency HAVING SUM(p.amount_minor) != 0"
            )
        )


def test_liabilities_and_principal_payment(owner):
    checking = new_account(owner)
    mortgage = new_account(owner, "Mortgage", "USD", "10000", "mortgage")
    transaction(owner, checking, "transfer", "100", destination_id=mortgage)
    rows = owner.get("/api/accounts").json()
    assert rows[0]["balance"] == "900.00"
    assert rows[1]["balance"] == "9900.00"
    post(owner, "/rates", {"day": "2026-01-31", "usd_per_btc": "100000"})
    report = owner.get("/api/reports?month=2026-01").json()
    assert report["net_worth"] == "-9000000"
    assert report["expenses"] == "0"


def test_snapshot_immutable_and_exact_date(owner):
    checking = new_account(owner)
    post(owner, "/rates", {"day": "2026-01-04", "usd_per_btc": "120000"})
    missing = transaction(owner, checking, amount="120")
    assert missing["bitcoin"] is None
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "120000"})
    known = transaction(owner, checking, amount="120")
    assert known["bitcoin"] == "100000"
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "240000"})
    rows = owner.get("/api/transactions").json()
    assert next(r for r in rows if r["id"] == known["id"])["bitcoin"] == "100000"
    derived = next(r for r in rows if r["id"] == missing["id"])
    assert derived["bitcoin"] == "50000"
    assert derived["conversion_basis"] == "dated_reference"
    assert derived["rate_snapshot"] is None  # Read-only fallback, not a saved snapshot.
    report = owner.get("/api/reports?month=2026-01").json()
    assert report["expenses"] == "150000"
    assert report["net_worth"] is None


def test_edit_and_delete_reverse_with_audit(owner):
    checking = new_account(owner)
    row = transaction(owner, checking, amount="20")
    result = owner.put(
        f"/api/transactions/{row['id']}",
        json={
            "date": "2026-01-05",
            "kind": "expense",
            "account_id": checking,
            "amount": "30",
            "category_id": category(owner, "expense"),
            "description": "Corrected",
        },
    )
    assert result.status_code == 200, result.text
    assert owner.get("/api/accounts").json()[0]["balance"] == "970.00"
    assert len(owner.get("/api/transactions").json()) == 1
    assert owner.delete(f"/api/transactions/{result.json()['id']}").status_code == 200
    assert owner.get("/api/accounts").json()[0]["balance"] == "1000.00"
    assert owner.get("/api/transactions").json() == []
    assert owner.delete(f"/api/transactions/{row['id']}").status_code == 422
    assert any(e["action"] == "transaction.replace" for e in owner.get("/api/audit").json())


def test_invalid_edit_rolls_back_reversal(owner):
    checking = new_account(owner)
    row = transaction(owner, checking)
    result = owner.put(
        f"/api/transactions/{row['id']}",
        json={
            "date": "2026-01-05",
            "kind": "expense",
            "account_id": checking,
            "amount": "0",
            "category_id": category(owner, "expense"),
            "description": "Invalid",
        },
    )
    assert result.status_code == 422
    assert len(owner.get("/api/transactions").json()) == 1
    assert owner.get("/api/accounts").json()[0]["balance"] == "988.00"


def test_database_guards(owner):
    new_account(owner)
    with sqlite3.connect(engine.url.database) as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE postings SET amount_minor=5")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE journal_entries SET description='tampered'")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE accounts SET currency='BITCOIN'")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("DELETE FROM audit_events")
        db.execute(
            "INSERT INTO journal_entries(date,kind,description,notes,account_id,amount_minor,status,created_at) VALUES('2026-01-01','adjustment','bad','',1,1,'draft','now')"
        )
        id = db.execute("SELECT MAX(id) FROM journal_entries").fetchone()[0]
        db.execute("INSERT INTO postings(entry_id,account_id,amount_minor) VALUES(?,1,10)", (id,))
        db.execute("INSERT INTO postings(entry_id,account_id,amount_minor) VALUES(?,2,-9)", (id,))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE journal_entries SET status='posted' WHERE id=?", (id,))


def test_budget_and_valuation_not_income(owner):
    checking = new_account(owner)
    cat = category(owner, "expense")
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    transaction(owner, checking, amount="100", category_id=cat)
    post(owner, "/budgets", {"month": "2026-01", "category_id": cat, "bitcoin": "200000"})
    budget = owner.get("/api/budgets?month=2026-01").json()[0]
    assert (budget["actual"], budget["remaining"], budget["percent"]) == ("100000", "100000", "50.0")
    asset = post(owner, "/assets", {"account_id": checking, "quantity": "1"})
    post(owner, f"/assets/{asset['id']}/valuations", {"date": "2026-01-31", "value": "2000"})
    post(owner, "/rates", {"day": "2026-01-31", "usd_per_btc": "100000"})
    report = owner.get("/api/reports?month=2026-01").json()
    assert report["net_worth"] == "2000000"
    assert report["income"] == "0"
    assert report["expenses"] == "100000"


def test_category_and_transfer_validation(owner):
    checking = new_account(owner)
    bad = {
        "date": "2026-01-05",
        "kind": "expense",
        "account_id": checking,
        "amount": "10",
        "description": "Bad category",
        "category_id": category(owner, "income"),
    }
    assert owner.post("/api/transactions", json=bad).status_code == 422
    bad.update(kind="transfer", category_id=None, destination_id=checking)
    assert owner.post("/api/transactions", json=bad).status_code == 422


def test_valued_history_cannot_be_silently_changed(owner):
    checking = new_account(owner)
    row = transaction(owner, checking, amount="20")
    asset = post(owner, "/assets", {"account_id": checking, "quantity": "1"})
    post(owner, f"/assets/{asset['id']}/valuations", {"date": "2026-01-31", "value": "2000"})
    assert owner.delete(f"/api/transactions/{row['id']}").status_code == 422
    response = owner.post(
        "/api/accounts/" + str(checking) + "/adjustments",
        json={"date": "2026-01-20", "amount": "10", "description": "Backdated adjustment"},
    )
    assert response.status_code == 422
    assert owner.get("/api/accounts").json()[0]["balance"] == "2000.00"


def test_future_entry_and_unequal_transfer_rejected(owner):
    source = new_account(owner)
    target = new_account(owner, "Other account", amount="0")
    response = owner.post(
        "/api/transactions",
        json={
            "date": "2099-01-01",
            "kind": "transfer",
            "account_id": source,
            "destination_id": target,
            "amount": "100",
            "description": "Future entry",
        },
    )
    assert response.status_code == 422
    response = owner.post(
        "/api/transactions",
        json={
            "date": "2026-01-05",
            "kind": "transfer",
            "account_id": source,
            "destination_id": target,
            "amount": "100",
            "destination_amount": "99",
            "description": "Mismatched amounts",
        },
    )
    assert response.status_code == 422
    assert owner.get("/api/accounts").json()[0]["balance"] == "1000.00"
