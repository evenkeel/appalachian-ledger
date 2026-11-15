from decimal import Decimal

from conftest import category, new_account, post, transaction


def report(owner):
    response = owner.get("/api/reports?month=2026-01&months=1&denomination=USD")
    assert response.status_code == 200, response.text
    return response.json()["dual"]["USD"]


def test_classification_changes_breakdown_without_changing_cashflow(owner):
    account = new_account(owner)
    cat = category(owner, "expense")
    transaction(owner, account, kind="income", amount="100")
    expense = transaction(owner, account, amount="120", category_id=cat)
    destination = new_account(owner, "Savings", amount="0", kind="savings")
    transaction(owner, account, kind="transfer", amount="10", destination_id=destination, destination_amount="10")
    before = report(owner)
    assert Decimal(before["spending"]["unclassified"]) == 120
    assert before["savings_rate"] == "-20.0"
    result = owner.put(f"/api/categories/{cat}/spending-type", json={"spending_type": "fixed"})
    assert result.status_code == 200
    after = report(owner)
    assert after["income"] == before["income"] and after["expenses"] == before["expenses"]
    assert Decimal(after["spending"]["fixed"]) == 120
    assert Decimal(after["spending"]["unclassified"]) == 0
    assert next(c for c in owner.get("/api/categories").json() if c["id"] == cat)["spending_type"] == "fixed"
    owner.delete(f"/api/transactions/{expense['id']}")
    assert Decimal(report(owner)["spending"]["fixed"]) == 0


def test_missing_bitcoin_conversion_is_not_reported_as_zero(owner):
    wallet = new_account(owner, "Wallet", "BITCOIN", "100000", "bitcoin_wallet")
    cat = category(owner, "expense")
    owner.put(f"/api/categories/{cat}/spending-type", json={"spending_type": "essential"})
    transaction(owner, wallet, amount="10000", category_id=cat)
    flow = report(owner)
    assert flow["expenses"] is None
    assert flow["spending"]["essential"] is None
    assert flow["savings_rate"] is None


def test_classification_validates_type_and_requires_csrf(owner):
    cat = category(owner, "expense")
    url = f"/api/categories/{cat}/spending-type"
    assert owner.put(url, json={"spending_type": "other"}).status_code == 422
    assert owner.put(url, json={"spending_type": "fixed"}, headers={"X-CSRF-Token": ""}).status_code == 403
    income = category(owner, "income")
    assert owner.put(f"/api/categories/{income}/spending-type", json={"spending_type": "fixed"}).status_code == 400


def test_saved_bitcoin_cost_is_included_in_classified_spending(owner):
    wallet = new_account(owner, "Wallet", "BITCOIN", "100000", "bitcoin_wallet")
    cat = category(owner, "expense")
    owner.put(f"/api/categories/{cat}/spending-type", json={"spending_type": "discretionary"})
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    transaction(owner, wallet, amount="20000", category_id=cat)
    flow = report(owner)
    assert Decimal(flow["expenses"]) == 20
    assert Decimal(flow["spending"]["discretionary"]) == 20
