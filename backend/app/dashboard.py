"""The dashboard reading: cash ahead, bills, the bitcoin stack, spending pace and debt.

Reading never posts. Paycheck schedules, card terms and bill links are plain records
beside the journal; only paying a debt off creates a journal entry.
"""

import calendar
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy import func, select

from . import accounting as ledger
from . import recurring
from .auth import authenticate
from .db import get_db
from .models import (
    Account,
    AuditEvent,
    BillOccurrence,
    CardTerms,
    Category,
    ExchangeRate,
    ExpenseCost,
    IncomeSchedule,
    JournalEntry,
    Posting,
    PriceQuote,
    RecurringBill,
)
from .money import BASE, convert, original, rate_decimal, to_minor
from .reports import EVERYDAY_KINDS, accounts_report, budget_overview, flow, month_days, month_sequence
from .schemas import StrictModel, TransactionInput

router = APIRouter(prefix="/api", dependencies=[Depends(authenticate)])

HORIZON_DAYS = 30
COVERED_DAYS_CAP = 60
HISTORY_MONTHS = 6
# Months in one period, as an exact fraction: a weekly bill is 52 payments over 12 months.
MONTHLY_SHARE = {
    "once": (0, 1),
    "weekly": (52, 12),
    "monthly": (1, 1),
    "quarterly": (1, 3),
    "semiannual": (1, 6),
    "yearly": (1, 12),
}


# ---------- Small exact helpers ----------


def percent(part, whole):
    """One decimal place, half-even."""
    with localcontext() as ctx:
        ctx.prec = 60
        return format((Decimal(part) * 100 / Decimal(whole)).quantize(Decimal("0.1"), rounding=ROUND_HALF_EVEN), "f")


def usd_minor(amount_minor, currency, rate):
    """Cents for an amount in either currency; None when the conversion is missing."""
    if currency == "USD":
        return amount_minor
    value = convert(amount_minor, currency, "USD", rate)
    return None if value is None else to_minor(value, "USD")


def total_usd(values):
    values = list(values)
    return None if any(value is None for value in values) else original(sum(values), "USD")


