from conftest import new_account, transaction


def test_lens_persists_without_changing_other_settings_or_ledger(owner):
    owner.put("/api/settings", json={"theme": "light", "rate_source": "coinbase", "automatic_prices": True})
    cash = new_account(owner)
    transaction(owner, cash)
    before_accounts = owner.get("/api/accounts").json()
    before_journal = owner.get("/api/export/journal").json()
    before_settings = owner.get("/api/settings").json()["preferences"]
    for unit in ("BITCOIN", "USD", "BTC"):
        result = owner.put("/api/settings/monetary-lens", json={"denomination": unit})
        assert result.status_code == 200
        assert result.json() == {"denomination": unit}
        prefs = owner.get("/api/settings").json()["preferences"]
        assert prefs == {**before_settings, "denomination": unit}
        assert owner.get("/api/accounts").json() == before_accounts
        assert owner.get("/api/export/journal").json() == before_journal


def test_lens_requires_valid_input_authentication_and_csrf(owner):
    for payload in ({}, {"denomination": "EUR"}, {"denomination": "USD", "theme": "light"}):
        assert owner.put("/api/settings/monetary-lens", json=payload).status_code == 422
    del owner.headers["X-CSRF-Token"]
    assert owner.put("/api/settings/monetary-lens", json={"denomination": "BITCOIN"}).status_code == 403
    owner.cookies.clear()
    assert owner.put("/api/settings/monetary-lens", json={"denomination": "USD"}).status_code == 401
