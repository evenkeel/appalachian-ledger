"""When the owner's bitcoin can pay for their life: pure arithmetic, no database and no network.

Bitcoin is in whole units. Every figure is a Decimal; nothing here is rounded until it is shown.
Month 0 is today. Growth comes first each month, then a buy while working or a sale once stopped.
"""

from dataclasses import dataclass, field, replace
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext
from .bitcoin_history import BAD_STARTS, MONTHLY, index_of
from .money import BASE

D = Decimal
ONE = D(1)
PRECISION = 34


@dataclass(frozen=True)
class Plan:
    age_months: int  # whole months lived, today
    last_age: int  # the money must last until this birthday
    bitcoin: Decimal
    price: Decimal  # dollars per BTC
    spending: Decimal  # dollars a month, at today's prices
    purchase: Decimal = D(0)  # dollars of bitcoin bought a month, until stopping
    growth: Decimal = D("0.15")
    cost_rise: Decimal = D("0.03")
    trend: Decimal | None = None  # the owner's own yearly change in costs
    trend_years: int = 0
    tax: Decimal = D(0)  # share of every sale
    income: Decimal = D(0)  # dollars a month, at today's prices
    income_age: int = 67
    debts: tuple = field(default_factory=tuple)  # (owed, paid a month) in dollars

    @property
    def months(self):
        return max(0, self.last_age * 12 - self.age_months)


@dataclass(frozen=True)
class Paths:
    price: list
    net: list  # dollars to raise in each month once stopped: cost and debt payments less income, with tax added
    stack: list  # bitcoin held at each month while still working and buying
    need: list  # bitcoin that pays for every later month
    debt: list  # bitcoin that settles debts nothing is paying off


def monthly_factor(rate):
    return (ONE + rate) ** (ONE / 12)


def yearly_trend(values):
    """The steady yearly rate that best fits these yearly totals (a straight line through their logs)."""
    if len(values) < 2 or any(value <= 0 for value in values):
        return None
    with localcontext() as ctx:
        ctx.prec = PRECISION
        logs = [value.ln() for value in values]
        middle = D(len(values) - 1) / 2
        mean = sum(logs) / len(logs)
        top = sum((i - middle) * (y - mean) for i, y in enumerate(logs))
        bottom = sum((i - middle) ** 2 for i in range(len(logs)))
        return (top / bottom).exp() - 1


def paths(p):
    grow, rise = monthly_factor(p.growth), monthly_factor(p.cost_rise)
    own = monthly_factor(p.trend) if p.trend is not None else rise
    own_months = p.trend_years * 12 if p.trend is not None else 0
    price, cost, net, stack, prices = [p.price], p.spending, [D(0)], [p.bitcoin], ONE
    for k in range(1, p.months + 1):
        price.append(price[-1] * grow)
        cost *= own if k <= own_months else rise
        prices *= rise
        income = p.income * prices if p.age_months + k >= p.income_age * 12 else D(0)
        owed = sum((max(D(0), min(paid, total - paid * (k - 1))) for total, paid in p.debts), D(0))
        net.append(max(D(0), cost + owed - income) / (ONE - p.tax))
        stack.append(stack[-1] + p.purchase * prices * BASE / price[-1])
    need = [D(0)] * (p.months + 1)
    for k in range(p.months - 1, -1, -1):
        need[k] = need[k + 1] + net[k + 1] * BASE / price[k + 1]
    debt = [
        sum((owed for owed, paid in p.debts if paid <= 0), D(0)) / (ONE - p.tax) * BASE / price[k]
        for k in range(p.months + 1)
    ]
    return Paths(price, net, stack, need, debt)


def replay_need(w, k, shape):
    """Bitcoin needed at month k if the price then repeats `shape` before going back to its own growth."""
    last = min(len(shape) - 1, len(w.price) - 1 - k)
    total = sum((w.net[k + i] / shape[i] for i in range(1, last + 1)), D(0)) * BASE / w.price[k]
    return total + w.need[k + last] * w.price[k + last] / (w.price[k] * shape[last])


def shapes():
    result = []
    for year, month in BAD_STARTS:
        tail = MONTHLY[index_of(year, month) :]
        result.append([D(value) / tail[0] for value in tail])
    return result