def monthly_minor(amount_minor, frequency):
    """A bill's cost per month in its own minor units, half-even."""
    numerator, denominator = MONTHLY_SHARE[frequency]
    with localcontext() as ctx:
        ctx.prec = 60
        share = Decimal(amount_minor) * numerator / denominator
        return int(share.quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def month_key(index):
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def day_in_month(year, month, day):
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_day_of_month(today, day):
    """The next date that falls on ``day`` (clamped to the month), today included."""
    candidate = day_in_month(today.year, today.month, day)
    if candidate >= today:
        return candidate
    year, month = divmod(today.year * 12 + today.month, 12)
    return day_in_month(year, month + 1, day)


# ---------- Projection: bills and paychecks ----------


def bill_dates(bill, today, end):
    """Unpaid due dates through ``end``, without changing the saved schedule.

    Only the saved next due date can be overdue. Later occurrences are projected
    from it and kept from today onward.
    """
    cursor = SimpleNamespace(
        frequency=bill.frequency, next_due=bill.next_due, anchor_day=bill.anchor_day, anchor_month=bill.anchor_month
    )
    first = True
    while True:
        due = date.fromisoformat(cursor.next_due)
        if due > end:
            return
        if first or due >= today:
            yield due
        first = False
        following = recurring.advance(cursor)
        if following is None:
            return
        cursor.next_due = following


def semimonthly_days(anchor_day):
    return (anchor_day, anchor_day + 15) if anchor_day <= 15 else (anchor_day - 15, anchor_day)


def paycheck_dates(schedule, after, end):
    """Expected pay dates later than ``after``, through ``end``.

    A schedule never posts, so a date that has passed is assumed received and
    the schedule simply continues from its saved first date.
    """
    first = date.fromisoformat(schedule.next_date)
    if schedule.frequency in ("weekly", "biweekly"):
        step = 7 if schedule.frequency == "weekly" else 14
        behind = (after - first).days
        day = first + timedelta(days=(behind // step + 1) * step) if behind >= 0 else first
        while day <= end:
            yield day
            day += timedelta(days=step)
        return
    days = (schedule.anchor_day,) if schedule.frequency == "monthly" else semimonthly_days(schedule.anchor_day)
    start = max(first, after + timedelta(days=1))
    for index in range(start.year * 12 + start.month - 1, end.year * 12 + end.month):
        year, month = divmod(index, 12)
        for day in sorted({day_in_month(year, month + 1, value) for value in days}):
            if start <= day <= end:
                yield day


def active_bills(db):
    return list(
        db.scalars(
            select(RecurringBill)
            .where(RecurringBill.archived.is_(False))
            .order_by(RecurringBill.next_due, RecurringBill.id)
        )
    )


def active_schedules(db):
    return list(
        db.scalars(select(IncomeSchedule).where(IncomeSchedule.archived.is_(False)).order_by(IncomeSchedule.id))
    )


def everyday_accounts(db):
    return list(
        db.scalars(
            select(Account)
            .where(
                Account.internal.is_(False),
                Account.archived.is_(False),
                Account.role == "asset",
                Account.currency == "USD",
                Account.kind.in_(EVERYDAY_KINDS),
                Account.exclude_from_liquid_usd.is_(False),
            )
            .order_by(Account.id)
        )
    )


# ---------- Sections ----------


def price(db, today):
    rate = ledger.current_rate(db, today)
    if not rate:
        return None
    with localcontext() as ctx:
        ctx.prec = 60
        value = rate_decimal(rate.usd_per_btc)
        per_usd = (Decimal(BASE) / value).quantize(Decimal(1), rounding=ROUND_HALF_EVEN)
        # At least two places; a finer saved reference is never rounded away.
        shown = value if -value.as_tuple().exponent >= 2 else value.quantize(Decimal("0.01"))
    return {
        "usd_per_btc": format(shown, "f"),
        "bitcoin_per_usd": format(per_usd, "f"),
        "source": rate.source,
        "day": rate.day,
        "observed_at": rate.observed_at,
        "stale": False if isinstance(rate, PriceQuote) else rate.day != str(today),
    }


def ammo(db, today):
    rows = [(acc, ledger.balance(db, acc.id, today)) for acc in everyday_accounts(db)]
    return {
        "total": original(sum(amount for _, amount in rows), "USD"),
        "accounts": [{"id": acc.id, "name": acc.name, "balance": original(amount, "USD")} for acc, amount in rows],
    }


def covered_days(bills, start, today):
    """Days of known bills the balance covers with no paycheck arriving."""
    if not bills:
        return None
    if start < 0:
        return 0
    end = today + timedelta(days=COVERED_DAYS_CAP)
    dues = sorted(
        (max(due, today), to_minor(bill.amount, "USD")) for bill in bills for due in bill_dates(bill, today, end)
    )
    remaining = start
    for day, amount in dues:
        remaining -= amount
        if remaining < 0:
            return max((day - today).days - 1, 0)
    return COVERED_DAYS_CAP


def cash_ahead(db, today):
    """Projected everyday balance: bills paid from, and paychecks landing in, everyday accounts."""
    accounts = everyday_accounts(db)
    all_bills = active_bills(db)
    result = {
        "status": "needs_account" if not accounts else "needs_bills" if not all_bills else "ready",
        "horizon_days": HORIZON_DAYS,
        "start": "0.00",
        "events": [],
        "next_paycheck": None,
        "due_before_paycheck": "0.00",
        "low": {"date": str(today), "balance": "0.00"},
        "short": None,
        "covered_days": None,
    }
    if not accounts:
        return result
    ids = {acc.id for acc in accounts}
    start = sum(ledger.balance(db, id, today) for id in ids)
    end = today + timedelta(days=HORIZON_DAYS)
    bills = [bill for bill in all_bills if bill.account_id in ids]
    schedules = [schedule for schedule in active_schedules(db) if schedule.account_id in ids]
    events = []
    for bill in bills:
        amount = to_minor(bill.amount, "USD")
        for due in bill_dates(bill, today, end):
            events.append(
                (
                    (max(due, today), 0, due, bill.id),
                    -amount,
                    {
                        "kind": "bill",
                        "date": str(max(due, today)),
                        "name": bill.description,
                        "amount": original(amount, "USD"),
                        "balance_after": None,
                        "overdue": due < today,
                        "bill_id": bill.id,
                    },
                )
            )
    upcoming = []
    for schedule in schedules:
        amount = to_minor(schedule.amount, "USD")
        # Every frequency repeats within a month, so two months always reach the next one.
        reach = max(end + timedelta(days=HORIZON_DAYS), date.fromisoformat(schedule.next_date))
        for day in paycheck_dates(schedule, today, reach):
            upcoming.append((day, schedule.id, schedule.name, amount))
            if day > end:
                break
            events.append(
                (
                    (day, 1, day, schedule.id),
                    amount,
                    {
                        "kind": "paycheck",
                        "date": str(day),
                        "name": schedule.name,
                        "amount": original(amount, "USD"),
                        "balance_after": None,
                        "schedule_id": schedule.id,
                    },
                )
            )
    events.sort(key=lambda event: event[0])
    following = min(upcoming, default=None)
    cutoff = following[0] if following else end
    running, due_before = start, 0
    low = (start, today)
    deepest, short_on = min(start, 0), today if start < 0 else None
    before_paycheck = True
    for (day, order, _, _), change, row in events:
        running += change
        row["balance_after"] = original(running, "USD")
        before_paycheck = before_paycheck and order == 0
        if order == 0 and day <= cutoff:
            due_before += -change
        if before_paycheck and running < low[0]:
            low = (running, day)
        if running < 0:
            short_on = short_on or day
            deepest = min(deepest, running)
    result.update(
        start=original(start, "USD"),
        events=[row for _, _, row in events],
        next_paycheck={"date": str(following[0]), "name": following[2], "amount": original(following[3], "USD")}
        if following
        else None,
        due_before_paycheck=original(due_before, "USD"),
        low={"date": str(low[1]), "balance": original(low[0], "USD")},
        short={"date": str(short_on), "amount": original(-deepest, "USD")} if short_on else None,
        covered_days=covered_days(bills, start, today),
    )
    return result


def paid_this_month(db, today):
    """Recorded bill payments dated this month whose entry, or its correction, still stands."""
    month = today.strftime("%Y-%m")
    reversed_ids = set(db.scalars(select(JournalEntry.reverses_id).where(JournalEntry.reverses_id.is_not(None))))
    corrections = dict(
        db.execute(
            select(JournalEntry.replaces_id, JournalEntry.id)
            .where(JournalEntry.replaces_id.is_not(None))
            .order_by(JournalEntry.id)
        ).all()
    )
    values = []
    for entry_id in db.scalars(select(BillOccurrence.entry_id)):
        seen = set()
        while entry_id in corrections and entry_id not in seen:
            seen.add(entry_id)
            entry_id = corrections[entry_id]
        entry = db.get(JournalEntry, entry_id)
        if (
            entry is None
            or entry.kind != "expense"
            or entry.status != "posted"
            or entry.id in reversed_ids
            or entry.date[:7] != month
            or entry.date > str(today)
        ):
            continue
        currency = db.get(Account, entry.account_id).currency
        values.append(usd_minor(entry.amount_minor, currency, ledger.reporting_rate(db, entry)["value"]))
    return {"count": len(values), "total": total_usd(values)}


def bills_section(db, today, rate):
    items, week, month = [], [], []
    for bill in active_bills(db):
        acc = db.get(Account, bill.account_id)
        amount = to_minor(bill.amount, acc.currency)
        due = date.fromisoformat(bill.next_due)
        debt = db.get(Account, bill.pays_account_id) if bill.pays_account_id else None
        items.append(
            {
                "id": bill.id,
                "name": bill.description,
                "amount": original(amount, acc.currency),
                "currency": acc.currency,
                "due_date": bill.next_due,
                "days_until": (due - today).days,
                "overdue": due < today,
                "frequency": bill.frequency,
                "monthly_amount": original(monthly_minor(amount, bill.frequency), acc.currency),
                "account_id": acc.id,
                "account": acc.name,
                "category": db.get(Category, bill.category_id).name,
                "pays_account_id": debt.id if debt else None,
                "payoff": original(-ledger.balance(db, debt.id, today), debt.currency) if debt else None,
            }
        )
        value = usd_minor(amount, acc.currency, rate)
        for occurrence in bill_dates(bill, today, today + timedelta(days=HORIZON_DAYS)):
            month.append(value)
            if occurrence <= today + timedelta(days=7):
                week.append(value)
    freed = []
    for bill in db.scalars(select(RecurringBill).where(RecurringBill.destroyed_on.is_not(None))):
        currency = db.get(Account, bill.account_id).currency
        freed.append(usd_minor(monthly_minor(to_minor(bill.amount, currency), bill.frequency), currency, rate))
    return {
        "items": items,
        "next_7": total_usd(week),
        "next_30": total_usd(month),
        "paid_this_month": paid_this_month(db, today),
        "destroyed": {"count": len(freed), "monthly_freed": total_usd(freed)},
    }


def buys_by_month(db, today):
    """Dollars exchanged for bitcoin between the owner's own asset accounts, by month."""
    accounts = {acc.id: acc for acc in db.scalars(select(Account))}
    months = {}
    for entry in ledger.active_transactions(db, None, today):
        if entry.kind != "transfer" or not entry.destination_id:
            continue
        source, destination = accounts[entry.account_id], accounts[entry.destination_id]
        if (
            source.currency == "USD"
            and destination.currency == "BITCOIN"
            and source.role == destination.role == "asset"
        ):
            row = months.setdefault(entry.date[:7], {"count": 0, "usd": 0, "bitcoin": 0})
            row["count"] += 1
            row["usd"] += entry.amount_minor
            row["bitcoin"] += entry.destination_minor
    return months


def stack_rate(db, month, today, buys):
    first, last = month_days(month)
    income = flow(db, first, min(last, today), "USD")["income"]
    if income is None or Decimal(income) <= 0:
        return None
    return percent(Decimal(buys.get(month, {"usd": 0})["usd"]) / 100, income)


def milestone(held):
    """The round steps either side of the stack: two leading digits, at least 1,000 apart."""
    held = max(held, 0)
    step = max(10 ** (len(str(held)) - 2), 1000)
    previous = held // step * step
    return {"previous": str(previous), "next": str(previous + step)}


def streak_months(buys, today):
    index = today.year * 12 + today.month - 1
    if month_key(index) not in buys:
        index -= 1
    count = 0
    while month_key(index) in buys:
        count += 1
        index -= 1
    return count


def stack(db, today, first_entry):
    month = today.strftime("%Y-%m")
    rows = [
        row for row in accounts_report(db, str(today), "BITCOIN", historical=True) if row["holding_type"] == "bitcoin"
    ]
    ids = [row["id"] for row in rows]
    ready = any(not row["archived"] for row in rows)

    def held_on(day):
        return sum(ledger.balance(db, id, day) for id in ids)

    buys = buys_by_month(db, today)
    held = held_on(today)
    month_start = held_on(today.replace(day=1) - timedelta(days=1))
    current = buys.get(month, {"count": 0, "usd": 0, "bitcoin": 0})
    months = [key for key in month_sequence(today, HISTORY_MONTHS) if first_entry and key >= first_entry[:7]]
    best = max(sorted(buys), key=lambda key: buys[key]["bitcoin"], default=None)
    return {
        "status": "ready" if ready else "needs_bitcoin",
        "held": str(held),
        "month_start": str(month_start),
        "gained": str(held - month_start),
        "buys": {
            "count": current["count"],
            "usd": original(current["usd"], "USD"),
            "bitcoin": str(current["bitcoin"]),
        },
        "stack_rate": stack_rate(db, month, today, buys),
        "rates": [{"month": key, "rate": stack_rate(db, key, today, buys)} for key in months],
        "history": [{"month": key, "held": str(held_on(min(month_days(key)[1], today)))} for key in months],
        "milestone": milestone(held) if ready else None,
        "streak_months": streak_months(buys, today),
        "best_month": {"month": best, "bitcoin": str(buys[best]["bitcoin"])} if best else None,
    }


def pace_series(db, start, end):
    """Cumulative spending per day in both units, the expense count, and how many lack a conversion."""
    days = (end - start).days + 1
    daily = {"USD": [0] * days, "BITCOIN": [0] * days}
    unknown_from = {"USD": days, "BITCOIN": days}
    expenses = missing = 0
    for entry in ledger.active_transactions(db, start, end):
        if entry.kind != "expense":
            continue
        expenses += 1
        index = (date.fromisoformat(entry.date) - start).days
        currency = db.get(Account, entry.account_id).currency
        cost = db.get(ExpenseCost, entry.id)
        for unit, saved in (("USD", cost.usd if cost else None), ("BITCOIN", cost.bitcoin if cost else None)):
            if currency == unit:
                daily[unit][index] += entry.amount_minor
            elif saved is not None:
                daily[unit][index] += to_minor(saved, unit)
            else:
                unknown_from[unit] = min(unknown_from[unit], index)
                missing += 1
    series = {}
    for unit, values in daily.items():
        running, series[unit] = 0, []
        for index, value in enumerate(values):
            running += value
            series[unit].append(original(running, unit) if index < unknown_from[unit] else None)
    return series, expenses, missing


def pace(db, today):
    first = today.replace(day=1)
    current, _, missing = pace_series(db, first, today)
    last_month_end = first - timedelta(days=1)
    previous, previous_count, _ = pace_series(db, last_month_end.replace(day=1), last_month_end)
    return {
        "day": today.day,
        "days_in_month": calendar.monthrange(today.year, today.month)[1],
        "current": current,
        "previous": previous if previous_count else None,
        "missing_conversions": missing,
    }


def debt(db, today):
    cards, loans = [], []
    window_start = str(month_days(month_sequence(today, HISTORY_MONTHS)[0])[1])
    accounts = db.scalars(
        select(Account)
        .where(Account.internal.is_(False), Account.archived.is_(False), Account.role == "liability")
        .order_by(Account.id)
    )
    for acc in accounts:
        owed = -ledger.balance(db, acc.id, today)
        row = {"account_id": acc.id, "name": acc.name, "balance": original(owed, acc.currency)}
        if acc.kind == "credit_card":
            terms = db.get(CardTerms, acc.id)
            limit = terms.credit_limit_minor if terms else None
            due_day = terms.due_day if terms else None
            cards.append(
                row
                | {
                    "limit": None if limit is None else original(limit, acc.currency),
                    "utilization": percent(max(owed, 0), limit) if limit else None,
                    "due_day": due_day,
                    "next_due": str(next_day_of_month(today, due_day)) if due_day else None,
                }
            )
            continue
        opened = db.scalar(
            select(func.min(JournalEntry.date))
            .join(Posting, Posting.entry_id == JournalEntry.id)
            .where(Posting.account_id == acc.id, JournalEntry.status == "posted")
        )
        change = None
        if opened and opened <= str(today):
            # Measured from the start of the history window, or from the day the debt was first recorded.
            since = max(window_start, opened)
            change = {"since": since, "amount": original(owed + ledger.balance(db, acc.id, since), acc.currency)}
        loans.append(row | {"change": change})
    return {"cards": cards, "loans": loans}


def budgets(db, today):
    return {
        "month_elapsed_percent": percent(today.day, calendar.monthrange(today.year, today.month)[1]),
        "items": [
            {
                "category_id": row["category_id"],
                "category": row["category"],
                "planned_usd": row["planned_usd"],
                # The overview reports an untouched category as a bare zero.
                "spent_usd": None if row["spent_usd"] is None else original(to_minor(row["spent_usd"], "USD"), "USD"),
                "percent": row["percent"],
            }
            for row in budget_overview(db, today.strftime("%Y-%m"))
            if row["planned_usd"] is not None
        ],
    }


def setup(db, has_account, has_bitcoin):
    return {
        "has_account": has_account,
        "has_paycheck": bool(active_schedules(db)),
        "has_bills": bool(active_bills(db)),
        "has_bitcoin": has_bitcoin,
        "has_price_source": ledger.selected_source(db) != "manual"
        or db.scalar(select(ExchangeRate.id).limit(1)) is not None,
        "has_backup": db.scalar(select(AuditEvent.id).where(AuditEvent.action == "backup.export").limit(1)) is not None,
    }


def build(db, today=None):
    today = today or date.today()
    first_entry = db.scalar(
        select(func.min(JournalEntry.date)).where(JournalEntry.status == "posted", JournalEntry.date <= str(today))
    )
    quote = price(db, today)
    cash = cash_ahead(db, today)
    holdings = stack(db, today, first_entry)
    return {
        "today": str(today),
        "month": today.strftime("%Y-%m"),
        "first_entry_date": first_entry,
        "days_of_history": (today - date.fromisoformat(first_entry)).days + 1 if first_entry else 0,
        "price": quote,
        "ammo": ammo(db, today),
        "cash_ahead": cash,
        "bills": bills_section(db, today, quote["usd_per_btc"] if quote else None),
        "stack": holdings,
        "pace": pace(db, today),
        "debt": debt(db, today),
        "budgets": budgets(db, today),
        "setup": setup(db, cash["status"] != "needs_account", holdings["status"] == "ready"),
    }


@router.get("/dashboard")
def read_dashboard(db=Depends(get_db, scope="function")):
    return build(db, date.today())


# ---------- Paycheck schedules ----------


class IncomeScheduleInput(StrictModel):
    account_id: int
    name: str = Field(min_length=1, max_length=120)
    amount: str = Field(min_length=1, max_length=40)
    frequency: Literal["weekly", "biweekly", "semimonthly", "monthly"]
    next_date: date

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Give the paycheck a name")
        return value.strip()


def schedule_dict(db, schedule, today=None):
    today = today or date.today()
    acc = db.get(Account, schedule.account_id)
    reach = max(today + timedelta(days=2 * HORIZON_DAYS), date.fromisoformat(schedule.next_date))
    return {
        "id": schedule.id,
        "account_id": acc.id,
        "account": acc.name,
        "currency": acc.currency,
        "name": schedule.name,
        "amount": schedule.amount,
        "frequency": schedule.frequency,
        "next_date": schedule.next_date,
        "next_occurrence": next((str(day) for day in paycheck_dates(schedule, today, reach)), None),
    }


def apply_schedule(db, schedule, data):
    acc = ledger.account(db, data.account_id)
    if acc.role != "asset":
        raise ValueError("Choose the account the paycheck lands in")
    amount = to_minor(data.amount, acc.currency)
    if amount <= 0:
        raise ValueError("Paycheck amount must be positive")
    if data.next_date.year < 1970:
        raise ValueError("Choose a pay date from 1970 onward")
    schedule.account_id, schedule.name = acc.id, data.name
    schedule.amount, schedule.frequency = original(amount, acc.currency), data.frequency
    schedule.next_date, schedule.anchor_day = str(data.next_date), data.next_date.day
    db.add(schedule)
    db.flush()
    return schedule


def get_schedule(db, id):
    schedule = db.get(IncomeSchedule, id)
    if not schedule or schedule.archived:
        raise HTTPException(404, "Paycheck schedule not found")
    return schedule


@router.get("/income-schedules")
def list_income_schedules(db=Depends(get_db, scope="function")):
    return [schedule_dict(db, schedule) for schedule in active_schedules(db)]


@router.post("/income-schedules")
def create_income_schedule(data: IncomeScheduleInput, db=Depends(get_db, scope="function")):
    schedule = apply_schedule(db, IncomeSchedule(), data)
    ledger.audit(db, "income_schedule.create", schedule.id, data.model_dump(mode="json"))
    return schedule_dict(db, schedule)


@router.put("/income-schedules/{id}")
def update_income_schedule(id: int, data: IncomeScheduleInput, db=Depends(get_db, scope="function")):
    schedule = apply_schedule(db, get_schedule(db, id), data)
    ledger.audit(db, "income_schedule.update", schedule.id, data.model_dump(mode="json"))
    return schedule_dict(db, schedule)


@router.delete("/income-schedules/{id}")
def archive_income_schedule(id: int, db=Depends(get_db, scope="function")):
    schedule = get_schedule(db, id)
    schedule.archived = True
    ledger.audit(db, "income_schedule.archive", schedule.id, {"name": schedule.name})
    return {"ok": True}


# ---------- Card terms ----------


class CardTermsInput(StrictModel):
    credit_limit: str | None = Field(default=None, min_length=1, max_length=40)
    due_day: int | None = Field(default=None, ge=1, le=31)


@router.put("/accounts/{id}/card-terms")
def save_card_terms(id: int, data: CardTermsInput, db=Depends(get_db, scope="function")):
    acc = db.get(Account, id)
    if not acc or acc.internal:
        raise HTTPException(404, "Account not found")
    if acc.kind != "credit_card":
        raise ValueError("Card terms apply to credit-card accounts only")
    limit = None if data.credit_limit is None else to_minor(data.credit_limit, acc.currency)
    if limit is not None and limit <= 0:
        raise ValueError("Credit limit must be positive")
    terms = db.get(CardTerms, acc.id)
    if terms is None:
        terms = CardTerms(account_id=acc.id)
        db.add(terms)
    terms.credit_limit_minor, terms.due_day = limit, data.due_day
    result = {
        "account_id": acc.id,
        "credit_limit": None if limit is None else original(limit, acc.currency),
        "due_day": data.due_day,
    }
    ledger.audit(db, "card_terms.save", acc.id, result)
    return result


# ---------- Bills that pay down a debt ----------


class PaysAccountInput(StrictModel):
    account_id: int | None


class PayOffInput(StrictModel):
    date: date


def destroy_bill(db, bill):
    """Retire a bill for good. Never posts; returns what it used to cost each month."""
    currency = db.get(Account, bill.account_id).currency
    freed = original(monthly_minor(to_minor(bill.amount, currency), bill.frequency), currency)
    bill.archived, bill.destroyed_on = True, str(date.today())
    return freed


@router.put("/recurring-bills/{id}/pays-account")
def link_bill_to_debt(id: int, data: PaysAccountInput, db=Depends(get_db, scope="function")):
    bill = recurring.get_bill(db, id)
    if data.account_id is not None:
        debt_account = ledger.account(db, data.account_id)
        if debt_account.role != "liability":
            raise ValueError("Choose the debt this bill pays down")
        if debt_account.currency != db.get(Account, bill.account_id).currency:
            raise ValueError("The bill and the debt must use the same currency")
    bill.pays_account_id = data.account_id
    ledger.audit(db, "recurring_bill.pays_account", bill.id, {"account_id": data.account_id})
    return recurring.bill_dict(db, bill) | {"pays_account_id": bill.pays_account_id}


@router.post("/recurring-bills/{id}/destroy")
def destroy_recurring_bill(id: int, db=Depends(get_db, scope="function")):
    bill = recurring.get_bill(db, id)
    freed = destroy_bill(db, bill)
    ledger.audit(db, "recurring_bill.destroy", bill.id, {"monthly_freed": freed})
    return {"monthly_freed": freed}


@router.post("/recurring-bills/{id}/pay-off")
def pay_off_recurring_bill(id: int, data: PayOffInput, db=Depends(get_db, scope="function")):
    bill = recurring.get_bill(db, id)
    if not bill.pays_account_id:
        raise ValueError("Link this bill to the debt it pays down first")
    if data.date > date.today():
        raise ValueError("Record payments on today or an earlier date")
    source = ledger.account(db, bill.account_id)
    debt_account = ledger.account(db, bill.pays_account_id)
    if debt_account.role != "liability" or debt_account.currency != source.currency:
        raise ValueError("The bill and the debt must use the same currency")
    owed = -ledger.balance(db, debt_account.id)
    if owed <= 0:
        raise HTTPException(409, "This debt has no balance left to pay off")
    if ledger.balance(db, source.id) < owed:
        raise HTTPException(409, f"{source.name} holds less than the {debt_account.name} balance")
    amount = original(owed, source.currency)
    entry = ledger.create_transaction(
        db,
        TransactionInput(
            date=data.date,
            kind="transfer",
            account_id=source.id,
            destination_id=debt_account.id,
            amount=amount,
            description=f"Paid off: {debt_account.name}",
        ),
    )
    freed = destroy_bill(db, bill)
    ledger.audit(
        db,
        "recurring_bill.pay_off",
        bill.id,
        {"entry_id": entry.id, "account_id": debt_account.id, "amount": amount, "monthly_freed": freed},
    )
    return {"entry_id": entry.id, "amount": amount, "monthly_freed": freed}
