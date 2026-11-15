import pytest
from sqlalchemy import select
from app.db import SessionLocal
from app.models import AuditEvent
from conftest import new_account, post, transaction


@pytest.mark.parametrize("kind", ["income", "expense"])
def test_unused_categories_can_be_deleted_and_recreated(owner, kind):
    category = post(owner, "/categories", {"name": " Underwriting ", "kind": kind})["id"]
    assert any(c["name"] == "Underwriting" for c in owner.get("/api/categories").json())
    response = owner.delete(f"/api/categories/{category}")
    assert response.status_code == 200
    assert all(c["id"] != category for c in owner.get("/api/categories").json())
    with SessionLocal() as db:
        event = db.scalar(select(AuditEvent).where(AuditEvent.action == "category.delete"))
        assert event is not None
    assert owner.delete(f"/api/categories/{category}").status_code == 404
    assert post(owner, "/categories", {"name": "Underwriting", "kind": kind})["id"]


def test_category_used_by_transaction_is_preserved(owner):
    account = new_account(owner)
    category = post(owner, "/categories", {"name": "Consulting", "kind": "income"})["id"]
    entry = transaction(owner, account, kind="income", amount="100", category_id=category)
    before = owner.get("/api/transactions").json()
    response = owner.delete(f"/api/categories/{category}")
    assert response.status_code == 409 and "transactions" in response.json()["detail"]
    assert owner.get("/api/transactions").json() == before
    owner.delete(f"/api/transactions/{entry['id']}")
    assert owner.delete(f"/api/categories/{category}").status_code == 409


def test_category_used_by_budget_requires_budget_removal(owner):
    category = post(owner, "/categories", {"name": "Projects", "kind": "expense"})["id"]
    budget = post(owner, "/budgets", {"month": "2026-01", "category_id": category, "amount": "100"})
    response = owner.delete(f"/api/categories/{category}")
    assert response.status_code == 409 and "budgets" in response.json()["detail"]
    assert owner.delete(f"/api/budgets/{budget['id']}").status_code == 200
    assert owner.delete(f"/api/categories/{category}").status_code == 200


def test_category_deletion_requires_login_and_csrf(owner, client):
    category = post(owner, "/categories", {"name": "Unused", "kind": "income"})["id"]
    assert owner.delete(f"/api/categories/{category}", headers={"X-CSRF-Token": ""}).status_code == 403
    client.cookies.clear()
    assert client.delete(f"/api/categories/{category}").status_code == 401


def test_blank_category_is_rejected(owner):
    assert owner.post("/api/categories", json={"name": "   ", "kind": "income"}).status_code == 422
