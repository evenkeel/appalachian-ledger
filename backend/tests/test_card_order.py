from conftest import new_account


def test_card_order_persists_independently_and_stale_settings_cannot_reset_it(owner):
    first = new_account(owner, "First")
    second = new_account(owner, "Second")
    ids = [str(second), str(first)]
    response = owner.put("/api/card-order", json={"scope": "accounts", "ids": ids})
    assert response.status_code == 200, response.text
    assert response.json()["card_orders"]["accounts"] == ids
    assert owner.put("/api/card-order", json={"scope": "assets", "ids": [str(first)]}).status_code == 200
    assert owner.put("/api/settings", json={"theme": "light", "card_orders": {}}).status_code == 200
    prefs = owner.get("/api/settings").json()["preferences"]
    assert prefs["card_orders"] == {"accounts": ids, "assets": [str(first)]}
    assert prefs["theme"] == "light"
    assert owner.put("/api/card-order", json={"scope": "accounts", "ids": []}).status_code == 200
    prefs = owner.get("/api/settings").json()["preferences"]
    assert prefs["card_orders"] == {"accounts": [], "assets": [str(first)]}
    assert [row["name"] for row in owner.get("/api/accounts").json()] == ["First", "Second"]


def test_order_rejects_duplicate_unknown_or_internal_cards(owner):
    account = new_account(owner)
    for payload in [
        {"scope": "accounts", "ids": [str(account), str(account)]},
        {"scope": "accounts", "ids": ["99999"]},
        {"scope": "unknown", "ids": [str(account)]},
        {"scope": "overview-balances", "ids": [str(account)]},
        {"scope": "accounts", "ids": [""]},
    ]:
        assert owner.put("/api/card-order", json=payload).status_code == 422
    assert owner.get("/api/settings").json()["preferences"]["card_orders"] == {}
    assert (
        owner.put(
            "/api/card-order",
            json={"scope": "overview-balances", "ids": ["debt", "bitcoin", "dollars", "valued_asset"]},
        ).status_code
        == 200
    )


def test_bill_order_uses_saved_bill_ids_and_keeps_the_schedule_unchanged(owner):
    from conftest import category

    account = new_account(owner)
    bill = owner.post(
        "/api/recurring-bills",
        json={
            "transaction": {
                "kind": "expense",
                "date": "2026-01-31",
                "account_id": account,
                "amount": "30",
                "description": "Internet",
                "category_id": category(owner, "expense"),
            }
        },
    ).json()
    response = owner.put("/api/card-order", json={"scope": "bills", "ids": [str(bill["id"])]})
    assert response.status_code == 200
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == "2026-01-31"
    assert owner.get("/api/transactions").json() == []
