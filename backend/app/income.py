"""Income, tracked over time: who pays, how much, and whether it arrived.

A **source** is who pays: a job, a side gig, a kind of income. It is separate from the two things
that already existed. A *category* (Salary, Freelance) stays the kind of income, for reports. A
*pay schedule* is what a source is expected to pay and when, so each schedule belongs to one
source. Each income entry belongs to one source too. An entry is matched by its description the
first time that description is seen, and the match is remembered, so a rename or a merge sticks.

Every paycheck is converted at its own saved price. A paycheck with no saved price has no bitcoin
figure, and the month it is in says so; nothing is filled in from today's price.
"""

from datetime import date, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy import select
from . import accounting as ledger
from .auth import authenticate
from .db import get_db
from .models import Account, Category, IncomeEntrySource, IncomeSchedule, IncomeSource, IncomeSourceName, JournalEntry
from .money import convert, original, to_minor
from .schemas import StrictModel

router = APIRouter(prefix="/api/income", dependencies=[Depends(authenticate)])

MONTHS = 60  # five years
LEVEL_CHANGE = Decimal("0.02")  # a typical paycheck that moves less than this is not a raise or a cut
SAME_PAY = Decimal("0.01")  # two paychecks this close are the same pay
SHORT = Decimal("0.02")  # a paycheck this far under the expected amount is short
EARLY_DAYS, LATE_DAYS = 3, 6  # how far from its expected day a paycheck may land and still be that paycheck
MISSING_AFTER = 7  # days late before "late" becomes "missing"
MONTH_NAMES = "January February March April May June July August September October November December".split()


def name_key(text):
    return " ".join(text.split()).casefold()[:500]


def final(db, source):
    """The source a merged source's paychecks count under now."""
    seen = set()
    while source.merged_into_id and source.id not in seen:
        seen.add(source.id)
        source = db.get(IncomeSource, source.merged_into_id)
    return source


def source_named(db, text):
    """The source a description belongs to, made the first time the description is seen."""
    key = name_key(text)
    known = db.get(IncomeSourceName, key)
    if known:
        return final(db, db.get(IncomeSource, known.source_id))
    source = IncomeSource(name=" ".join(text.split())[:120] or "Income")
    db.add(source)
    db.flush()
    db.add(IncomeSourceName(name_key=key, source_id=source.id))
    db.flush()
    return source


def income_entries(db, today):
    return [entry for entry in reversed(ledger.active_transactions(db, None, today)) if entry.kind == "income"]


def sync(db, today=None):
    """Give every schedule and every income entry its source. Safe to run on every read."""
    today = today or date.today()
    for schedule in db.scalars(select(IncomeSchedule).where(IncomeSchedule.source_id.is_(None))):
        schedule.source_id = source_named(db, schedule.name).id
    linked = {row.entry_id: row.source_id for row in db.scalars(select(IncomeEntrySource))}
    for entry in income_entries(db, today):
        if entry.id in linked:
            continue
        # A corrected paycheck stays with the source of the entry it replaced.
        earlier, inherited = entry, None
        while earlier.replaces_id and inherited is None:
            inherited = linked.get(earlier.replaces_id)
            earlier = db.get(JournalEntry, earlier.replaces_id)
        source_id = inherited or source_named(db, entry.description).id
        db.add(IncomeEntrySource(entry_id=entry.id, source_id=source_id))
        linked[entry.id] = source_id
    db.flush()
    return linked


def month_name(day, today):
    """ "March", or "March 2024" when it was not this year."""
    return MONTH_NAMES[day.month - 1] + ("" if day.year == today.year else f" {day.year}")


def percent(new, old):
    change = abs(Decimal(new) / Decimal(old) - 1) * 100
    return format(change.quantize(Decimal(1) if change >= 1 else Decimal("0.1")), "f")


def pay_levels(checks):
    """The typical paycheck over time, as [(date, minor)], from amounts that repeat.

    One check with overtime, or one short week, is not a new level: a level is an amount that
    two of the next three checks repeat. Income that never repeats has no levels.
    """
    levels = []
    for index, (day, amount) in enumerate(checks):
        if amount <= 0:
            continue
        current = levels[-1][1] if levels else None
        if current is not None and abs(Decimal(amount) / current - 1) < LEVEL_CHANGE:
            continue
        following = [later for _, later in checks[index + 1 : index + 4]]
        repeats = sum(abs(Decimal(later) / amount - 1) <= SAME_PAY for later in following)
        if following and repeats >= min(2, len(following)):
            levels.append((day, amount))
    return levels


