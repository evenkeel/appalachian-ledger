from datetime import date
from decimal import Decimal
from app import investments
from app.prices import utcnow
from conftest import new_account, category, transaction


def pay(owner, debt, source, amount="300", interest="0", **extra):
    return owner.post(
        f"/api/accounts/{debt}/payments",
        json={
            "account_id": source,
            "date": "2026-01-05",
            "amount": amount,
            "interest": interest,
            **extra,
        },
    )


def test_credit_card_payment_reduces_cash_and_debt_without_expense(owner):
    cash = new_account(owner, amount="5000")
    card = new_account(owner, "Card", amount="1000", kind="credit_card")
    result = pay(owner, card, cash)
    assert result.status_code == 200, result.text
    accounts = {row["id"]: row for row in owner.get("/api/accounts").json()}
    assert accounts[cash]["balance"] == "4700.00"
    assert accounts[card]["balance"] == "700.00"
    report = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(report["dual"]["USD"]["expenses"]) == 0
    assert Decimal(report["dual"]["USD"]["net_worth"]) == 4000


def test_loan_payment_splits_principal_and_interest_atomically_into_budget_spending(owner):
    cash = new_account(owner, amount="5000")
    debt = new_account(owner, "Loan", amount="1000", kind="loan")
    result = pay(owner, debt, cash, interest="50", category_id=category(owner, "expense"))
    assert result.status_code == 200, result.text
    assert len(result.json()["entry_ids"]) == 2
    accounts = {row["id"]: row for row in owner.get("/api/accounts").json()}
    assert accounts[cash]["balance"] == "4700.00"
    assert accounts[debt]["balance"] == "750.00"
    budgets = owner.get("/api/budget-overview?month=2026-01").json()
    assert sum(Decimal(row["spent_usd"]) for row in budgets) == 50
    report = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(report["dual"]["USD"]["net_worth"]) == 3950


def test_invalid_interest_category_rolls_back_principal_and_invalid_split_rejected(owner):
    cash = new_account(owner, amount="5000")
    debt = new_account(owner, "Mortgage", amount="1000", kind="mortgage")
    assert pay(owner, debt, cash, interest="50", category_id=category(owner, "income")).status_code == 422
    assert pay(owner, debt, cash, interest="301").status_code == 422
    assert pay(owner, debt, cash, interest="-1").status_code == 422
    assert owner.get("/api/transactions").json() == []
    accounts = {row["id"]: row for row in owner.get("/api/accounts").json()}
    assert accounts[cash]["balance"] == "5000.00" and accounts[debt]["balance"] == "1000.00"


def test_brokerage_withdrawal_uses_uninvested_cash_not_security_value(owner, monkeypatch):
    monkeypatch.setattr(
        investments,
        "fetch_quote",
        lambda symbol: {
            "price": "200",
            "previous_close": "200",
            "observed_at": utcnow().isoformat(),
        },
    )
    broker = new_account(owner, "Broker", amount="2100", kind="brokerage")
    cash = new_account(owner, amount="1000")
    response = owner.put(
        f"/api/accounts/{broker}/holdings", json={"cash": "100", "holdings": [{"symbol": "MSTR", "shares": "10"}]}
    )
    assert response.status_code == 200, response.text
    transfer = {
        "date": str(date.today()),
        "kind": "transfer",
        "account_id": broker,
        "destination_id": cash,
        "amount": "101",
        "description": "Move cash",
    }
    response = owner.post("/api/transactions", json=transfer)
    assert response.status_code == 422 and "uninvested cash" in response.json()["detail"]
    transfer["amount"] = "100"
    response = owner.post("/api/transactions", json=transfer)
    assert response.status_code == 200, response.text
    row = next(row for row in owner.get("/api/accounts").json() if row["id"] == broker)
    assert row["portfolio"]["cash"] == "0.00"
    assert Decimal(row["portfolio"]["holdings"][0]["shares"]) == 10
    assert row["balance"] == "2000.00"


def test_property_update_creates_valuation_without_income_or_spending(owner):
    home = new_account(owner, "Home", amount="140000", kind="real_estate")
    response = owner.post(f"/api/accounts/{home}/valuations", json={"date": "2026-01-05", "value": "150000"})
    assert response.status_code == 200, response.text
    row = next(row for row in owner.get("/api/accounts").json() if row["id"] == home)
    assert row["balance"] == "150000.00"
    asset = owner.get("/api/assets").json()[0]
    assert asset["account_id"] == home and asset["history"][0]["value"] == "150000.00"
    report = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(report["dual"]["USD"]["income"]) == Decimal(report["dual"]["USD"]["expenses"]) == 0
    assert (
        owner.post(f"/api/accounts/{home}/valuations", json={"date": "2026-01-04", "value": "160000"}).status_code
        == 422
    )


def test_payments_cannot_be_made_from_property_or_untracked_investments(owner):
    home = new_account(owner, "Home", amount="140000", kind="real_estate")
    broker = new_account(owner, "Untracked broker", amount="1000", kind="brokerage")
    debt = new_account(owner, "Card", amount="1000", kind="credit_card")
    assert pay(owner, debt, home).status_code == 422
    assert pay(owner, debt, broker).status_code == 422
    assert owner.get("/api/transactions").json() == []


