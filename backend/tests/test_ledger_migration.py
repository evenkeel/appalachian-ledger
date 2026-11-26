"""An existing ledger must come through the dashboard migration with nothing lost."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import engine
from app.main import app
from app.startup import ensure_schema
from conftest import category, new_account, post, transaction

# Every table that existed before 0014, with the columns it had then.
LEDGER_TABLES = {
    "users": "id, username, password_hash, preferences, demo, created_at",
    "accounts": "*",
    "categories": "*",
    "journal_entries": "*",
    "postings": "*",
    "exchange_rates": "*",
    "price_quotes": "*",
    "conversion_attachments": "*",
    "expense_costs": "*",
    "assets": "*",
    "asset_prices": "*",
    "budgets": "*",
    "recurring_bills": "id, account_id, category_id, description, notes, amount, frequency, next_due, anchor_day, anchor_month, archived",
    "bill_occurrences": "*",
    "planning_scenarios": "*",
    "savings_goals": "*",
    "entry_reviews": "*",
    "import_jobs": "*",
    "portfolios": "*",
    "holdings": "*",
    "wallet_connections": "*",
}


def ledger_rows():
    with engine.connect() as connection:
        return {
            table: [tuple(row) for row in connection.execute(text(f"SELECT {columns} FROM {table} ORDER BY 1, 2"))]
            for table, columns in LEDGER_TABLES.items()
        }


def rewind_to_0013():
    """Reproduce a ledger from before the dashboard migration without touching its records."""
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE income_schedules"))
        connection.execute(text("DROP TABLE card_terms"))
        connection.execute(text("DROP TABLE alert_acknowledgements"))
        connection.execute(text("DROP TABLE alert_settings"))
        connection.execute(text("ALTER TABLE recurring_bills DROP COLUMN pays_account_id"))
        connection.execute(text("ALTER TABLE recurring_bills DROP COLUMN destroyed_on"))
        connection.execute(text("UPDATE alembic_version SET version_num='0013_goals_and_reviews'"))
    engine.dispose()


def test_an_existing_ledger_migrates_with_nothing_lost(owner):
    # Six fictional months, then the awkward cases: a recorded bill payment (which is what
    # makes a table rebuild fail), a correction, a deletion, bitcoin spending and a missing price.
    assert owner.post("/api/demo?months=6").status_code == 200
    today = date.today().isoformat()
    checking = next(a["id"] for a in owner.get("/api/accounts").json() if a["kind"] == "checking")
    bill = post(
        owner,
        "/recurring-bills",
        {
            "frequency": "monthly",
            "record_now": True,
            "transaction": {
                "date": today,
                "kind": "expense",
                "account_id": checking,
                "category_id": category(owner, "expense"),
                "amount": "41.25",
                "description": "Paid before the upgrade",
            },
        },
    )
    edited = transaction(owner, checking, amount="19.99", date=today)["id"]
    assert (
        owner.put(
            f"/api/transactions/{edited}",
            json={
                "date": today,
                "kind": "expense",
                "account_id": checking,
                "category_id": category(owner, "expense"),
                "amount": "21.49",
                "description": "Corrected",
            },
        ).status_code
        == 200
    )
    deleted = transaction(owner, checking, amount="5.00", date=today)["id"]
    assert owner.delete(f"/api/transactions/{deleted}").status_code == 200
    unpriced = new_account(owner, name="No price yet", amount="300")
    transaction(owner, unpriced, amount="7.00", date="2019-03-04", description="Before any saved price")

    journal_before = owner.get("/api/export/journal").text
    balances_before = {a["id"]: a["balance"] for a in owner.get("/api/accounts").json()}
    rewind_to_0013()
    rows_before = ledger_rows()
    assert rows_before["bill_occurrences"], "the test needs a recorded bill payment"
    assert any(row[-1] is not None for row in rows_before["journal_entries"]) or rows_before["postings"]

    ensure_schema()

    assert ledger_rows() == rows_before
    with engine.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0016_people"
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        assert connection.execute(text("PRAGMA integrity_check")).scalar() == "ok"
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(recurring_bills)"))}
        assert {"pays_account_id", "destroyed_on"} <= columns
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM recurring_bills WHERE pays_account_id IS NOT NULL OR destroyed_on IS NOT NULL"
                )
            ).scalar()
            == 0
        )

    with TestClient(app) as restarted:
        restarted.cookies = owner.cookies
        restarted.headers["X-CSRF-Token"] = owner.headers["X-CSRF-Token"]
        assert restarted.get("/api/export/journal").text == journal_before
        assert {a["id"]: a["balance"] for a in restarted.get("/api/accounts").json()} == balances_before
        assert any(row["id"] == bill["id"] for row in restarted.get("/api/recurring-bills").json())
        dashboard = restarted.get("/api/dashboard")
        assert dashboard.status_code == 200, dashboard.text
        assert dashboard.json()["bills"]["paid_this_month"]["count"] >= 1


def test_the_journal_is_still_sealed_after_migrating(owner):
    account = new_account(owner)
    transaction(owner, account, amount="25")
    rewind_to_0013()
    ensure_schema()
    with engine.begin() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(text("UPDATE postings SET amount_minor = amount_minor + 1"))
    with engine.begin() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(text("DELETE FROM journal_entries"))
    with engine.begin() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(text("UPDATE journal_entries SET description = 'edited' WHERE status = 'posted'"))


# ---------- Restoring a backup made by an older version ----------

PASSPHRASE = "a-long-test-passphrase"


def old_backup():
    """An encrypted backup of the ledger as it stands, taken while it is still on the 0013 schema."""
    from app.backup import snapshot
    from app.db import SessionLocal

    with SessionLocal() as db:
        return snapshot(db, PASSPHRASE)


def sign_in(client):
    result = client.post("/api/auth/login", json={"username": "owner", "password": "correct-horse-battery-staple"})
    assert result.status_code == 200, result.text
    client.headers["X-CSRF-Token"] = result.json()["csrf"]


def restore(client, content):
    return client.post(
        "/api/restore",
        data={"passphrase": PASSPHRASE},
        files={"file": ("ledger.albackup", content, "application/octet-stream")},
    )


def test_a_backup_from_before_the_dashboard_restores_with_nothing_lost(owner):
    assert owner.post("/api/demo?months=6").status_code == 200
    today = date.today().isoformat()
    checking = next(a["id"] for a in owner.get("/api/accounts").json() if a["kind"] == "checking")
    post(
        owner,
        "/recurring-bills",
        {
            "frequency": "monthly",
            "record_now": True,
            "transaction": {
                "date": today,
                "kind": "expense",
                "account_id": checking,
                "category_id": category(owner, "expense"),
                "amount": "41.25",
                "description": "Paid before the backup",
            },
        },
    )
    journal_before = owner.get("/api/export/journal").text
    balances_before = {a["id"]: a["balance"] for a in owner.get("/api/accounts").json()}

    rewind_to_0013()
    rows_before = ledger_rows()
    backup = old_backup()
    ensure_schema()

    # The ledger moves on after the backup, so a restore visibly replaces it.
    with TestClient(app) as client:
        sign_in(client)
        transaction(client, checking, amount="333.33", date=today, description="After the backup")
        assert client.get("/api/export/journal").text != journal_before

        restored = restore(client, backup)
        assert restored.status_code == 200, restored.text

        sign_in(client)
        assert client.get("/api/export/journal").text == journal_before
        assert {a["id"]: a["balance"] for a in client.get("/api/accounts").json()} == balances_before
        dashboard = client.get("/api/dashboard")
        assert dashboard.status_code == 200, dashboard.text
        assert dashboard.json()["bills"]["paid_this_month"]["count"] >= 1

    # Every record the old version held is there, untouched, on the current schema.
    assert ledger_rows() == rows_before
    with engine.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0016_people"
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        assert connection.execute(text("PRAGMA integrity_check")).scalar() == "ok"
        assert connection.execute(text("SELECT COUNT(*) FROM income_schedules")).scalar() == 0
    with engine.begin() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(text("UPDATE postings SET amount_minor = amount_minor + 1"))


def test_a_backup_from_a_newer_version_is_refused_and_changes_nothing(owner):
    account = new_account(owner)
    transaction(owner, account, amount="25")
    with engine.begin() as connection:
        connection.execute(text("UPDATE alembic_version SET version_num='9999_from_the_future'"))
    backup = old_backup()
    with engine.begin() as connection:
        connection.execute(text("UPDATE alembic_version SET version_num='0014_dashboard'"))
    engine.dispose()
    transaction(owner, account, amount="7.77", description="Kept")
    journal = owner.get("/api/export/journal").text

    refused = restore(owner, backup)
    assert refused.status_code == 422
    assert "newer version" in refused.json()["detail"]
    assert owner.get("/api/export/journal").text == journal


def test_an_old_backup_that_does_not_upgrade_cleanly_is_refused_and_changes_nothing(owner):
    account = new_account(owner)
    transaction(owner, account, amount="25")
    rewind_to_0013()
    # After upgrading, the backup must match this version's schema exactly; anything else stays out.
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE stray (id INTEGER PRIMARY KEY)"))
    backup = old_backup()
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE stray"))
    engine.dispose()
    ensure_schema()
    with TestClient(app) as client:
        sign_in(client)
        transaction(client, account, amount="7.77", description="Kept")
        journal = client.get("/api/export/journal").text
        refused = restore(client, backup)
        assert refused.status_code == 422
        assert "schema does not match" in refused.json()["detail"]
        assert client.get("/api/export/journal").text == journal