def step_back(schedule, day):
    """The expected pay date before ``day`` (schedules only run forward from their saved date)."""
    from .dashboard import day_in_month, semimonthly_days

    if schedule.frequency in ("weekly", "biweekly"):
        return day - timedelta(days=7 if schedule.frequency == "weekly" else 14)
    days = (schedule.anchor_day,) if schedule.frequency == "monthly" else semimonthly_days(schedule.anchor_day)
    index = day.year * 12 + day.month - 1
    for back in (index, index - 1):
        year, month = divmod(back, 12)
        for candidate in sorted({day_in_month(year, month + 1, value) for value in days}, reverse=True):
            if candidate < day:
                return candidate


def expected_dates(schedule, since, today):
    """Pay dates this schedule expected from ``since`` through today, oldest first."""
    from .dashboard import paycheck_dates

    anchor = date.fromisoformat(schedule.next_date)
    found = [day for day in paycheck_dates(schedule, since - timedelta(days=1), today)]
    day = anchor
    while day is not None and day >= since:
        if day <= today and day not in found:
            found.append(day)
        day = step_back(schedule, day)
    return sorted(set(found))


def expectations(db, schedule, checks, today, currency):
    """Each recent expected paycheck and what came in for it.

    Nothing is expected before the source's first recorded paycheck, so a schedule added today
    never reports months of "missing" pay from before the ledger began.
    """
    if not checks:
        return []
    since = max(checks[0]["day"], today - timedelta(days=75))
    wanted = to_minor(schedule.amount, currency)
    unused = [check for check in checks if check["day"] >= since - timedelta(days=EARLY_DAYS)]
    rows = []
    for due in expected_dates(schedule, since, today):
        near = [c for c in unused if -EARLY_DAYS <= (c["day"] - due).days <= LATE_DAYS]
        match = min(near, key=lambda c: abs((c["day"] - due).days)) if near else None
        if match:
            unused.remove(match)
            short = not schedule.varies and Decimal(match["minor"]) < wanted * (1 - SHORT)
            status = "short" if short else "received"
        else:
            overdue = (today - due).days
            status = "due" if overdue <= 0 else "late" if overdue < MISSING_AFTER else "missing"
        rows.append(
            {
                "date": str(due),
                "expected": schedule.amount,
                "actual": original(match["minor"], currency) if match else None,
                "received_on": str(match["day"]) if match else None,
                "status": status,
                "days_late": max((today - due).days, 0) if not match else 0,
                "short_by": original(wanted - match["minor"], currency) if match and status == "short" else None,
            }
        )
    return rows


