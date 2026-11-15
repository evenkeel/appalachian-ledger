from datetime import date, timedelta
from conftest import new_account, post, transaction

TODAY = date.today()
MONTH = TODAY.strftime("%Y-%m")
FIRST = TODAY.replace(day=1).isoformat()


def account_on(client, name, kind="checking", amount="0", currency="USD"):
    return post(
        client,
        "/accounts",
        {"name": name, "currency": currency, "opening_balance": amount, "kind": kind, "date": "2026-01-01"},
    )["id"]


def test_goals_sharing_an_account_fill_in_creation_order(owner):
    savings = account_on(owner, "Savings", "savings", "2500")
    later = (TODAY.replace(day=1) + timedelta(days=95)).isoformat()
    first = post(owner, "/goals", {"name": " Trip ", "account_id": savings, "target": "1000.00"})
    second = post(owner, "/goals", {"name": "Cushion", "account_id": savings, "target": "6000", "target_date": later})
    assert first["name"] == "Trip" and first["complete"] and first["saved"] == "1000.00"
    assert first["monthly_needed"] is None
    rows = {row["id"]: row for row in owner.get("/api/goals").json()}
    assert rows[second["id"]]["saved"] == "1500.00"
    assert rows[second["id"]]["remaining"] == "4500.00"
    assert rows[second["id"]]["percent"] == "25.0"
    assert rows[second["id"]]["shares_account"] is True
    months = rows[second["id"]]["months_left"]
    assert months in (3, 4, 5)
    assert float(rows[second["id"]]["monthly_needed"]) * months >= 4500
    updated = owner.put(
        f"/api/goals/{second['id']}", json={"name": "Cushion", "account_id": savings, "target": "1500"}
    ).json()
    assert updated["complete"] and updated["target_date"] is None
    assert owner.delete(f"/api/goals/{first['id']}").status_code == 200
    assert [row["name"] for row in owner.get("/api/goals").json()] == ["Cushion"]


def test_goal_validation(owner):
    card = account_on(owner, "Card", "credit_card")
    savings = account_on(owner, "Savings", "savings")
    assert owner.post("/api/goals", json={"name": "X", "account_id": card, "target": "10"}).status_code == 422
    assert owner.post("/api/goals", json={"name": "X", "account_id": savings, "target": "0"}).status_code == 422
    assert owner.post("/api/goals", json={"name": "  ", "account_id": savings, "target": "5"}).status_code == 422
    assert owner.put("/api/goals/999", json={"name": "X", "account_id": savings, "target": "5"}).status_code == 404


def test_review_queue_flags_imports_and_catch_all_categories_until_reviewed(owner):
    checking = new_account(owner)
    body = b"date,kind,amount,description,category\n2026-01-05,expense,12.00,Coffee,Dining\n"
    owner.post("/api/import/csv", data={"account_id": checking}, files={"file": ("t.csv", body, "text/csv")})
    other = next(c["id"] for c in owner.get("/api/categories").json() if c["name"] == "Other expense")
    transaction(owner, checking, description="Mystery", category_id=other)
    transaction(owner, checking, description="Lunch")
    rows = {row["description"]: row for row in owner.get("/api/transactions").json()}
    assert rows["Coffee"]["review_reasons"] == ["imported"]
    assert rows["Mystery"]["review_reasons"] == ["catch_all_category"]
    assert rows["Lunch"]["review_reasons"] == []
    marked = post(owner, "/transactions/review", {"ids": [rows["Coffee"]["id"], rows["Coffee"]["id"], 99999]})
    assert marked == {"marked": 1}
    rows = {row["description"]: row for row in owner.get("/api/transactions").json()}
    assert rows["Coffee"]["review_reasons"] == []
    assert rows["Mystery"]["review_reasons"] == ["catch_all_category"]


def test_payee_rules_are_validated_kept_across_settings_saves_and_follow_their_category(owner):
    checking = new_account(owner)
    created = post(owner, "/categories", {"name": "Streaming", "kind": "expense"})
    rule = {"match": " Spotify ", "category_id": created["id"], "account_id": checking}
    assert owner.put("/api/settings/payee-rules", json={"payee_rules": [rule]}).status_code == 200
    saved = owner.get("/api/settings").json()["preferences"]
    assert saved["payee_rules"] == [{"match": "Spotify", "category_id": created["id"], "account_id": checking}]
    assert owner.put("/api/settings", json=saved | {"theme": "light", "payee_rules": []}).status_code == 200
    assert len(owner.get("/api/settings").json()["preferences"]["payee_rules"]) == 1
    duplicate = owner.put("/api/settings/payee-rules", json={"payee_rules": [rule, rule | {"match": "spotify"}]})
    assert duplicate.status_code == 422
    missing = owner.put("/api/settings/payee-rules", json={"payee_rules": [rule | {"category_id": 9999}]})
    assert missing.status_code == 422
    assert owner.delete(f"/api/categories/{created['id']}").status_code == 200
    assert owner.get("/api/settings").json()["preferences"]["payee_rules"] == []


