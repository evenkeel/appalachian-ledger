import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import SessionLocal, engine
from app.main import app
from app.startup import ensure_schema
from conftest import new_account, transaction


def test_direct_api_start_initializes_a_new_database():
    engine.dispose()
    Path(engine.url.database).unlink()
    with TestClient(app) as started:
        assert started.get("/api/health").json() == {"status": "ok"}
        assert started.get("/api/auth/status").json()["initialized"] is False
        result = started.post("/api/auth/setup", json={"username": "owner", "password": "correct-horse-battery-staple"})
        assert result.status_code == 200, result.text
        assert all(row["spending_type"] == "unclassified" for row in started.get("/api/categories").json())


def test_direct_api_start_upgrades_an_existing_ledger(owner):
    account = new_account(owner)
    expense = transaction(owner, account, amount="25")
    # Reproduce a pre-classification ledger without deleting any user records.
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE accounts DROP COLUMN exclude_from_liquid_usd"))
        connection.execute(text("DROP TABLE planning_scenarios"))
        connection.execute(text("DROP TABLE savings_goals"))
        connection.execute(text("DROP TABLE entry_reviews"))
        connection.execute(text("DROP TABLE income_schedules"))
        connection.execute(text("DROP TABLE card_terms"))
        connection.execute(text("DROP TABLE alert_acknowledgements"))
        connection.execute(text("DROP TABLE alert_settings"))
        connection.execute(text("ALTER TABLE recurring_bills DROP COLUMN pays_account_id"))
        connection.execute(text("ALTER TABLE recurring_bills DROP COLUMN destroyed_on"))
        connection.execute(text("ALTER TABLE categories DROP COLUMN spending_type"))
        connection.execute(text("UPDATE alembic_version SET version_num='0009_expense_costs'"))
    with TestClient(app) as restarted:
        restarted.cookies.update(owner.cookies)
        restarted.headers["X-CSRF-Token"] = owner.headers["X-CSRF-Token"]
        categories = restarted.get("/api/categories").json()
        assert all(row["spending_type"] == "unclassified" for row in categories)
        assert (
            restarted.put(
                f"/api/categories/{expense['category_id']}/spending-type", json={"spending_type": "fixed"}
            ).status_code
            == 200
        )
        report = restarted.get("/api/reports?month=2026-01").json()
        assert all(row["exclude_from_liquid_usd"] is False for row in report["accounts"])
        flow = report["dual"]["USD"]
        assert flow["expenses"] == "25.00" and flow["spending"]["fixed"] == "25.00"
    ensure_schema()  # An already upgraded ledger is safe to start again.
    with SessionLocal() as db:
        assert db.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0015_income_varies"


def test_api_does_not_start_workers_if_migration_fails(monkeypatch):
    def fail():
        raise RuntimeError("Migration failed")

    monkeypatch.setattr("app.main.ensure_schema", fail)
    monkeypatch.setattr("app.main.PriceWorker.start", lambda self: pytest.fail("Worker started before migration"))
    with pytest.raises(RuntimeError, match="Migration failed"), TestClient(app):
        pass
