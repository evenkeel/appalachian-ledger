from decimal import Decimal
from sqlalchemy import select
from app.db import SessionLocal
from app.models import AuditEvent
from conftest import new_account


def test_exclusion_changes_only_consumer_gauge_and_persists_on_rename(owner):
    new_account(owner, "Card", amount="1833.35", kind="credit_card")
    loan = new_account(owner, "Loan", amount="21000", kind="loan")
    new_account(owner, "Mortgage", amount="200000", kind="mortgage")
    before = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(before["debt_gauge"]["debt_usd"]) == Decimal("22833.35")
    assert (
        owner.patch(
            f"/api/accounts/{loan}",
            json={
                "name": "Loan",
                "exclude_from_consumer_debt": True,
            },
        ).status_code
        == 200
    )
    after = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(after["debt_gauge"]["debt_usd"]) == Decimal("1833.35")
    assert after["dual"] == before["dual"]
    assert after["net_worth"] == before["net_worth"]
    account = next(a for a in owner.get("/api/accounts").json() if a["id"] == loan)
    assert account["exclude_from_consumer_debt"] is True
    assert Decimal(account["balance"]) == Decimal("21000")
    assert owner.patch(f"/api/accounts/{loan}", json={"name": "Renamed loan"}).status_code == 200
    renamed = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(renamed["debt_gauge"]["debt_usd"]) == Decimal("1833.35")
    assert (
        owner.patch(
            f"/api/accounts/{loan}",
            json={
                "name": "Renamed loan",
                "exclude_from_consumer_debt": False,
            },
        ).status_code
        == 200
    )
    restored = owner.get("/api/reports?month=2026-01").json()
    assert restored["debt_gauge"] == before["debt_gauge"]
    with SessionLocal() as db:
        audits = list(db.scalars(select(AuditEvent).where(AuditEvent.action == "account.update")))
        assert len(audits) == 3


def test_asset_cannot_be_excluded_and_excluding_all_debt_results_in_zero(owner):
    cash = new_account(owner)
    response = owner.patch(f"/api/accounts/{cash}", json={"name": "Checking", "exclude_from_consumer_debt": True})
    assert response.status_code == 422
    loan = new_account(owner, "Loan", amount="21000", kind="loan")
    owner.patch(f"/api/accounts/{loan}", json={"name": "Loan", "exclude_from_consumer_debt": True})
    report = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(report["debt_gauge"]["debt_usd"]) == 0
    assert Decimal(report["dual"]["USD"]["liabilities"]) == 21000
