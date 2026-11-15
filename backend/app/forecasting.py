"""Hypothetical monthly projections, independent of the journal and market feeds."""

from datetime import date
from decimal import Decimal, DecimalException, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_EVEN, localcontext
from typing import Literal
from pydantic import Field, field_validator, model_validator
from .schemas import StrictModel
from .money import BASE, decimal, rate_decimal, to_minor

D = Decimal
CENT = D(".01")
ONE = D(1)
MAX_PROJECTION = D("1e45")


class ForecastInput(StrictModel):
    as_of: date
    current_age: int = Field(ge=0, le=119, strict=True)
    retirement_age: int = Field(ge=0, le=119, strict=True)
    planning_age: int = Field(ge=1, le=120, strict=True)
    bitcoin: str = "0"
    other_assets_usd: str = "0"
    cash_usd: str = "0"
    liabilities_usd: str = "0"
    price_usd: str
    monthly_savings_usd: str = "0"
    monthly_purchase_usd: str = "0"
    monthly_spending_usd: str = "0"
    monthly_spending_bitcoin: str = "0"
    monthly_retirement_income_usd: str = "0"
    end_balance_usd: str = "0"
    appreciation_pct: str = "0"
    other_return_pct: str = "0"
    usd_spending_change_pct: str = "0"
    bitcoin_cost_change_pct: str = "0"
    spending_model: Literal["USD", "BITCOIN"] = "USD"

    @field_validator("*", mode="before")
    @classmethod
    def bounded_strings(cls, value):
        if isinstance(value, str) and len(value) > 80:
            raise ValueError("Input is too long")
        return value

    @field_validator("bitcoin", "monthly_spending_bitcoin")
    @classmethod
    def bitcoin_amount(cls, value):
        if to_minor(value, "BITCOIN") < 0:
            raise ValueError("Bitcoin amounts must be nonnegative whole units")
        return value

    @field_validator(
        "other_assets_usd",
        "cash_usd",
        "liabilities_usd",
        "monthly_savings_usd",
        "monthly_purchase_usd",
        "monthly_spending_usd",
        "monthly_retirement_income_usd",
        "end_balance_usd",
    )
    @classmethod
    def dollars(cls, value):
        if to_minor(value, "USD") < 0:
            raise ValueError("USD amounts must be nonnegative, with at most two decimal places")
        return value

    @field_validator("price_usd")
    @classmethod
    def price(cls, value):
        rate_decimal(value)
        return value

    @field_validator("appreciation_pct", "other_return_pct", "usd_spending_change_pct", "bitcoin_cost_change_pct")
    @classmethod
    def rate(cls, value):
        if not D("-99") <= decimal(value) <= D("1000"):
            raise ValueError("Annual rates must be between -99% and 1000%")
        return value

    @model_validator(mode="after")
    def ages(self):
        if not self.current_age <= self.retirement_age < self.planning_age:
            raise ValueError("Retirement age must be at least current age and below planning age")
        if self.planning_age - self.current_age > 100:
            raise ValueError("The maximum planning horizon is 100 years")
        return self


def rounded(value, quantum=CENT):
    return value.quantize(quantum, rounding=ROUND_HALF_EVEN)


def amount(value, quantum=CENT):
    result = rounded(value, quantum)
    return format(abs(result) if result == 0 else result, "f")


def month_date(start, offset):
    import calendar

    index = start.year * 12 + start.month - 1 + offset
    year, month = index // 12, index % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1])).isoformat()


def project(inputs: ForecastInput):
    """Growth first; month-end contributions before retirement, spending after.

    Cash and other assets fund withdrawals before whole bitcoin units (ceiling).
    An excess from selling a whole base unit remains cash. Liabilities are settled
    at the opening price. Unmet obligations remain a shortfall, never borrowing.
    Spending changes from the as-of date, independently of retirement income.
    """
    try:
        with localcontext() as ctx:
            ctx.prec = 60
            return _project(inputs)
    except (DecimalException, OverflowError):
        raise ValueError("Scenario exceeds the supported projection range") from None


