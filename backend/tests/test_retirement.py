"""The retirement arithmetic on its own, with figures worked out separately."""

from dataclasses import replace
from decimal import Decimal as D
from app.bitcoin_history import BAD_STARTS, END, MONTHLY, index_of
from app.retirement import (
    HALVED,
    Plan,
    SHAPES,
    first_year_share,
    halved,
    hurdle,
    paths,
    replayed,
    runway,
    solve,
    spend_down,
    stress_need,
    yearly_trend,
)


def demo(**changes):
    """The 25-year-old demo person from the mockup the owner reviewed."""
    plan = Plan(
        age_months=25 * 12,
        last_age=95,
        bitcoin=D(23_529_352),
        price=D(61190),
        spending=D(3454),
        purchase=D(450),
        trend=yearly_trend([D(37750), D(37953), D(41450)]),
        trend_years=3,
        tax=D("0.10"),
    )
    return replace(plan, **changes)


def simple(**changes):
    return replace(
        Plan(age_months=45 * 12, last_age=95, bitcoin=D(500_000_000), price=D(100000), spending=D(3000)), **changes
    )


def ages(plan):
    _, at, safe = solve(plan)
    return tuple(None if k is None else (plan.age_months + k) // 12 for k in (at, safe))


def test_matches_the_reviewed_mockup():
    assert ages(demo()) == (43, 49)
    assert ages(demo(growth=D("0.10"))) == (56, 65)
    assert ages(demo(growth=D("0.12"))) == (49, 57)
    assert ages(demo(growth=D("0.20"))) == (37, 43)
    assert ages(demo(growth=D("0"))) == (91, 93)
    w, at, safe = solve(demo())
    assert round(first_year_share(w, at), 1) == D("10.4")
    assert round(first_year_share(w, safe), 1) == D("5.0")


def test_hurdle_agrees_with_the_existing_planner():
    assert round(hurdle(simple()) * 100, 1) == D("10.4")
    assert round(hurdle(simple(cost_rise=D(0))) * 100, 1) == D("7.2")
    assert round(hurdle(simple(trend=D(0), trend_years=5)) * 100, 1) == D("9.4")
    assert hurdle(simple(bitcoin=D(0))) is None
    assert hurdle(simple(bitcoin=D(1))) is None


def test_hand_worked_need_with_no_growth():
    # Twelve months of $1,000 at a flat $100,000 is 12 x 1,000,000 units.
    plan = simple(last_age=46, spending=D(1000), growth=D(0), cost_rise=D(0), bitcoin=D(12_000_000))
    w, at, _ = solve(plan)
    assert w.need[0] == 12_000_000 and at == 0
    left, out = spend_down(w, 0)
    assert out is None and left[-1] == 0
    assert solve(replace(plan, bitcoin=D(11_999_990)))[1] != 0


def test_tax_income_and_debt_change_the_need():
    plan = simple(last_age=46, spending=D(1000), growth=D(0), cost_rise=D(0))
    assert paths(replace(plan, tax=D("0.2"))).need[0] == 15_000_000
    assert paths(replace(plan, income=D(400), income_age=45)).need[0] == 7_200_000
    assert paths(replace(plan, income=D(400), income_age=90)).need[0] == 12_000_000
    # Income above cost never becomes negative selling.
    assert paths(replace(plan, income=D(5000), income_age=45)).need[0] == 0
    w = paths(replace(plan, debts=((D(1200), D(100)), (D(500), D(0)))))
    # A debt with a payment is paid off month by month; one with none comes out of the stack on the day.
    assert w.debt[0] == w.debt[6] == 500_000
    assert w.need[0] == 12_000_000 + 1_200_000
    assert w.need[6] == 6_000_000 + 600_000
    short = paths(replace(plan, debts=((D(250), D(100)),)))
    assert short.net[1:5] == [1100, 1100, 1050, 1000]


def test_own_trend_runs_only_as_long_as_the_record():
    w = paths(simple(trend=D(0), trend_years=2))
    assert w.net[24] == w.net[1]
    assert w.net[36] > w.net[24]
    assert round(w.net[36] / w.net[24], 6) == D("1.030000")


def test_trend_needs_two_positive_years():
    assert yearly_trend([D(100)]) is None
    assert yearly_trend([D(100), D(0)]) is None
    assert round(yearly_trend([D(100), D(110), D(121)]), 8) == D("0.1")
    assert round(yearly_trend([D(100), D(100)]), 8) == 0


def test_safe_age_survives_every_test_and_the_month_before_does_not():
    for growth in ("0.08", "0.12", "0.15", "0.25"):
        plan = demo(growth=D(growth))
        w, at, safe = solve(plan)
        assert at <= safe
        assert spend_down(w, at)[1] is None
        assert spend_down(w, safe, halved(w))[1] is None
        for shape in SHAPES:
            assert spend_down(w, safe, replayed(w, safe, shape))[1] is None
        assert w.stack[safe - 1] < stress_need(w, safe - 1)
        assert w.stack[at - 1] < w.need[at - 1] + w.debt[at - 1]


def test_direct_need_agrees_with_spending_down():
    w, _, safe = solve(demo(debts=((D(6000), D(0)),)))
    for shape in SHAPES:
        assert spend_down(w, safe, replayed(w, safe, shape))[1] is None
    assert spend_down(w, safe, halved(w))[1] is None


def test_runway_by_hand():
    # $1,000 a month at a flat $100,000: 3.5 months of a 3,500,000 stack.
    plan = simple(spending=D(1000), growth=D(0), cost_rise=D(0), bitcoin=D(3_500_000))
    w = paths(plan)
    assert runway(w, 0) == D("3.5")
    assert runway(w, 0, HALVED) == D("1.75")
    assert runway(w, 0, [D(1), D(1), D("0.5")]) == 1 + D("2.5") / 2
    # Growth lengthens it: 10% a month for a first month leaves 2,590,909 to sell at the next price.
    grown = runway(paths(replace(plan, growth=D("1.1") ** 12 - 1)), 0)
    held, months, price = D(3_500_000), 0, D(100000)
    while True:
        price *= D("1.1")
        cost = D(1000) * 100_000_000 / price
        if held < cost:
            break
        held -= cost
        months += 1
    assert abs(grown - (months + held / cost)) < D("0.0001")
    assert runway(paths(replace(plan, debts=((D(4000), D(0)),))), 0) == 0
    assert runway(paths(replace(plan, spending=D(0))), 0) is None


def test_runway_agrees_with_spending_down_and_reaches_life_at_both_ages():
    w, at, safe = solve(demo(debts=((D(6000), D(0)), (D(5000), D(200)))))
    for k in (0, 60, 150, at - 1, at, at + 30, safe - 1, safe):
        for shape, price in [((D(1),), None), (HALVED, halved(w)), *((s, replayed(w, k, s)) for s in SHAPES)]:
            out = spend_down(w, k, price)[1]
            months = runway(w, k, shape)
            assert (out is None) == (months is None)
            if out is not None:
                assert int(months) == max(0, out - k - 1)
    assert runway(w, at) is None and runway(w, at - 1) is not None
    lasts = [runway(w, safe - 1, shape) is None for shape in (HALVED, *SHAPES)]
    assert not all(lasts)


def test_never_funded_and_nothing_to_spend():
    assert ages(demo(bitcoin=D(0), purchase=D(0))) == (None, None)
    assert ages(demo(spending=D(0))) == (25, 25)
    assert solve(demo(last_age=25))[1] is None


def test_saved_prices_are_complete():
    assert len(MONTHLY) == index_of(*END) + 1
    assert all(MONTHLY[index_of(*month)] > 0 for month in BAD_STARTS)