def report(db, today=None):
    today = today or date.today()
    with ledger.bulk_read(db):
        links = sync(db, today)
        sources = {source.id: source for source in db.scalars(select(IncomeSource))}
        categories = {category.id: category.name for category in db.scalars(select(Category))}
        by_source, months, paychecks = {}, {}, []
        for entry in income_entries(db, today):
            account = db.get(Account, entry.account_id)
            source = final(db, sources[links[entry.id]])
            rate = ledger.entry_rate(db, entry)
            usd = convert(entry.amount_minor, account.currency, "USD", rate)
            bitcoin = convert(entry.amount_minor, account.currency, "BITCOIN", rate)
            check = {
                "id": entry.id,
                "day": date.fromisoformat(entry.date),
                "minor": entry.amount_minor,
                "currency": account.currency,
                "usd": usd,
                "bitcoin": bitcoin,
                "description": entry.description,
                "category": categories.get(entry.category_id),
                "source_id": source.id,
            }
            by_source.setdefault(source.id, []).append(check)
            paychecks.append(check)
            month = months.setdefault(entry.date[:7], {})
            for bucket in (month.setdefault("all", new_total()), month.setdefault(source.id, new_total())):
                add(bucket, usd, bitcoin)

    from .dashboard import schedule_dict, stack_history

    schedules = {}
    for schedule in db.scalars(select(IncomeSchedule).where(IncomeSchedule.archived.is_(False))):
        schedules.setdefault(final(db, sources[schedule.source_id]).id, []).append(schedule)
    saved = {row["month"]: row for row in stack_history(db, today)["months"]}

    changes, listed, problems = [], [], []
    for source in sources.values():
        if source.merged_into_id:
            continue
        checks = by_source.get(source.id, [])
        currency = checks[-1]["currency"] if checks else "USD"
        same = [(c["day"], c["minor"]) for c in checks if c["currency"] == currency]
        levels = pay_levels(same)
        for (_, before), (day, after) in zip(levels, levels[1:]):
            changes.append(
                change_row(source, "raise" if after > before else "cut", day, before, after, currency, today)
            )
        expected = []
        for schedule in schedules.get(source.id, []):
            account = db.get(Account, schedule.account_id)
            rows = expectations(
                db, schedule, [c for c in checks if c["currency"] == account.currency], today, account.currency
            )
            expected.append({"schedule": schedule_dict(db, schedule, today), "paychecks": rows[-6:]})
            trouble = next((row for row in reversed(rows) if row["status"] != "due"), None)
            if trouble and trouble["status"] != "received" and not source.ended_on:
                problems.append(trouble | {"source_id": source.id, "source": source.name, "currency": account.currency})
        year = [c for c in checks if c["day"] > today - timedelta(days=365)]
        listed.append(
            {
                "id": source.id,
                "name": source.name,
                "ended_on": source.ended_on,
                "category": checks[-1]["category"] if checks else None,
                "currency": currency,
                "paychecks": len(checks),
                "first_date": str(checks[0]["day"]) if checks else None,
                "last_date": str(checks[-1]["day"]) if checks else None,
                "typical": original(levels[-1][1], currency) if levels else None,
                "year": totals(year),
                "all_time": totals(checks),
                "expected": expected,
                "_levels": levels,
            }
        )
    changes += job_changes(listed, today)
    for row in listed:
        row.pop("_levels")
    listed.sort(
        key=lambda row: (row["ended_on"] is not None, -(Decimal(row["year"]["usd"] or 0)), row["name"].casefold())
    )

    first = paychecks[0]["day"] if paychecks else today
    start = max(first.year * 12 + first.month - 1, today.year * 12 + today.month - MONTHS)
    history = []
    for index in range(start, today.year * 12 + today.month):
        key = f"{index // 12:04d}-{index % 12 + 1:02d}"
        month = months.get(key, {})
        stack = saved.get(key, {})
        history.append(
            {
                "month": key,
                **closed(month.get("all", new_total())),
                "sources": {str(id): closed(total) for id, total in month.items() if id != "all"},
                "saved_usd": stack.get("paid_usd", "0.00"),
                "saved_bitcoin": stack.get("bought", "0"),
                "stack_rate": stack.get("stack_rate"),
            }
        )
    return {
        "today": str(today),
        "status": "ready" if paychecks else "needs_income",
        "months_of_history": len(history) if paychecks else 0,
        "sources": listed,
        "months": history,
        "changes": sorted(changes, key=lambda change: change["date"], reverse=True),
        "problems": problems,
        "recent": [
            {
                "id": check["id"],
                "date": str(check["day"]),
                "description": check["description"],
                "source_id": check["source_id"],
                "usd": check["usd"],
                "bitcoin": check["bitcoin"],
            }
            for check in reversed(paychecks[-12:])
        ],
    }


def new_total():
    return {"usd": Decimal(0), "bitcoin": Decimal(0), "missing_usd": 0, "missing_bitcoin": 0, "paychecks": 0}


def add(total, usd, bitcoin):
    total["paychecks"] += 1
    for unit, value in (("usd", usd), ("bitcoin", bitcoin)):
        if value is None:
            total[f"missing_{unit}"] += 1
        else:
            total[unit] += Decimal(value)


def closed(total):
    """A total as text. A unit with any paycheck missing its price has no total, only a count."""
    return {
        "usd": None if total["missing_usd"] else format(total["usd"], ".2f"),
        "bitcoin": None if total["missing_bitcoin"] else format(total["bitcoin"], ".0f"),
        "missing_usd": total["missing_usd"],
        "missing_bitcoin": total["missing_bitcoin"],
        "paychecks": total["paychecks"],
    }


def totals(checks):
    total = new_total()
    for check in checks:
        add(total, check["usd"], check["bitcoin"])
    return closed(total)