def _project(p):
    factors = {
        key: (ONE + decimal(getattr(p, key)) / 100) ** (ONE / 12)
        for key in ("appreciation_pct", "other_return_pct", "usd_spending_change_pct", "bitcoin_cost_change_pct")
    }
    price = decimal(p.price_usd)
    bitcoin = decimal(p.bitcoin)
    assets = decimal(p.other_assets_usd)
    cash = decimal(p.cash_usd)
    shortfall = D(0)
    depletion_month = None
    withdrawals_usd = withdrawals_bitcoin = spending_total = D(0)
    retire_month = (p.retirement_age - p.current_age) * 12
    months = (p.planning_age - p.current_age) * 12
    spend_usd = decimal(p.monthly_spending_usd)
    spend_bitcoin = decimal(p.monthly_spending_bitcoin)
    retirement = None
    rows = []

    def withdraw(needed, month):
        nonlocal bitcoin, cash, assets, shortfall, depletion_month, withdrawals_bitcoin, withdrawals_usd
        requested = needed
        taken = min(cash, needed)
        cash -= taken
        needed -= taken
        taken = min(assets, needed)
        assets -= taken
        needed -= taken
        units = min(bitcoin, (needed * BASE / price).to_integral_value(rounding=ROUND_CEILING))
        bitcoin -= units
        proceeds = units * price / BASE
        covered = min(needed, proceeds)
        cash += proceeds - covered
        missing = needed - covered
        withdrawals_bitcoin += units
        withdrawals_usd += requested - missing
        if missing > 0:
            shortfall += missing
            if depletion_month is None:
                depletion_month = month

    def point(month, spending=D(0)):
        return {
            "month": month,
            "date": month_date(p.as_of, month),
            "age": format(D(p.current_age) + D(month) / 12, ".2f"),
            "bitcoin": amount(bitcoin, ONE),
            "price_usd": format(price, ".8f"),
            "other_assets_usd": amount(assets),
            "cash_usd": amount(cash),
            "portfolio_usd": amount(assets + cash + bitcoin * price / BASE),
            "portfolio_bitcoin": amount((assets + cash) * BASE / price + bitcoin, ONE),
            "annual_spending_usd": amount(spending * 12),
            "annual_spending_bitcoin": amount(spending * 12 * BASE / price, ONE),
            "withdrawals_usd": amount(withdrawals_usd),
            "withdrawals_bitcoin": amount(withdrawals_bitcoin, ONE),
            "shortfall_usd": amount(shortfall),
        }

    withdraw(decimal(p.liabilities_usd), 0)
    rows.append(point(0))
    if retire_month == 0:
        retirement = point(0, spend_usd if p.spending_model == "USD" else spend_bitcoin * price / BASE)
    for month in range(1, months + 1):
        price *= factors["appreciation_pct"]
        if price < D(".00000001"):
            raise ValueError("Projected price falls below the supported precision; reduce the decline or horizon")
        assets = rounded(assets * factors["other_return_pct"])
        spend_usd *= factors["usd_spending_change_pct"]
        spend_bitcoin *= factors["bitcoin_cost_change_pct"]
        spending = spend_usd if p.spending_model == "USD" else spend_bitcoin * price / BASE
        if month <= retire_month:
            assets += decimal(p.monthly_savings_usd)
            # Only explicitly designated bitcoin purchases acquire bitcoin.
            budget = decimal(p.monthly_purchase_usd)
            bought = (budget * BASE / price).to_integral_value(rounding=ROUND_FLOOR)
            bitcoin += bought
            cash += budget - bought * price / BASE
        else:
            spending_total += spending
            income = decimal(p.monthly_retirement_income_usd)
            if income >= spending:
                cash += rounded(income - spending)
            else:
                withdraw(spending - income, month)
        if max(price, assets, cash, bitcoin, shortfall) > MAX_PROJECTION:
            raise ValueError("Scenario exceeds the supported projection range; reduce rates or horizon")
        if month == retire_month:
            retirement = point(month, spending)
        if month % 12 == 0 or month == months:
            rows.append(point(month, spending))
    end = rows[-1]
    value = assets + cash + bitcoin * price / BASE
    target_gap = value - decimal(p.end_balance_usd)
    return {
        "assumptions": p.model_dump(mode="json"),
        "retirement": retirement,
        "end": end,
        "history": rows,
        "sustainable": shortfall == 0 and target_gap >= 0,
        "depletion_date": month_date(p.as_of, depletion_month) if depletion_month is not None else None,
        "depletion_age": format(D(p.current_age) + D(depletion_month) / 12, ".2f")
        if depletion_month is not None
        else None,
        "shortfall_usd": amount(shortfall),
        "target_surplus_usd": amount(target_gap),
        "total_spending_usd": amount(spending_total),
    }


def earliest_retirement(inputs):
    for age in range(inputs.current_age, inputs.planning_age):
        result = project(inputs.model_copy(update={"retirement_age": age}))
        if result["sustainable"]:
            return {"age": age, "date": result["retirement"]["date"]}
    return {"age": None, "date": None}
