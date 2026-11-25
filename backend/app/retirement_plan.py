"""The retirement screen: what the ledger records, the owner's few choices, and the answer built from both.

Reads the ledger and never writes to it. The owner's choices live in preferences.
"""

import json
from collections import Counter
from dataclasses import replace
from datetime import date
from decimal import Decimal, localcontext
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import select
from . import accounting as ledger
from . import retirement as calc
from .auth import authenticate
from .bitcoin_history import BAD_STARTS, END, MONTHLY
from .dashboard import active_bills, buys_by_month, monthly_minor
from .db import get_db
from .forecasting import month_date
from .models import Account, BillOccurrence, Category, ExpenseCost, RecurringBill
from .money import BASE, convert, original, to_minor
from .recurring import normalized_name
from .reports import accounts_report, month_days
from .schemas import RetirementSettings, StrictModel

D = Decimal
router = APIRouter(prefix="/api/planning/retirement", dependencies=[Depends(authenticate)])

YEARS_SHOWN = 10
ONE_OFF_CANDIDATES = 8
EXTRA_BUY = 10_000  # cents
OTHER_INCOME = 150_000  # cents
RUNWAY_GOALS = (1, 2, 5, 10, 20)  # years
NO_BIRTH_DATE_YEARS = 100
WANT_SHARE, FIXED_SHARE = D("0.05"), D("0.01")
# US money supply (M2), October 2016 to October 2026, seasonally adjusted: 13,124.5 to 23,532.8 billion dollars.
# Source: Federal Reserve Bank of St. Louis (FRED, series M2SL), retrieved 24 November 2026.
MONEY_SUPPLY_PCT = "6.0"


class DraftInput(StrictModel):
    settings: RetirementSettings
    # Levers the owner has ticked to see what they would do. Nothing is saved.
    trying: list[str] = Field(default_factory=list, max_length=20)


# ---------- What the ledger records ----------


def month_index(day):
    return day.year * 12 + day.month - 1


