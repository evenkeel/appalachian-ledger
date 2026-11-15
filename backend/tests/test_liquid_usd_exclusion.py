import json
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditEvent
from conftest import new_account


def test_liquid_exclusion_persists_without_changing_financial_totals(owner):
    reserve = new_account(owner, "Emergency fund", amount="12345.67")
    new_account(owner, "Everyday", amount="456.78")
    before = owner.get("/api/reports?month=2026-01").json()
    patch = owner.patch(
        f"/api/accounts/{reserve}",
        json={"name": "Emergency fund", "exclude_from_liquid_usd": True},
    )
    assert patch.status_code == 200, patch.text
    after = owner.get("/api/reports?month=2026-01").json()
    assert after["dual"] == before["dual"]
    assert after["ownership"] == before["ownership"]
    account = next(a for a in after["accounts"] if a["id"] == reserve)
    assert account["exclude_from_liquid_usd"] is True
    assert Decimal(account["balance"]) == Decimal("12345.67")
    assert owner.patch(f"/api/accounts/{reserve}", json={"name": "Reserved checking"}).status_code == 200
    account = next(a for a in owner.get("/api/accounts").json() if a["id"] == reserve)
    assert account["exclude_from_liquid_usd"] is True
    assert (
        owner.patch(
            f"/api/accounts/{reserve}",
            json={"name": "Reserved checking", "exclude_from_liquid_usd": False},
        ).status_code
        == 200
    )
    account = next(a for a in owner.get("/api/accounts").json() if a["id"] == reserve)
    assert account["exclude_from_liquid_usd"] is False
    with SessionLocal() as db:
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.action == "account.update")))
        assert len(events) == 3
        detail = json.loads(events[0].detail)
        assert detail["before"]["exclude_from_liquid_usd"] is False
        assert detail["after"]["exclude_from_liquid_usd"] is True


@pytest.mark.parametrize("kind,currency", [("savings", "USD"), ("credit_card", "USD"), ("checking", "BITCOIN")])
def test_exclusion_only_applies_to_usd_checking(owner, kind, currency):
    account_id = new_account(owner, kind=kind, currency=currency)
    response = owner.patch(
        f"/api/accounts/{account_id}",
        json={"name": "Reserved", "exclude_from_liquid_usd": True},
    )
    assert response.status_code == 422
    account = next(a for a in owner.get("/api/accounts").json() if a["id"] == account_id)
    assert account["exclude_from_liquid_usd"] is False