SHAPES = shapes()


def stress_need(w, k):
    """Bitcoin that still lasts if the price halves for good at month k, or repeats any bad start."""
    return max([(w.need[k] + w.debt[k]) * 2] + [replay_need(w, k, shape) + w.debt[k] for shape in SHAPES])


def first_funded(w):
    return next((k for k in range(len(w.need) - 1) if w.stack[k] >= w.need[k] + w.debt[k]), None)


def first_safe(w, start):
    if start is None:
        return None
    for k in range(start, len(w.need) - 1):
        if w.stack[k] >= (w.need[k] + w.debt[k]) * 2 and w.stack[k] >= stress_need(w, k):
            return k
    return None


def solve(p):
    with localcontext() as ctx:
        ctx.prec = PRECISION
        w = paths(p)
        at = first_funded(w)
        return w, at, first_safe(w, at)


def spend_down(w, k, price=None):
    """Bitcoin left each month after stopping at k, and the month it ran out (None if it lasts)."""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        price = price or (lambda j: w.price[j])
        held = w.stack[k] - w.debt[k] * w.price[k] / price(k)
        left = [max(D(0), held)]
        if held < 0:
            return left, k
        for j in range(k + 1, len(w.price)):
            held -= w.net[j] * BASE / price(j)
            if held < -1:  # Less than one unit is rounding, not a shortfall.
                return left + [D(0)], j
            held = max(D(0), held)
            left.append(held)
        return left, None


def halved(w):
    return lambda j: w.price[j] / 2


def replayed(w, k, shape):
    last = len(shape) - 1

    def price(j):
        if j - k <= last:
            return w.price[k] * shape[j - k]
        return w.price[k] * shape[last] * w.price[j] / w.price[k + last]

    return price


HALVED = [D("0.5")]


def runway(w, k, shape=(ONE,)):
    """Months the stack pays for everything after stopping at k, or None if it lasts to the end.

    The price follows `shape` first (none by default), then grows as before. Part months count.
    """
    with localcontext() as ctx:
        ctx.prec = PRECISION
        price, end = w.price[k], len(w.price) - 1
        held = w.stack[k] - w.debt[k] / shape[0]
        if held < 0:
            return D(0)
        last = min(len(shape) - 1, end - k)
        for i in range(1, last + 1):
            cost = w.net[k + i] * BASE / (price * shape[i])
            if held < cost:
                return i - 1 + held / cost
            held -= cost
        # From here the price only grows, so what each later month takes is already added up in `need`.
        m = k + last
        held = held * price * shape[last] / w.price[m]
        if held + 1 >= w.need[m]:  # Less than one unit is rounding, not a shortfall.
            return None
        low, high = m, end
        while high - low > 1:
            middle = (low + high) // 2
            low, high = (middle, high) if w.need[m] - w.need[middle] <= held else (low, middle)
        return low - k + (held - (w.need[m] - w.need[low])) / (w.need[low] - w.need[high])


def first_year_share(w, k):
    """The share of the stack the first year takes, in percent."""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        if w.stack[k] <= 0:
            return None
        last = min(k + 12, len(w.price) - 1)
        return sum((w.net[j] * BASE / w.price[j] for j in range(k + 1, last + 1)), D(0)) * 100 / w.stack[k]


def hurdle(p):
    """Yearly bitcoin growth that would let today's stack last if the owner stopped today. None if out of reach."""
    with localcontext() as ctx:
        ctx.prec = PRECISION

        def lasts(rate):
            w = paths(replace(p, growth=rate, purchase=D(0)))
            return w.stack[0] >= w.need[0] + w.debt[0]

        low, high = D("-0.5"), ONE
        if p.bitcoin <= 0 or not lasts(high):
            return None
        if lasts(low):
            return low
        for _ in range(18):
            middle = (low + high) / 2
            low, high = (low, middle) if lasts(middle) else (middle, high)
        return high


def up(value):
    return format(value.to_integral_value(rounding=ROUND_CEILING), "f")


def down(value):
    return format(value.to_integral_value(rounding=ROUND_FLOOR), "f")
