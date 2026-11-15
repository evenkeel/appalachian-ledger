import json
import sqlite3
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from app.db import Base, engine
from app.backup import validate
from conftest import new_account, transaction


def assumptions(**overrides):
    return {
        "as_of": "2026-01-01",
        "current_age": 40,
        "retirement_age": 41,
        "planning_age": 42,
        "price_usd": "100000",
        "bitcoin": "100000000",
        **overrides,
    }


def save(owner, name="Base case", **overrides):
    result = owner.post("/api/planning/scenarios", json={"name": name, "assumptions": assumptions(**overrides)})
    assert result.status_code == 200, result.text
    return result.json()


def test_project_save_edit_duplicate_compare_delete_leave_ledger_unchanged(owner):
    account = new_account(owner)
    transaction(owner, account)
    before = owner.get("/api/export/journal").json()
    projection = owner.post("/api/planning/project", json=assumptions()).json()
    first = save(owner)
    second = save(owner, name="5% case", appreciation_pct="5")
    assert first["version"] == 1
    assert first["assumptions"]["price_usd"] == "100000"
    response = owner.put(
        f"/api/planning/scenarios/{second['id']}",
        json={"name": "10% case", "assumptions": assumptions(appreciation_pct="10")},
    )
    assert response.status_code == 200
    compared = owner.post("/api/planning/compare", json={"ids": [first["id"], second["id"]]}).json()
    assert compared[0]["result"] == projection
    assert compared[1]["result"]["end"]["portfolio_usd"] == "121000.00"
    assert compared[1]["name"] == "10% case"
    assert len(owner.get("/api/planning/scenarios").json()) == 2
    assert owner.delete(f"/api/planning/scenarios/{first['id']}").status_code == 200
    assert owner.delete(f"/api/planning/scenarios/{first['id']}").status_code == 404
    assert owner.get("/api/export/journal").json() == before
    assert owner.post("/api/planning/earliest-retirement", json=assumptions()).json() == {
        "age": 40,
        "date": "2026-01-01",
    }


def test_forecast_auth_csrf_validation_and_missing_scenarios(owner):
    assert owner.post("/api/planning/project", json=assumptions(price_usd="NaN")).status_code == 422
    assert owner.post("/api/planning/scenarios", json={"name": "  ", "assumptions": assumptions()}).status_code == 422
    assert owner.post("/api/planning/compare", json={"ids": [999]}).status_code == 404
    assert owner.post("/api/planning/compare", json={"ids": [1, 2, 3, 4, 5]}).status_code == 422
    del owner.headers["X-CSRF-Token"]
    assert owner.post("/api/planning/project", json=assumptions()).status_code == 403
    owner.cookies.clear()
    assert owner.get("/api/planning/scenarios").status_code == 401
    assert owner.get("/api/planning/starting-position").status_code == 401


def test_starting_position_keeps_missing_conversions_and_no_activity_explicit(owner):
    new_account(owner, currency="BITCOIN", kind="bitcoin_wallet", amount="100")
    new_account(owner, name="Cash", amount="25")
    new_account(owner, name="Property", currency="BITCOIN", kind="real_estate", amount="123")
    p = owner.get("/api/planning/starting-position").json()
    assert p["bitcoin"] == "100"
    assert p["cash_usd"] == "25.00"
    assert p["other_assets_usd"] is None and p["price_usd"] is None
    assert p["previous_month_entries"] == 0


def test_scenario_backup_restore_and_migration_metadata(owner):
    saved = save(owner)
    exported = owner.post("/api/backup", json={"passphrase": "long-backup-passphrase"})
    assert exported.status_code == 200
    owner.delete(f"/api/planning/scenarios/{saved['id']}")
    result = owner.post(
        "/api/restore",
        data={"passphrase": "long-backup-passphrase"},
        files={"file": ("ledger.albackup", exported.content, "application/octet-stream")},
    )
    assert result.status_code == 200, result.text
    login = owner.post("/api/auth/login", json={"username": "owner", "password": "correct-horse-battery-staple"})
    owner.headers["X-CSRF-Token"] = login.json()["csrf"]
    assert owner.get("/api/planning/scenarios").json() == [saved]
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []


def test_backup_rejects_corrupt_scenario_assumptions(owner):
    saved = save(owner)
    with sqlite3.connect(engine.url.database) as source, sqlite3.connect(":memory:") as candidate:
        source.backup(candidate)
        candidate.execute(
            "UPDATE planning_scenarios SET assumptions=? WHERE id=?",
            (json.dumps(assumptions(price_usd="NaN")), saved["id"]),
        )
        import pytest

        with pytest.raises(ValueError, match="invalid planning assumptions"):
            validate(candidate, source)


def test_saved_scenario_price_is_not_replaced_by_live_or_manual_prices(owner):
    first = save(owner)
    owner.post("/api/rates", json={"day": "2026-01-01", "usd_per_btc": "200000"})
    rows = owner.get("/api/planning/scenarios").json()
    assert rows[0]["assumptions"]["price_usd"] == "100000"
    result = owner.post("/api/planning/compare", json={"ids": [first["id"]]}).json()
    assert result[0]["result"]["end"]["portfolio_usd"] == "100000.00"
