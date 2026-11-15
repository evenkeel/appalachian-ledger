from conftest import category, new_account, transaction, post


def overview(owner):
    response = owner.get("/api/budget-overview?month=2026-01")
    assert response.status_code == 200, response.text
    return response.json()


def test_usd_plan_never_creates_bitcoin_spending(owner):
    cat = category(owner, "expense")
    post(
        owner, "/budgets", {"month": "2026-01", "category_id": cat, "currency": "USD", "scope": "all", "amount": "180"}
    )
    row = overview(owner)[0]
    assert row["planned_usd"] == "180.00"
    assert row["spent_bitcoin"] == row["spent_usd"] == "0"
    assert row["remaining_usd"] == "180.00"
    assert row["percent"] == "0.0"


def test_only_posted_expenses_consume_the_usd_plan(owner):
    cat = category(owner, "expense")
    cash = new_account(owner)
    wallet = new_account(owner, "Wallet", "BITCOIN", "100000", "bitcoin_wallet")
    post(
        owner, "/budgets", {"month": "2026-01", "category_id": cat, "currency": "USD", "scope": "all", "amount": "180"}
    )
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    transaction(owner, cash, "income", "500")
    transaction(owner, cash, "transfer", "10", destination_id=wallet, destination_amount="9000")
    transaction(owner, cash, amount="50", category_id=cat)
    tx = transaction(owner, wallet, amount="20000", category_id=cat)
    row = overview(owner)[0]
    assert row["spent_usd"] == "70.00" and row["spent_bitcoin"] == "70000"
    assert row["remaining_usd"] == "110.00" and row["percent"] == "38.9"
    assert owner.delete(f"/api/transactions/{tx['id']}").status_code == 200
    assert overview(owner)[0]["spent_bitcoin"] == "50000"


def test_legacy_plans_are_preserved_without_inventing_dollar_allowances(owner):
    cat = category(owner, "expense")
    post(owner, "/budgets", {"month": "2026-01", "category_id": cat, "bitcoin": "180000"})
    before = owner.get("/api/budgets?month=2026-01").json()
    row = overview(owner)[0]
    assert row["planned_usd"] is None and row["budget_id"] is None and row["percent"] is None
    assert owner.get("/api/budgets?month=2026-01").json() == before
    post(
        owner, "/budgets", {"month": "2026-01", "category_id": cat, "currency": "USD", "scope": "all", "amount": "180"}
    )
    assert len(overview(owner)) == 1
    assert overview(owner)[0]["planned_usd"] == "180.00"
    assert len(owner.get("/api/budgets?month=2026-01").json()) == 2


def test_category_spending_keeps_missing_prices_and_saved_snapshots(owner):
    cash = new_account(owner)
    row = transaction(owner, cash, amount="50")
    report = overview(owner)[0]
    assert report["planned_usd"] is None
    assert report["spent_usd"] == "50.00" and report["spent_bitcoin"] is None
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    assert overview(owner)[0]["spent_bitcoin"] == "50000"
    assert owner.delete(f"/api/transactions/{row['id']}").status_code == 200
    transaction(owner, cash, amount="50")
    assert overview(owner)[0]["spent_bitcoin"] == "50000"
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "200000"})
    assert overview(owner)[0]["spent_bitcoin"] == "50000"


def test_budget_overview_is_private(client):
    assert client.get("/api/budget-overview?month=2026-01").status_code == 401
