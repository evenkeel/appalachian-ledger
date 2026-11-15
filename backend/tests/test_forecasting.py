from datetime import date
from decimal import Decimal
import pytest
from pydantic import ValidationError
from app.forecasting import ForecastInput, earliest_retirement, project


def plan(**overrides):
    return ForecastInput(
        as_of=date(2026, 1, 31), current_age=40, retirement_age=41, planning_age=42, price_usd="100000", **overrides
    )


def test_zero_scenario_and_explicit_compounding():
    result = project(plan(bitcoin="100000000", appreciation_pct="10"))
    assert result["retirement"]["price_usd"] == "110000.00000000"
    assert result["end"]["price_usd"] == "121000.00000000"
    assert result["end"]["bitcoin"] == "100000000"
    assert result["end"]["portfolio_usd"] == "121000.00"
    assert result["sustainable"]
    assert result["depletion_date"] is None
    negative = project(plan(bitcoin="100000000", appreciation_pct="-50"))
    assert negative["end"]["price_usd"] == "25000.00000000"
    assert project(plan())["end"]["portfolio_usd"] == "0.00"


def test_contributions_end_at_retirement_and_price_does_not_create_holdings():
    result = project(plan(monthly_purchase_usd="100", monthly_savings_usd="50"))
    assert result["retirement"]["bitcoin"] == "1200000"
    assert result["end"]["bitcoin"] == "1200000"
    assert result["end"]["other_assets_usd"] == "600.00"
    assert result["end"]["portfolio_usd"] == "1800.00"


def test_withdrawals_start_after_retirement_cash_then_assets_then_bitcoin():
    result = project(plan(bitcoin="1000000", cash_usd="50", other_assets_usd="100", monthly_spending_usd="100"))
    assert result["retirement"]["portfolio_usd"] == "1150.00"
    assert result["depletion_date"] == "2028-01-31"
    assert result["depletion_age"] == "42.00"
    assert result["shortfall_usd"] == "50.00"
    assert result["end"]["bitcoin"] == "0"
    assert result["end"]["withdrawals_usd"] == "1150.00"
    assert not result["sustainable"]
    assert all(Decimal(row["bitcoin"]) >= 0 for row in result["history"])


def test_past_retirement_is_rejected_and_retiring_now_works():
    p = plan().model_dump()
    p["retirement_age"] = 39
    with pytest.raises(ValidationError):
        ForecastInput(**p)
    p.update(retirement_age=40, cash_usd="1000", monthly_spending_usd="100")
    result = project(ForecastInput(**p))
    assert result["retirement"]["date"] == "2026-01-31"
    assert result["depletion_date"] == "2026-12-31"


def test_two_spending_models_are_independent_and_not_double_counted():
    usd = project(
        plan(bitcoin="100000000", appreciation_pct="10", monthly_spending_usd="100", bitcoin_cost_change_pct="-50")
    )
    other_cost = project(
        plan(bitcoin="100000000", appreciation_pct="10", monthly_spending_usd="100", bitcoin_cost_change_pct="25")
    )
    assert usd["end"] == other_cost["end"]
    direct = project(
        plan(
            bitcoin="100000000",
            appreciation_pct="10",
            spending_model="BITCOIN",
            monthly_spending_bitcoin="100000",
            bitcoin_cost_change_pct="-50",
            usd_spending_change_pct="100",
        )
    )
    direct_flat_price = project(
        plan(
            bitcoin="100000000",
            spending_model="BITCOIN",
            monthly_spending_bitcoin="100000",
            bitcoin_cost_change_pct="-50",
        )
    )
    assert direct["retirement"]["annual_spending_bitcoin"] == "600000"
    assert direct["end"]["bitcoin"] == direct_flat_price["end"]["bitcoin"]
    assert direct["end"]["annual_spending_bitcoin"] == "300000"


def test_equivalent_spending_models_match_at_constant_price():
    args = {"bitcoin": "100000000", "monthly_spending_usd": "100", "monthly_spending_bitcoin": "100000"}
    assert project(plan(**args))["end"] == project(plan(**args, spending_model="BITCOIN"))["end"]


def test_liabilities_and_excess_retirement_income_are_explicit():
    result = project(
        plan(cash_usd="1000", liabilities_usd="200", monthly_retirement_income_usd="100", monthly_spending_usd="50")
    )
    assert result["history"][0]["cash_usd"] == "800.00"
    assert result["end"]["cash_usd"] == "1400.00"
    assert result["end"]["withdrawals_usd"] == "200.00"
    assert result["sustainable"]
    insolvent = project(plan(liabilities_usd="1"))
    assert insolvent["shortfall_usd"] == "1.00"
    assert insolvent["depletion_date"] == "2026-01-31"


def test_whole_bitcoin_withdrawal_rounding_retains_sale_change():
    p = plan(bitcoin="1", monthly_spending_usd="0.01").model_copy(
        update={"retirement_age": 40, "planning_age": 41, "price_usd": "2000000"}
    )
    result = project(p)
    assert result["end"]["bitcoin"] == "0"
    assert result["end"]["withdrawals_usd"] == "0.02"
    assert result["shortfall_usd"] == "0.10"
    assert result["depletion_date"] == "2026-04-30"


def test_earliest_retirement_checks_every_annual_age_and_target_balance():
    p = plan(monthly_savings_usd="100", monthly_spending_usd="100")
    assert earliest_retirement(p) == {"age": 41, "date": "2027-01-31"}
    assert earliest_retirement(plan(monthly_spending_usd="100"))["age"] is None
    assert not project(plan(cash_usd="10", end_balance_usd="11"))["sustainable"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"bitcoin": "0.5"},
        {"cash_usd": "0.001"},
        {"cash_usd": 1.5},
        {"cash_usd": "-1"},
        {"appreciation_pct": "-100"},
        {"appreciation_pct": "NaN"},
        {"price_usd": "0"},
        {"appreciation_pct": "1001"},
        {"bitcoin": str(2**63)},
    ],
)
def test_invalid_financial_inputs(overrides):
    values = plan().model_dump()
    values.update(overrides)
    with pytest.raises(ValidationError):
        ForecastInput(**values)


def test_extreme_projection_is_bounded():
    p = plan(appreciation_pct="1000").model_copy(update={"planning_age": 120})
    with pytest.raises(ValueError, match="supported projection range"):
        project(p)
    p = plan(appreciation_pct="-99").model_copy(update={"planning_age": 120})
    with pytest.raises(ValueError, match="supported precision"):
        project(p)


def test_bitcoin_purchases_never_overspend_the_contribution():
    p = plan(monthly_purchase_usd="0.03").model_copy(update={"price_usd": "2000000"})
    result = project(p)
    assert result["retirement"]["bitcoin"] == "12"
    assert result["retirement"]["cash_usd"] == "0.12"
    assert result["retirement"]["portfolio_usd"] == "0.36"
