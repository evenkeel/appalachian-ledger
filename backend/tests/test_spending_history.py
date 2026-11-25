from conftest import new_account, post, transaction


def history(owner, **kwargs):
    return owner.get("/api/spending-history", params={"start": "2015-01-01", "end": "2026-02-01", **kwargs})


def test_history_sums_individual_rates_years_categories_and_hypothetical_value(owner):
    cash = new_account(owner)
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "250"})
    transaction(owner, cash, amount="75")
    post(owner, "/rates", {"day": "2026-01-06", "usd_per_btc": "100000"})
    transaction(owner, cash, amount="75", date="2026-01-06")
    before = owner.get("/api/export/journal").json()
    data = history(owner).json()
    assert data["totals"]["usd"] == "150.00"
    assert data["totals"]["bitcoin"] == "30075000"
    assert data["totals"]["hypothetical_value_usd"] == "30075.00"
    assert data["periods"][0]["period"] == "2026-01"
    assert data["categories"][0]["bitcoin"] == "30075000"
    assert data["transactions"][0]["method"] == "manual"
    annual = history(owner, interval="year").json()
    assert annual["periods"][0]["period"] == "2026"
    assert annual["totals"] == data["totals"]
    assert owner.get("/api/export/journal").json() == before
    # A summary carries the same sums and leaves the entries out.
    brief = history(owner, summary="true").json()
    assert brief["transactions"] == [] and brief["transactions_truncated"] is False
    assert brief["totals"] == data["totals"] and brief["periods"] == data["periods"]
    assert history(owner, category_id=999).json()["totals"]["count"] == 0
    assert history(owner, account_id=999).json()["totals"]["usd"] == "0"


def test_history_missing_rates_native_amounts_and_corrected_entries(owner):
    cash = new_account(owner)
    first = transaction(owner, cash, amount="75")
    data = history(owner).json()
    assert data["totals"]["usd"] == "75.00" and data["totals"]["bitcoin"] is None
    assert data["totals"]["missing_bitcoin"] == 1
    wallet = new_account(owner, name="Wallet", currency="BITCOIN", kind="bitcoin_wallet", amount="1000")
    transaction(owner, wallet, amount="100")
    data = history(owner).json()
    assert data["totals"]["usd"] is None and data["totals"]["bitcoin"] is None
    assert data["totals"]["missing_usd"] == 1
    assert owner.delete(f"/api/transactions/{first['id']}").status_code == 200
    data = history(owner).json()
    assert data["totals"]["bitcoin"] == "100"
    assert data["totals"]["count"] == 1


def test_history_rejects_bad_ranges_and_requires_login(owner):
    for params in ({"start": "2026-02-02"}, {"end": "2099-01-01"}, {"start": "1900-01-01"}, {"interval": "week"}):
        assert history(owner, **params).status_code == 422
    owner.cookies.clear()
    assert history(owner).status_code == 401


def test_aggregation_retains_extreme_conversion_precision():
    from app.reports import add_nullable, totals

    large = "922337203685477580700000000000000"
    assert add_nullable([large, "1"]) == "922337203685477580700000000000001"
    assert add_nullable([large, None]) is None
    assert (
        totals([{"value": large, "role": "asset"}, {"value": "1", "role": "liability"}])[2]
        == "922337203685477580699999999999999"
    )