def month_first(index):
    return date(index // 12, index % 12 + 1, 1)


def month_last(index):
    return month_days(f"{index // 12:04d}-{index % 12 + 1:02d}")[1]


def expenses(db, today):
    """Every recorded expense before this month, with dollars and bitcoin at its own purchase date."""
    accounts = {acc.id: acc for acc in db.scalars(select(Account))}
    costs = {cost.entry_id: cost for cost in db.scalars(select(ExpenseCost))}
    rows = []
    for entry in ledger.active_transactions(db, None, month_last(month_index(today) - 1)):
        if entry.kind != "expense":
            continue
        currency = accounts[entry.account_id].currency
        cost = costs.get(entry.id)
        if cost:
            rate = cost.usd_per_btc
        else:
            reference = ledger.reporting_rate(db, entry)
            rate = reference["value"] if reference["basis"] != "current_estimate" else None
        usd = convert(entry.amount_minor, currency, "USD", rate)
        bitcoin = convert(entry.amount_minor, currency, "BITCOIN", rate)
        rows.append(
            {
                "id": entry.id,
                "date": entry.date,
                "month": month_index(date.fromisoformat(entry.date)),
                "description": entry.description,
                "category_id": entry.category_id,
                "cents": None if usd is None else to_minor(usd, "USD"),
                "bitcoin": None if bitcoin is None else int(bitcoin),
            }
        )
    return rows


def recorded_months(db, rows, today):
    """(first, last) complete months on record, or None. A ledger begun in a month's first days counts that month."""
    if not rows:
        return None
    start = date.fromisoformat(min(row["date"] for row in rows))
    first = month_index(start) + (0 if start.day <= 7 else 1)
    last = month_index(today) - 1
    return (first, last) if first <= last else None


def twelve_months(rows, span, left_out):
    """Spending by category over the last 12 complete months, or as many as there are."""
    if span is None:
        return 0, {}, 0
    first = max(span[0], span[1] - 11)
    by_category, missing = {}, 0
    for row in rows:
        if row["month"] < first or row["id"] in left_out:
            continue
        if row["cents"] is None:
            missing += 1
            continue
        by_category[row["category_id"]] = by_category.get(row["category_id"], 0) + row["cents"]
    return span[1] - first + 1, by_category, missing


def yearly_totals(rows, span, left_out):
    """Back-to-back 12-month totals ending with the last complete month, oldest first."""
    result = []
    if span is None:
        return result
    end = span[1]
    while end - 11 >= span[0] and len(result) < YEARS_SHOWN:
        inside = [row for row in rows if end - 11 <= row["month"] <= end and row["id"] not in left_out]
        usd = [row["cents"] for row in inside]
        bitcoin = [row["bitcoin"] for row in inside]
        result.append(
            {
                "year": month_last(end).year,
                "start": str(month_first(end - 11)),
                "end": str(month_last(end)),
                "usd": None if None in usd else original(sum(usd), "USD"),
                "bitcoin": None if None in bitcoin else str(sum(bitcoin)),
            }
        )
        end -= 12
    return result[::-1]


def own_trend(years, measure_from):
    """The owner's own yearly change in dollar costs, from the years they chose, once there are two in full."""
    chosen = [row for row in years if measure_from is None or row["year"] >= measure_from]
    # Only an unbroken run of complete years ending now can be measured.
    run = []
    for row in reversed(chosen):
        if row["usd"] is None or D(row["usd"]) <= 0:
            break
        run.insert(0, row)
    rate = calc.yearly_trend([D(row["usd"]) for row in run])
    return None if rate is None else {"rate": rate, "years": len(run), "from": run[0]["year"]}


def spending(db, rows, span, settings):
    """Dollars a month (in cents) that retirement has to pay for, and where the figure comes from."""
    left_out = set(settings.left_out_entries)
    months, by_category, missing = twelve_months(rows, span, left_out)
    names = {category.id: category.name for category in db.scalars(select(Category))}
    categories, kept = [], D(0)
    for category_id, total in sorted(by_category.items(), key=lambda item: (-item[1], item[0])):
        monthly = D(total) / months
        share = settings.category_shares.get(category_id, 100)
        kept += monthly * share / 100
        categories.append(
            {
                "id": category_id,
                "name": names.get(category_id, "Uncategorised"),
                "monthly_usd": cents_text(monthly),
                "share": share,
            }
        )
    waiting = D(0)
    if months < 12:
        # A short record misses bills that come round less often than it is long.
        seen = {row["id"] for row in rows}
        paid = {row.bill_id for row in db.scalars(select(BillOccurrence)) if row.entry_id in seen}
        for bill, amount in expense_bills(db):
            if months == 0 or (bill.frequency in ("yearly", "semiannual", "quarterly") and bill.id not in paid):
                waiting += amount
    recorded = kept + waiting
    if settings.monthly_spending_usd is not None:
        basis, value = "entered", D(to_minor(settings.monthly_spending_usd, "USD"))
    elif months >= 12:
        basis, value = "record", recorded
    elif months:
        basis, value = "early", recorded
    else:
        basis, value = ("bills" if waiting else "none"), recorded
    return {
        "value": value,
        "recorded": recorded,
        "basis": basis,
        "months": months,
        "missing": missing,
        "categories": categories,
    }


def expense_bills(db):
    """Active bills that are spending, with their dollars a month. Debt payments are handled with the debt."""
    result = []
    for bill in active_bills(db):
        if bill.pays_account_id:
            continue
        account = db.get(Account, bill.account_id)
        if account.currency != "USD":
            continue
        result.append((bill, D(monthly_minor(to_minor(bill.amount, "USD"), bill.frequency))))
    return result


def debts(db, accounts):
    """What is owed and what is being paid off each month, in cents."""
    paid = {}
    for bill in db.scalars(
        select(RecurringBill).where(RecurringBill.archived.is_(False), RecurringBill.pays_account_id.is_not(None))
    ):
        if db.get(Account, bill.account_id).currency == "USD":
            amount = monthly_minor(to_minor(bill.amount, "USD"), bill.frequency)
            paid[bill.pays_account_id] = paid.get(bill.pays_account_id, 0) + amount
    result = []
    for account in accounts:
        if account["holding_type"] != "debt" or account["archived"] or account["usd"] is None:
            continue
        owed = to_minor(account["usd"], "USD")
        if owed > 0:
            result.append({"name": account["name"], "owed": owed, "paid": paid.get(account["id"], 0)})
    return result


def monthly_purchase(db, span, today):
    """Dollars of bitcoin bought a month (in cents), averaged over up to 12 complete months on record."""
    if span is None:
        return D(0), 0
    first = max(span[0], span[1] - 11)
    total = sum(
        row["usd"]
        for key, row in buys_by_month(db, month_last(span[1])).items()
        if month_index(date.fromisoformat(key + "-01")) >= first
    )
    months = span[1] - first + 1
    return D(total) / months, months


def one_off_candidates(db, rows, span, left_out):
    """The largest entries of the last 12 months, plus anything already left out, so either can be changed."""
    if span is None:
        return []
    recent = [row for row in rows if row["month"] > span[1] - 12 and row["cents"] is not None]
    # A bill, or anything paid four times a year, is ordinary spending however large it is.
    billed = set(db.scalars(select(BillOccurrence.entry_id)))
    times = Counter(normalized_name(row["description"]) for row in recent)
    recent = [
        row
        for row in recent
        if row["id"] in left_out or (row["id"] not in billed and times[normalized_name(row["description"])] < 4)
    ]
    chosen = sorted(recent, key=lambda row: (-row["cents"], -row["id"]))[:ONE_OFF_CANDIDATES]
    shown = {row["id"] for row in chosen}
    chosen += [row for row in rows if row["id"] in left_out and row["id"] not in shown and row["cents"] is not None]
    return [
        {
            "id": row["id"],
            "date": row["date"],
            "description": row["description"],
            "usd": original(row["cents"], "USD"),
            "left_out": row["id"] in left_out,
        }
        for row in chosen
    ]


# ---------- The owner's choices ----------


def age_months(birth, today):
    months = month_index(today) - month_index(birth)
    return months - 1 if today.day < birth.day else months


def load_settings(user):
    return RetirementSettings(**(json.loads(user.preferences).get("retirement") or {}))


def check_settings(settings, today):
    if settings.birth_date:
        months = age_months(settings.birth_date, today)
        if settings.birth_date > today or months > 119 * 12:
            raise HTTPException(422, "Enter a birth date between 119 years ago and today")
        if settings.last_age * 12 <= months:
            raise HTTPException(422, "The money must last past your age today")


# ---------- The answer ----------


def cents_text(value):
    return original(int(D(value).to_integral_value()), "USD")


def pct(value, places="0.1"):
    return None if value is None else format(D(value).quantize(D(places)), "f")


def levers(db, plan, spend, settings):
    """Changes the owner could make, biggest first within each kind. Each returns a changed plan."""
    result = []

    def cut(p, dollars):
        lower = replace(p, spending=max(D(0), p.spending - dollars))
        return replace(lower, purchase=lower.purchase + dollars) if settings.freed_to_bitcoin else lower

    extra = D(EXTRA_BUY) / 100
    result.append(
        ("buy", f"Buy ${extra:,.0f} more bitcoin a month", lambda p: replace(p, purchase=p.purchase + extra), False)
    )
    types = {category.id: category.spending_type for category in db.scalars(select(Category))}
    wants = [row for row in spend["categories"] if types.get(row["id"]) == "discretionary" and row["share"] > 0]
    if wants:
        half = D(wants[0]["monthly_usd"]) / 2
        label = f"Cut {wants[0]['name']} in half (${half:,.0f} a month)"
        result.append((f"half-{wants[0]['id']}", label, lambda p, half=half: cut(p, half), True))
    # Nobody is told to destroy the rent or the electric bill: wants up to 5% of spending, fixed costs only when tiny
    # (a gym, a streaming service), and nothing essential or in a category that holds a large bill.
    bills = [(bill, amount / 100) for bill, amount in expense_bills(db)]
    heavy = {bill.category_id for bill, amount in bills if amount > plan.spending * WANT_SHARE}

    def small_enough(bill, amount):
        kind = types.get(bill.category_id)
        share = WANT_SHARE if kind in ("discretionary", "unclassified") else FIXED_SHARE if kind == "fixed" else D(0)
        return bill.category_id not in heavy and 0 < amount <= plan.spending * share

    small = [row for row in bills if small_enough(*row)]
    for bill, amount in sorted(small, key=lambda item: (-item[1], item[0].id))[:3]:
        label = f"Destroy {bill.description} (${amount:,.0f} a month)"
        result.append((f"bill-{bill.id}", label, lambda p, amount=amount: cut(p, amount), True))
    result.append(
        ("less", "Live on 10% less once you stop", lambda p: replace(p, spending=p.spending * D("0.9")), False)
    )
    if plan.income == 0:
        income = D(OTHER_INCOME) / 100
        label = f"Count ${income:,.0f} a month of other income from {plan.income_age}"
        result.append(("income", label, lambda p: replace(p, income=income), False))
    return result


def whole(months):
    return None if months is None else int(months)


def runway_now(plan):
    """What the stack covers if the owner stopped today, with nothing more bought."""
    w = calc.paths(plan)
    flat = calc.runway(calc.paths(replace(plan, growth=D(0), cost_rise=D(0), trend=None)), 0)
    return {"months": whole(calc.runway(w, 0)), "flat_months": whole(flat)}


def runway_path(plan, w, at, today):
    """Runway at each age the owner could stop, and the first age it reaches each length."""
    last = plan.months - 12
    end = max(0, min(last, (at if at is not None else last) + 24))
    base = [calc.runway(w, k) for k in range(end + 1)]

    points = [
        {
            "month": k,
            "age": age_text(plan, k),
            "date": month_date(today, k),
            "months": whole(base[k]),
            "exact_months": pct(base[k]),
            "left_months": plan.months - k,
        }
        for k in range(end + 1)
        if k % 6 == 0 or k in (at, end)
    ]

    def reached(months):
        # The first month from which it never drops back below this length.
        short = [k for k, value in enumerate(base) if value is not None and value < months]
        k = short[-1] + 1 if short else 0
        return None if k > end else {"month": k, "age": (plan.age_months + k) // 12}

    now = base[0]
    goals = [] if now is None else [years * 12 for years in RUNWAY_GOALS if now < years * 12 < plan.months]
    miles = [{"months": months, "stop": reached(months)} for months in goals]
    return {"points": points, "milestones": miles}


def runway_before(db, settings, plan, spend, years, today):
    """Runway a year ago, worked out from that day's stack, price, debts and year of spending."""
    if spend["basis"] != "record" or settings.category_shares or len(years) < 2 or years[-2]["usd"] is None:
        return None
    day = month_first(month_index(today) - 12).replace(day=min(today.day, 28)).isoformat()
    rate = ledger.current_rate(db, day)
    if rate is None:
        return None
    accounts = accounts_report(db, day)
    held = sum(int(a["balance"]) for a in accounts if a["holding_type"] == "bitcoin" and not a["archived"])
    if held <= 0:
        return None
    then = replace(
        plan,
        bitcoin=D(held),
        price=D(rate.usd_per_btc),
        spending=D(to_minor(years[-2]["usd"], "USD")) / 1200,
        debts=tuple((D(row["owed"]) / 100, D(row["paid"]) / 100) for row in debts(db, accounts)),
    )
    return {"date": day, "months": whole(calc.runway(calc.paths(then), 0)), "price_usd": rate.usd_per_btc}


def point(plan, w, k, today):
    months = plan.age_months + k
    return {
        "month": k,
        "age": months // 12,
        "date": month_date(today, k),
        "bitcoin": calc.down(w.stack[k]),
        "need": calc.up(w.need[k] + w.debt[k]),
        "first_year_pct": pct(calc.first_year_share(w, k)),
        "first_month_bitcoin": calc.up(w.net[k + 1] * BASE / w.price[k + 1]),
    }


def age_text(plan, k):
    return format((D(plan.age_months + k) / 12).quantize(D("0.01")), "f")


def series(plan, k, left, out):
    return {
        "points": [
            {"age": age_text(plan, k + i), "bitcoin": calc.down(value)}
            for i, value in enumerate(left)
            if i % 3 == 0 or i == len(left) - 1
        ],
        "out_age": None if out is None else (plan.age_months + out) // 12,
    }


def after_stopping(plan, w, k):
    return series(plan, k, *calc.spend_down(w, k))


def crashes(plan, w, k):
    """How long the stack lasts if bitcoin crashes right after the owner stops at k. A null month is a halving."""
    shapes = [(None, calc.HALVED), *((f"{year}-{month:02d}", s) for (year, month), s in zip(BAD_STARTS, calc.SHAPES))]
    rows = []
    for month, shape in shapes:
        months = whole(calc.runway(w, k, shape))
        rows.append(
            {
                "month": month,
                "runway_months": months,
                "out_age": None if months is None else (plan.age_months + k + months) // 12,
            }
        )
    return rows


def crossing(plan, w, at, today):
    """The stack and the stack needed, by age, a little past where they cross."""
    last = plan.months - 12
    end = min(last, max(144, (at if at is not None else last) + 96))
    result = []
    for k in range(0, end + 1):
        if k % 6 and k not in (at, end):
            continue
        result.append(
            {
                "month": k,
                "age": age_text(plan, k),
                "date": month_date(today, k),
                "stack": calc.down(w.stack[k]),
                "need": calc.up(w.need[k] + w.debt[k]),
            }
        )
    return result


def bitcoin_record():
    rows = []
    for years in (4, 5, 8, 10):
        rate = (D(MONTHLY[-1]) / MONTHLY[-1 - 12 * years]) ** (D(1) / years) - 1
        rows.append({"years": years, "pct": pct(rate * 100)})
    return {"through": f"{END[0]}-{END[1]:02d}", "rows": rows}


def build(db, settings, trying=(), today=None):
    today = today or date.today()
    with localcontext() as ctx:
        ctx.prec = calc.PRECISION
        return _build(db, settings, set(trying), today)


def _build(db, settings, trying, today):
    rows = expenses(db, today)
    span = recorded_months(db, rows, today)
    left_out = set(settings.left_out_entries)
    years = yearly_totals(rows, span, left_out)
    trend = own_trend(years, settings.measure_from)
    spend = spending(db, rows, span, settings)
    accounts = accounts_report(db)
    owed = debts(db, accounts)
    bitcoin = sum(
        int(account["balance"])
        for account in accounts
        if account["holding_type"] == "bitcoin" and not account["archived"]
    )
    rate = ledger.current_rate(db)
    recorded_buy, buy_months = monthly_purchase(db, span, today)
    buy = (
        D(to_minor(settings.monthly_purchase_usd, "USD")) if settings.monthly_purchase_usd is not None else recorded_buy
    )
    view = {
        "as_of": str(today),
        "settings": settings.model_dump(mode="json"),
        "money_supply_pct": MONEY_SUPPLY_PCT,
        "bitcoin_record": bitcoin_record(),
        "ledger": {
            "bitcoin": str(bitcoin),
            "price_usd": rate.usd_per_btc if rate else None,
            "rate_source": rate.source if rate else None,
            "rate_day": rate.day if rate else None,
            "debts": [
                {
                    "name": row["name"],
                    "owed_usd": original(row["owed"], "USD"),
                    "monthly_usd": original(row["paid"], "USD"),
                }
                for row in owed
            ],
            "purchase_usd": cents_text(buy),
            "recorded_purchase_usd": cents_text(recorded_buy),
            "purchase_months": buy_months,
            "spending_usd": cents_text(spend["value"]),
            "recorded_spending_usd": cents_text(spend["recorded"]),
            "spending_basis": spend["basis"],
            "spending_months": spend["months"],
            "spending_missing": spend["missing"],
            "categories": spend["categories"],
            "one_offs": one_off_candidates(db, rows, span, left_out),
            "years": years,
            "trend": trend and {"pct": pct(trend["rate"] * 100), "years": trend["years"], "from": trend["from"]},
        },
        "today": None,
        "runway": None,
        "answer": None,
    }
    if rate is None:
        return view | {"status": "needs_price"}
    if spend["basis"] == "none":
        return view | {"status": "needs_spending"}
    price, value = D(rate.usd_per_btc), spend["value"] / 100
    worth = D(bitcoin) * price / BASE
    view["today"] = {
        "worth_usd": cents_text(worth * 100),
        "year_usd": cents_text(value * 1200),
        "year_bitcoin": calc.up(value * 12 * BASE / price),
        "covered_months": None if value <= 0 else int(worth / value),
        "year_share_pct": None if worth <= 0 else pct(value * 1200 / worth),
    }
    if settings.growth_pct is None:
        return view | {"status": "needs_growth"}
    use_trend = settings.use_record and trend is not None
    # Runway needs no birth date: without one it looks a hundred years ahead and counts no other income.
    known_age = settings.birth_date is not None
    plan = calc.Plan(
        age_months=age_months(settings.birth_date, today) if known_age else 0,
        last_age=settings.last_age if known_age else NO_BIRTH_DATE_YEARS,
        bitcoin=D(bitcoin),
        price=price,
        spending=value,
        purchase=buy / 100,
        growth=D(settings.growth_pct) / 100,
        cost_rise=D(settings.cost_rise_pct) / 100,
        trend=trend["rate"] if use_trend else None,
        trend_years=trend["years"] if use_trend else 0,
        tax=D(settings.tax_pct) / 100,
        income=D(settings.other_income_usd) if known_age else D(0),
        income_age=settings.other_income_age,
        debts=tuple((D(row["owed"]) / 100, D(row["paid"]) / 100) for row in owed),
    )
    if not known_age:
        view["runway"] = runway_now(plan) | {"before": runway_before(db, settings, plan, spend, years, today)}
        return view | {"status": "needs_birth_date"}
    options = levers(db, plan, spend, settings)
    known = {option[0] for option in options}
    trying &= known
    tried = plan
    for id, _, change, _ in options:
        if id in trying:
            tried = change(tried)
    w, at, safe = calc.solve(tried)
    view["runway"] = (
        runway_now(tried)
        | {"before": runway_before(db, settings, plan, spend, years, today)}
        | runway_path(tried, w, at, today)
    )
    answer = {
        "state": "funded" if at == 0 else "not_yet",
        "age_today": plan.age_months // 12,
        "first": None if at is None else point(tried, w, at, today),
        "safe": None if safe is None else point(tried, w, safe, today),
        "chart": crossing(tried, w, at, today),
        "levers": [],
        "crashes": [] if at is None else crashes(tried, w, at),
        "after": None if at is None else after_stopping(tried, w, at),
        "price_path": [],
    }
    for id, label, change, frees in options:
        other = plan
        for other_id, _, other_change, _ in options:
            if other_id in trying and other_id != id:
                other = other_change(other)
        before, after = calc.solve(other), calc.solve(change(other))
        without, with_ = before[1], after[1]
        short, long = calc.runway(before[0], 0), calc.runway(after[0], 0)
        answer["levers"].append(
            {
                "id": id,
                "label": label,
                "applied": id in trying,
                "frees_money": frees,
                "runway_days": None if short is None or long is None else int((long - short) * 365 / 12),
                "runway_for_life": short is not None and long is None,
                "months_sooner": None if with_ is None or without is None else without - with_,
                "reaches_age": None if with_ is None or without is not None else (plan.age_months + with_) // 12,
            }
        )
    rise = calc.monthly_factor(tried.cost_rise)
    today_dollars = [w.price[k] / rise**k for k in range(len(w.price))]
    answer["price_path"] = [
        {"age": age_text(tried, k), "usd": cents_text(today_dollars[k] * 100)}
        for k in range(len(w.price))
        if k % 12 == 0 or k == len(w.price) - 1
    ]
    answer["price_in"] = [
        {"years": years, "usd": cents_text(today_dollars[years * 12] * 100)}
        for years in (10, 20, 30)
        if years * 12 < len(today_dollars)
    ]
    projected, cost = [], tried.spending
    own = calc.monthly_factor(tried.trend) if use_trend else rise
    for year in range(1, min(5, tried.trend_years or 3) + 1):
        total = D(0)
        for _ in range(12):
            cost *= own
            total += cost
        projected.append({"year": (years[-1]["year"] if years else today.year) + year, "usd": cents_text(total * 100)})
    answer["projected_years"] = projected
    needed = w.need[0] + w.debt[0]
    view["today"]["funded_pct"] = "100.0" if needed <= 0 else pct(min(D(100), tried.bitcoin * 100 / needed))
    hurdle = calc.hurdle(tried)
    view["today"]["hurdle_pct"] = None if hurdle is None else pct(hurdle * 100)
    return view | {"status": "ready", "answer": answer}


# ---------- Routes ----------


@router.get("")
def read(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return build(db, load_settings(user))


@router.post("/draft")
def draft(data: DraftInput, db=Depends(get_db, scope="function")):
    """Work out an answer from changed choices without saving them."""
    check_settings(data.settings, date.today())
    return build(db, data.settings, data.trying)


@router.put("")
def save(data: RetirementSettings, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    check_settings(data, date.today())
    prefs = json.loads(user.preferences)
    prefs["retirement"] = data.model_dump(mode="json")
    user.preferences = json.dumps(prefs)
    # The audit trail notes that the plan changed, not the owner's birth date or amounts.
    ledger.audit(db, "settings.retirement", user.id, {"fields": sorted(data.model_fields_set)})
    return build(db, data)
