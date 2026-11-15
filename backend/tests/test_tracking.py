from conftest import category, new_account, post, transaction


def history(owner, **params):
    response = owner.get("/api/tracking", params={"month": "2026-02", "months": 2, **params})
    assert response.status_code == 200, response.text
    return response.json()["history"]


def test_purchases_use_actual_receipts_exclude_wallet_moves_and_reversals(owner):
    cash = new_account(owner)
    wallet = new_account(owner, "Wallet", "BITCOIN", "0", "bitcoin_wallet")
    cold = new_account(owner, "Cold", "BITCOIN", "0", "bitcoin_wallet")
    first = transaction(owner, cash, "transfer", "100", destination_id=wallet, destination_amount="90000")
    assert first["actual_exchange_price"] == "111111.11"
    transaction(owner, cash, "transfer", "200", destination_id=wallet, destination_amount="110000")
    transaction(owner, wallet, "transfer", "20000", destination_id=cold)
    january, february = history(owner)
    assert january["bitcoin_bought"] == "200000"
    assert january["bitcoin_paid_usd"] == "300.00"
    assert january["average_price_usd"] == "150000.00"
    assert january["purchase_count"] == 2
    assert january["bitcoin_balance"] == "200000"
    assert january["investing_net_usd"] == "300.00"
    assert january["investing_balance_usd"] is None  # No month-end quote; no guessed value.
    assert february["bitcoin_bought"] == "0" and february["bitcoin_balance"] == "200000"
    assert january["spent_usd"] == "0"
    assert owner.delete(f"/api/transactions/{first['id']}").status_code == 200
    january = history(owner)[0]
    assert january["bitcoin_bought"] == "110000" and january["bitcoin_paid_usd"] == "200.00"
    assert history(owner, account_id=cold)[0]["bitcoin_bought"] == "0"


def test_group_funding_nets_withdrawals_without_counting_internal_transfers(owner):
    cash = new_account(owner)
    savings = new_account(owner, "Savings", "USD", "100", "savings")
    reserve = new_account(owner, "Reserve", "USD", "0", "savings")
    broker = new_account(owner, "Broker", "USD", "50", "brokerage")
    transaction(owner, cash, "transfer", "400", destination_id=savings)
    transaction(owner, savings, "transfer", "100", destination_id=reserve)
    transaction(owner, savings, "transfer", "70", destination_id=cash)
    transaction(owner, savings, "transfer", "30", destination_id=broker)
    transaction(owner, savings, "income", "5")
    transaction(owner, savings, "expense", "2")
    january = history(owner)[0]
    assert january["savings_net_usd"] == "300.00"
    assert january["savings_balance_usd"] == "403.00"
    assert january["investing_net_usd"] == "30.00"
    assert january["investing_balance_usd"] == "80.00"
    assert history(owner, account_id=reserve)[0]["savings_net_usd"] == "100.00"
    assert owner.patch(f"/api/accounts/{reserve}", json={"name": "Reserve", "archived": True}).status_code == 200
    assert history(owner)[0]["savings_balance_usd"] == "403.00"


def test_spending_history_separates_unbudgeted_spending_and_preserves_gaps(owner):
    cash = new_account(owner)
    wallet = new_account(owner, "Wallet", "BITCOIN", "100000", "bitcoin_wallet")
    planned = category(owner, "expense")
    other = post(owner, "/categories", {"name": "Unplanned", "kind": "expense"})["id"]
    post(owner, "/budgets", {"month": "2026-01", "category_id": planned, "amount": "100", "scope": "all"})
    transaction(owner, cash, amount="75", category_id=planned)
    transaction(owner, cash, amount="50", category_id=other)
    january = history(owner)[0]
    assert january["planned_usd"] == "100.00" and january["spent_usd"] == "125.00"
    assert january["remaining_usd"] == "-25.00" and january["unbudgeted_usd"] == "50.00"
    assert history(owner, category_id=other)[0]["planned_usd"] is None
    assert history(owner, category_id=other)[0]["spent_usd"] == "50.00"
    transaction(owner, wallet, amount="10000", category_id=other)
    assert history(owner)[0]["spent_usd"] is None
    assert history(owner, category_id=planned)[0]["spent_usd"] == "75.00"
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    assert history(owner)[0]["spent_usd"] == "135.00"


def test_copy_previous_is_idempotent_keeps_existing_and_legacy_plans(owner):
    first = category(owner, "expense")
    second = post(owner, "/categories", {"name": "Second", "kind": "expense"})["id"]
    for cat in (first, second):
        post(owner, "/budgets", {"month": "2025-12", "category_id": cat, "amount": "100", "scope": "all"})
    post(owner, "/budgets", {"month": "2026-01", "category_id": first, "amount": "250", "scope": "all"})
    post(owner, "/budgets", {"month": "2026-01", "category_id": second, "bitcoin": "1000"})
    assert post(owner, "/budgets/copy-previous", {"month": "2026-01"}) == {"copied": 1, "from": "2025-12"}
    assert post(owner, "/budgets/copy-previous", {"month": "2026-01"})["copied"] == 0
    rows = owner.get("/api/budgets?month=2026-01").json()
    assert len(rows) == 3
    assert next(r for r in rows if r["category_id"] == first)["planned"] == "250.00"
    assert next(r for r in rows if r["currency"] == "BITCOIN")["planned"] == "1000"


def test_tracking_requires_auth_and_valid_filters(client, owner):
    assert owner.get("/api/tracking?month=2026-01&months=25").status_code == 422
    assert owner.get("/api/tracking?month=2026-13").status_code == 422
    assert owner.get("/api/tracking?month=2026-01&account_id=999999").status_code == 422
    assert owner.get(f"/api/tracking?month=2026-01&category_id={category(owner, 'income')}").status_code == 422
    assert owner.get("/api/tracking?month=1970-01&months=24").json()["history"][0]["month"] == "1970-01"
    post(owner, "/auth/logout", {})
    assert client.get("/api/tracking?month=2026-01").status_code == 401
    assert client.post("/api/budgets/copy-previous", json={"month": "2026-01"}).status_code == 401
