from decimal import Decimal

import pytest

from app.reports import allocation
from conftest import new_account, post


def record(kind, value):
    return {"holding_type": kind, "usd": value}


@pytest.mark.parametrize(
    "debt,dominance", [("0", "50.0"), ("100", "66.7"), ("300", "200.0"), ("400", None), ("500", None)]
)
def test_debt_affects_dominance_but_not_asset_shares(debt, dominance):
    result = allocation(
        [
            record("bitcoin", "200"),
            record("dollars", "100"),
            record("valued_asset", "100"),
            record("debt", debt),
        ]
    )
    assert result["asset_percentages"] == {"bitcoin": "50.0", "dollars": "25.0", "valued_asset": "25.0"}
    assert result["bitcoin_dominance"] == dominance
    assert result["status"] == "ready"


def test_missing_values_never_form_partial_pie_or_dominance():
    result = allocation([record("bitcoin", None), record("dollars", "100")])
    assert result["status"] == "missing_values"
    assert all(value is None for value in result["asset_percentages"].values())
    assert result["bitcoin_dominance"] is None
    result = allocation([record("bitcoin", "100"), record("debt", None)])
    assert result["status"] == "ready"
    assert result["bitcoin_dominance"] is None


def test_empty_negative_and_zero_bitcoin_balances():
    assert allocation([])["status"] == "empty"
    result = allocation([record("bitcoin", "200"), record("dollars", "-10")])
    assert result["status"] == "negative_assets"
    assert result["asset_percentages"]["bitcoin"] is None
    result = allocation([record("dollars", "100")])
    assert result["bitcoin_dominance"] == "0.0"
    assert result["asset_percentages"]["dollars"] == "100.0"


def test_history_uses_dated_rates_and_actual_bitcoin_holdings(owner):
    new_account(owner, "Wallet", "BITCOIN", "100000000", "bitcoin_wallet")
    new_account(owner, "Cash", amount="100000")
    # A bitcoin-denominated asset is valued property, not held bitcoin.
    property_id = new_account(owner, "Property", "BITCOIN", "100000000", "real_estate")
    post(owner, "/assets", {"account_id": property_id, "quantity": "1"})
    post(owner, "/rates", {"day": "2026-01-31", "usd_per_btc": "100000"})
    post(owner, "/rates", {"day": "2026-03-31", "usd_per_btc": "200000"})
    response = owner.get("/api/reports?month=2026-03&months=3&denomination=USD")
    assert response.status_code == 200
    report = response.json()
    january, february, march = [point["allocation"] for point in report["history"]]
    assert january["bitcoin_dominance"] == "33.3"
    assert february["bitcoin_dominance"] is None
    assert february["status"] == "missing_values"
    assert march["bitcoin_dominance"] == "40.0"
    assert march == report["ownership"]["allocation"]
    assert Decimal(march["net_worth_usd"]) == Decimal(report["dual"]["USD"]["net_worth"])
    assert march["asset_percentages"] == {"bitcoin": "40.0", "dollars": "20.0", "valued_asset": "40.0"}
    bitcoin_report = owner.get("/api/reports?month=2026-03&months=3&denomination=BITCOIN").json()
    assert bitcoin_report["ownership"]["allocation"] == march
