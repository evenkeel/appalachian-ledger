from conftest import category, new_account


def test_payment_defaults_persist_and_other_settings_cannot_reset_them(owner):
    groceries = category(owner, "expense")
    card = new_account(owner, "Gemini", kind="credit_card", amount="0")
    defaults = {str(groceries): card}
    assert owner.put("/api/settings/payment-defaults", json={"category_payment_defaults": defaults}).status_code == 200
    assert owner.put("/api/settings", json={"theme": "light"}).status_code == 200
    prefs = owner.get("/api/settings").json()["preferences"]
    assert prefs["category_payment_defaults"] == defaults
    assert prefs["theme"] == "light"
    assert owner.get("/api/transactions").json() == []
    assert owner.put("/api/settings/payment-defaults", json={"category_payment_defaults": {}}).status_code == 200
    assert owner.get("/api/settings").json()["preferences"]["category_payment_defaults"] == {}


def test_payment_defaults_reject_invalid_categories_and_accounts_atomically(owner):
    expense = category(owner, "expense")
    income = category(owner, "income")
    cash = new_account(owner)
    house = new_account(owner, "House", kind="real_estate")
    archived = new_account(owner, "Old card", kind="credit_card", amount="0")
    assert owner.patch(f"/api/accounts/{archived}", json={"name": "Old card", "archived": True}).status_code == 200
    for defaults in [
        {str(income): cash},
        {"999999": cash},
        {str(expense): 999999},
        {str(expense): house},
        {str(expense): archived},
        {str(expense): cash, str(income): cash},
    ]:
        response = owner.put("/api/settings/payment-defaults", json={"category_payment_defaults": defaults})
        assert response.status_code == 422, response.text
        assert owner.get("/api/settings").json()["preferences"]["category_payment_defaults"] == {}