def test_safe_to_spend_subtracts_spending_savings_bills_and_goals(owner):
    checking = account_on(owner, "Checking", amount="100")
    savings = account_on(owner, "Savings", "savings")
    card = account_on(owner, "Card", "credit_card")
    transaction(owner, checking, kind="income", amount="3000.00", date=FIRST)
    transaction(owner, checking, amount="400.00", date=FIRST)
    transaction(owner, card, amount="100.00", date=FIRST)
    transaction(owner, checking, kind="transfer", amount="500.00", destination_id=savings, date=FIRST)
    # Paying the card settles spending already counted; it is not set aside again.
    transaction(owner, checking, kind="transfer", amount="100.00", destination_id=card, date=FIRST)
    category = next(c["id"] for c in owner.get("/api/categories").json() if c["kind"] == "expense")
    end = (TODAY.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    bill = {
        "date": end.isoformat(),
        "kind": "expense",
        "account_id": checking,
        "amount": "250.00",
        "description": "Rent top-up",
        "category_id": category,
    }
    post(owner, "/recurring-bills", {"transaction": bill, "frequency": "monthly", "record_now": False})
    # 1,400 over this month and the next: 700 this month, of which 500 has already arrived.
    target_date = (end + timedelta(days=5)).isoformat()
    post(owner, "/goals", {"name": "Buffer", "account_id": savings, "target": "1400", "target_date": target_date})
    reading = owner.get(f"/api/reports?month={MONTH}&denomination=USD").json()["safe_to_spend"]
    assert reading["complete"] is True
    assert reading["income"] == "3000.00" and reading["spent"] == "500.00"
    assert reading["other_moved_usd"] == "500.00" and reading["bitcoin_paid_usd"] == "0.00"
    assert reading["bills_due"] == "250.00" and reading["bills_count"] == 1
    assert reading["goals"] == "200.00"
    assert reading["amount"] == "1550.00"
    assert reading["days_left"] == (end - TODAY).days + 1
    assert float(reading["per_day"]) <= 1550 / reading["days_left"]


def test_safe_to_spend_counts_bitcoin_buys(owner):
    checking = account_on(owner, "Checking", amount="1000")
    cold = account_on(owner, "Cold storage", "bitcoin_wallet", currency="BITCOIN")
    transaction(owner, checking, kind="income", amount="2000.00", date=FIRST)
    transaction(
        owner,
        checking,
        kind="transfer",
        amount="300.00",
        destination_id=cold,
        destination_amount="300000",
        date=FIRST,
    )
    # Selling some back to checking nets out of what was stacked.
    transaction(
        owner,
        cold,
        kind="transfer",
        amount="50000",
        destination_id=checking,
        destination_amount="50.00",
        date=FIRST,
    )
    reading = owner.get(f"/api/reports?month={MONTH}&denomination=USD").json()["safe_to_spend"]
    assert reading["bitcoin_bought"] == "250000"
    assert reading["bitcoin_paid_usd"] == "250.00"
    assert reading["other_moved_usd"] == "0.00"
    assert reading["amount"] == "1750.00"


def test_safe_to_spend_is_absent_for_past_months(owner):
    new_account(owner)
    assert owner.get("/api/reports?month=2026-01&denomination=USD").json()["safe_to_spend"] is None


def test_reports_show_bitcoin_stacked_and_stack_rate(owner):
    checking = account_on(owner, "Checking", amount="1000")
    cold = account_on(owner, "Cold storage", "bitcoin_wallet", currency="BITCOIN")
    transaction(owner, checking, kind="income", amount="2000.00", date=FIRST)
    transaction(
        owner,
        checking,
        kind="transfer",
        amount="500.00",
        destination_id=cold,
        destination_amount="600000",
        date=FIRST,
    )
    report = owner.get(f"/api/reports?month={MONTH}&denomination=USD").json()
    assert report["stacked"] == {"bitcoin": "600000", "usd": "500.00", "other_usd": "0.00", "stack_rate": "25.0"}
    current = report["history"][-1]
    assert current["stacked"]["bitcoin"] == "600000"
    assert current["bitcoin_held"] == "600000"