def change_row(source, kind, day, before, after, currency, today, text=None):
    share = percent(after, before)
    direction = "up" if after > before else "down"
    return {
        "date": str(day),
        "kind": kind,
        "source_id": source["id"] if isinstance(source, dict) else source.id,
        "source": source["name"] if isinstance(source, dict) else source.name,
        "percent": share,
        "direction": direction,
        "from": original(before, currency),
        "to": original(after, currency),
        "currency": currency,
        "text": text or f"Pay went {direction} {share}% in {month_name(day, today)}.",
    }


def job_changes(listed, today):
    """One source stopping as another starts, with typical pay on both sides, reads as a job change."""
    found = []
    for old in listed:
        if not old["_levels"] or not old["last_date"]:
            continue
        ended = date.fromisoformat(old["last_date"])
        for new in listed:
            if new is old or not new["_levels"] or new["currency"] != old["currency"]:
                continue
            began = date.fromisoformat(new["first_date"])
            if not 0 < (began - ended).days <= 45:
                continue
            before, after = old["_levels"][-1][1], new["_levels"][0][1]
            share, direction = percent(after, before), "up" if after > before else "down"
            text = f"Changed jobs in {month_name(began, today)}: a typical paycheck went {direction} {share}%."
            found.append(change_row(new, "job", began, before, after, new["currency"], today, text))
    return found


def problems(db, today=None):
    """Late, short or missing paychecks, for the dashboard alert."""
    return report(db, today)["problems"]


class SourceInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    ended_on: date | None = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Give the income source a name")
        return " ".join(value.split())


class MergeInput(StrictModel):
    into: int


class EntrySourceInput(StrictModel):
    source_id: int


def get_source(db, id):
    source = db.get(IncomeSource, id)
    if not source or source.merged_into_id:
        raise HTTPException(404, "Income source not found")
    return source


@router.get("")
def read_income(db=Depends(get_db, scope="function")):
    return report(db)


@router.put("/sources/{id}")
def update_source(id: int, data: SourceInput, db=Depends(get_db, scope="function")):
    sync(db)
    source = get_source(db, id)
    if data.ended_on and data.ended_on > date.today():
        raise ValueError("Choose today or an earlier day")
    taken = db.scalar(
        select(IncomeSource.id).where(
            IncomeSource.merged_into_id.is_(None), IncomeSource.id != id, IncomeSource.name.ilike(data.name)
        )
    )
    if taken:
        raise ValueError("Another income source already has that name. Merge them instead.")
    before = {"name": source.name, "ended_on": source.ended_on}
    source.name, source.ended_on = data.name, str(data.ended_on) if data.ended_on else None
    # The new name is remembered too, so income recorded under it lands here.
    if not db.get(IncomeSourceName, name_key(data.name)):
        db.add(IncomeSourceName(name_key=name_key(data.name), source_id=source.id))
    ledger.audit(db, "income_source.update", id, {"before": before, "after": data.model_dump(mode="json")})
    return {"ok": True}


@router.post("/sources/{id}/merge")
def merge_source(id: int, data: MergeInput, db=Depends(get_db, scope="function")):
    """Fold one source into another. Every paycheck, schedule and remembered name moves; nothing is deleted."""
    sync(db)
    source, into = get_source(db, id), get_source(db, data.into)
    if source.id == into.id:
        raise ValueError("Choose a different income source to merge into")
    for row in db.scalars(select(IncomeEntrySource).where(IncomeEntrySource.source_id == source.id)):
        row.source_id = into.id
    for row in db.scalars(select(IncomeSourceName).where(IncomeSourceName.source_id == source.id)):
        row.source_id = into.id
    for schedule in db.scalars(select(IncomeSchedule).where(IncomeSchedule.source_id == source.id)):
        schedule.source_id = into.id
    source.merged_into_id = into.id
    ledger.audit(db, "income_source.merge", id, {"name": source.name, "into": into.id, "into_name": into.name})
    return {"ok": True}


@router.put("/paychecks/{id}/source")
def move_paycheck(id: int, data: EntrySourceInput, db=Depends(get_db, scope="function")):
    sync(db)
    link = db.get(IncomeEntrySource, id)
    if not link:
        raise HTTPException(404, "Paycheck not found")
    before = link.source_id
    link.source_id = get_source(db, data.source_id).id
    ledger.audit(db, "income_source.move_paycheck", id, {"from": before, "to": link.source_id})
    return {"ok": True}