def test_brokerage_funding_cannot_be_reversed_after_cash_is_invested(owner, monkeypatch):
    monkeypatch.setattr(
        investments,
        "fetch_quote",
        lambda symbol: {
            "price": "100",
            "previous_close": "100",
            "observed_at": utcnow().isoformat(),
        },
    )
    broker = new_account(owner, "Broker", amount="0", kind="brokerage")
    cash = new_account(owner)
    assert owner.put(f"/api/accounts/{broker}/holdings", json={"cash": "0", "holdings": []}).status_code == 200
    funding = transaction(owner, cash, kind="transfer", amount="100", destination_id=broker, date=str(date.today()))
    assert (
        owner.put(
            f"/api/accounts/{broker}/holdings",
            json={
                "cash": "0",
                "holdings": [{"symbol": "MSTR", "shares": "1"}],
            },
        ).status_code
        == 200
    )
    response = owner.delete(f"/api/transactions/{funding['id']}")
    assert response.status_code == 422
    assert "uninvested cash" in response.json()["detail"]

    # Editing metadata must validate the final balance, not the temporary reversal.
    payload = {
        "date": str(date.today()),
        "kind": "transfer",
        "account_id": cash,
        "destination_id": broker,
        "amount": "100",
        "description": "Funding corrected",
    }
    response = owner.put(f"/api/transactions/{funding['id']}", json=payload)
    assert response.status_code == 200, response.text
    corrected_id = response.json()["id"]
    payload["amount"] = "99"
    assert owner.put(f"/api/transactions/{corrected_id}", json=payload).status_code == 422
    rows = owner.get("/api/transactions").json()
    assert len(rows) == 1 and rows[0]["id"] == corrected_id
    account = next(row for row in owner.get("/api/accounts").json() if row["id"] == broker)
    assert account["balance"] == "100.00" and account["portfolio"]["cash"] == "0.00"


def test_account_activity_includes_card_payments_both_sides_and_reconciles_balance(owner):
    cash = new_account(owner, name="Strike cash", amount="2000")
    card = new_account(owner, name="Prime Chase", amount="1000", kind="credit_card")
    assert pay(owner, card, cash, amount="835").status_code == 200
    outgoing = owner.get(f"/api/accounts/{cash}/activity").json()
    incoming = owner.get(f"/api/accounts/{card}/activity").json()
    assert outgoing["balance"] == "1165.00"
    assert incoming["balance"] == "165.00"
    assert outgoing["rows"][0]["change"] == "-835.00"
    assert outgoing["rows"][0]["counterparty"] == "Prime Chase"
    assert incoming["rows"][0]["change"] == "-835.00"
    assert incoming["rows"][0]["counterparty"] == "Strike cash"
    assert outgoing["rows"][-1]["kind"] == "opening"
    for data in (outgoing, incoming):
        assert sum(Decimal(row["change"]) for row in data["rows"]) == Decimal(data["balance"])
        assert data["rows"][0]["balance"] == data["balance"]


def test_account_activity_shows_incoming_cross_currency_units_adjustments_and_reversals(owner):
    cash = new_account(owner, amount="1000")
    wallet = new_account(owner, name="Wallet", amount="100", currency="BITCOIN", kind="bitcoin_wallet")
    transfer = transaction(
        owner, cash, kind="transfer", amount="50", destination_id=wallet, destination_amount="12345", date="2026-01-05"
    )
    assert owner.get(f"/api/accounts/{wallet}/activity").json()["rows"][0]["change"] == "12345"
    assert (
        owner.post(
            f"/api/accounts/{cash}/adjustments",
            json={"date": "2026-01-06", "amount": "20", "description": "Reconciliation"},
        ).status_code
        == 200
    )
    assert owner.delete(f"/api/transactions/{transfer['id']}").status_code == 200
    data = owner.get(f"/api/accounts/{cash}/activity").json()
    assert {"opening", "transfer", "reversal", "adjustment"} <= {row["kind"] for row in data["rows"]}
    assert any(row["reversed"] and row["id"] == transfer["id"] for row in data["rows"])
    assert sum(Decimal(row["change"]) for row in data["rows"]) == Decimal(data["balance"])
    balances = {row["id"]: row["balance"] for row in owner.get("/api/accounts").json()}
    assert data["balance"] == balances[cash]
    assert owner.get(f"/api/accounts/{wallet}/activity").json()["balance"] == balances[wallet]


def test_account_activity_income_expense_valuation_and_authorization(owner):
    cash = new_account(owner)
    transaction(owner, cash, kind="income", amount="200")
    transaction(owner, cash, amount="25")
    data = owner.get(f"/api/accounts/{cash}/activity").json()
    assert {row["kind"] for row in data["rows"]} == {"opening", "income", "expense"}
    assert data["balance"] == "1175.00"
    home = new_account(owner, name="Home", amount="1000", kind="real_estate")
    assert (
        owner.post(f"/api/accounts/{home}/valuations", json={"date": "2026-01-05", "value": "1200"}).status_code == 200
    )
    data = owner.get(f"/api/accounts/{home}/activity").json()
    assert data["rows"][0]["kind"] == "valuation"
    assert data["rows"][0]["change"] == "200.00"
    assert data["balance"] == "1200.00"
    owner.cookies.clear()
    assert owner.get(f"/api/accounts/{cash}/activity").status_code == 401
