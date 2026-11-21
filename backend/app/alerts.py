"""Alert lights: advisory, caution and warning readings over the dashboard.

``evaluate`` is a pure function of a dashboard reading, a few extra facts and the
thresholds, so every trigger can be tested at its edge. Nothing here posts to the
ledger. See docs/dashboard-api.md for the response contract.
"""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_HALF_EVEN, Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import select

from . import accounting as ledger
from . import dashboard
from .auth import authenticate
from .db import get_db
from .models import AlertAcknowledgement, AlertSettings, AuditEvent, ExpenseCost, now
from .money import original, to_minor
from .price_sync import price_status
from .prices import parse_time
from .reports import flow
from .schemas import StrictModel

router = APIRouter(prefix="/api", dependencies=[Depends(authenticate)])

LIGHTS = [
    ("overdue", "Bill overdue"),
    ("cash", "Cash short"),
    ("card", "Card due"),
    ("pace", "Spend pace"),
    ("util", "Credit use"),
    ("allow", "Allowance"),
    ("price", "Price feed"),
    ("conv", "Missing price"),
    ("backup", "Backup"),
    ("stack", "No stack yet"),
]
RANK = {"advisory": 1, "caution": 2, "warning": 3}


class Switch(StrictModel):
    on: bool = True


class OverdueRule(Switch):
    warning_days: int = Field(3, ge=1, le=60)


class CashRule(Switch):
    warning_within_days: int = Field(7, ge=0, le=30)


class CardRule(Switch):
    advisory_days: int = Field(7, ge=0, le=30)
    caution_days: int = Field(2, ge=0, le=30)


class PaceRule(Switch):
    percent: int = Field(20, ge=1, le=500)
    dollars: int = Field(150, ge=0, le=1_000_000)
    from_day: int = Field(5, ge=1, le=28)


class CreditUseRule(Switch):
    caution_percent: int = Field(30, ge=1, le=100)
    warning_percent: int = Field(90, ge=1, le=200)


class AllowanceRule(Switch):
    advisory_percent: int = Field(90, ge=1, le=100)
    advisory_days_left: int = Field(7, ge=0, le=31)


class PriceRule(Switch):
    stale_minutes: int = Field(10, ge=1, le=1440)
    failing_minutes: int = Field(30, ge=1, le=10080)


class MissingPriceRule(Switch):
    caution_count: int = Field(10, ge=1, le=100_000)
    caution_age_days: int = Field(14, ge=1, le=3650)


class BackupRule(Switch):
    advisory_days: int = Field(14, ge=1, le=3650)
    caution_days: int = Field(30, ge=1, le=3650)
    grace_days: int = Field(7, ge=0, le=365)


class StackRule(Switch):
    by_day: int = Field(20, ge=1, le=28)


class Thresholds(StrictModel):
    """Defaults are chosen to stay quiet unless something needs a decision."""

    overdue: OverdueRule = OverdueRule()
    cash: CashRule = CashRule()
    card: CardRule = CardRule()
    pace: PaceRule = PaceRule()
    util: CreditUseRule = CreditUseRule()
    allow: AllowanceRule = AllowanceRule()
    price: PriceRule = PriceRule()
    conv: MissingPriceRule = MissingPriceRule()
    backup: BackupRule = BackupRule()
    stack: StackRule = StackRule()


def short_date(value):
    day = value if isinstance(value, date) else date.fromisoformat(value)
    return f"{day:%b} {day.day}"


def cents(value):
    return to_minor(value, "USD")


def dollars(minor):
    return original(minor, "USD")


def alert(id, level, magnitude, title, why, *, panel=None, facts=(), rows=(), advice=None, action=None):
    return {
        "id": id,
        "level": level,
        "magnitude": str(magnitude),
        "acknowledged": False,
        "panel": panel,
        "title": title,
        "why": why,
        "facts": list(facts),
        "rows": list(rows),
        "advice": advice,
        "action": action,
    }


def fact(label, value, unit="USD"):
    return {"label": label, "value": str(value), "unit": unit}


def row(name, note, value, unit="USD"):
    return {"name": name, "note": note, "value": str(value), "unit": unit}


def evaluate(reading, facts, thresholds=None):
    """Every alert that is active for this reading, in light order.

    ``facts`` carries what the dashboard reading does not: ``backup_days`` (None if never),
    ``price`` ({"automatic", "quote_age_minutes", "failing_minutes"}), ``missing``
    (expenses with no saved purchase-date price: date, name, amount, currency) and
    ``pace_rows`` (category increases against last month).
    """
    t = thresholds or Thresholds()
    today = date.fromisoformat(reading["today"])
    found = []

    # Bill overdue: a caution for the first days, because a payment may simply not be recorded yet.
    late = [bill for bill in reading["bills"]["items"] if bill["overdue"]]
    if t.overdue.on and late:
        late.sort(key=lambda bill: bill["days_until"])
        worst = -late[0]["days_until"]
        found.append(
            alert(
                "overdue",
                "warning" if worst >= t.overdue.warning_days else "caution",
                len(late),
                f"{late[0]['name']} was due {short_date(late[0]['due_date'])}"
                if len(late) == 1
                else f"{len(late)} bills are overdue",
                f"{worst} day{'' if worst == 1 else 's'} past due. Late fees start small and grow, "
                "and a lapse is harder to undo than a payment.",
                panel="bills",
                rows=[
                    row(
                        bill["name"],
                        f"{-bill['days_until']} day{'' if bill['days_until'] == -1 else 's'} late",
                        bill["amount"],
                        bill["currency"],
                    )
                    for bill in late
                ],
                action={"label": "Pay it now", "bill_id": late[0]["id"]},
            )
        )

    # Cash short: projected everyday balance goes below zero.
    cash = reading["cash_ahead"]
    if t.cash.on and cash["short"]:
        short = cash["short"]
        away = (date.fromisoformat(short["date"]) - today).days
        payday = cash["next_paycheck"]
        cutoff = payday["date"] if payday else str(today + timedelta(days=cash["horizon_days"]))
        found.append(
            alert(
                "cash",
                "warning" if away <= t.cash.warning_within_days else "caution",
                short["amount"],
                f"Checking runs short on {short_date(short['date'])}",
                f"The bills due before your {short_date(payday['date'])} paycheck add up to more than checking holds."
                if payday
                else "The bills due in the next 30 days add up to more than checking holds.",
                panel="cash",
                facts=[
                    fact("In checking", cash["start"]),
                    fact("Bills before payday" if payday else "Bills in 30 days", cash["due_before_paycheck"]),
                    fact("Short by", short["amount"]),
                ],
                rows=[
                    row(
                        event["name"], "overdue" if event.get("overdue") else short_date(event["date"]), event["amount"]
                    )
                    for event in cash["events"]
                    if event["kind"] == "bill" and not event.get("on_card") and event["date"] <= cutoff
                ],
                advice={
                    "text": f"Get at least {{value}} more into checking before {short_date(short['date'])}.",
                    "value": short["amount"],
                    "unit": "USD",
                },
                action={"label": "Move money in", "route": "accounts"},
            )
        )

    # Card due: a calm reminder that becomes a caution in the last days.
    due = []
    for card in reading["debt"]["cards"]:
        if card["next_due"] and cents(card["balance"]) > 0:
            away = (date.fromisoformat(card["next_due"]) - today).days
            if 0 <= away <= t.card.advisory_days:
                due.append((away, card))
    if t.card.on and due:
        due.sort(key=lambda item: item[0])
        away, card = due[0]
        found.append(
            alert(
                "card",
                "caution" if away <= t.card.caution_days else "advisory",
                t.card.advisory_days - away,
                f"{card['name']} payment is due {'today' if away == 0 else short_date(card['next_due'])}",
                "Paying by the due date avoids a late fee and interest on the whole balance.",
                panel="debt",
                rows=[row(item["name"], f"due {short_date(item['next_due'])}", item["balance"]) for _, item in due],
                action={"label": "Open accounts", "route": "accounts"},
            )
        )

    # Spend pace: needs both a ratio and a dollar floor, so one early shop cannot trigger it.
    pace = reading["pace"]
    if t.pace.on and pace["previous"] and pace["day"] >= t.pace.from_day:
        current = pace["current"]["USD"][pace["day"] - 1]
        before = pace["previous"]["USD"]
        prior = before[min(pace["day"], len(before)) - 1]
        if current is not None and prior is not None:
            now_minor, prior_minor = cents(current), cents(prior)
            over = now_minor - prior_minor
            if prior_minor > 0 and over * 100 >= prior_minor * t.pace.percent and over >= t.pace.dollars * 100:
                percent = (Decimal(over) * 100 / prior_minor).quantize(Decimal("0.1"), rounding=ROUND_HALF_EVEN)
                found.append(
                    alert(
                        "pace",
                        "caution",
                        percent,
                        "Spending is well ahead of last month",
                        f"You have spent {percent.quantize(Decimal(1), rounding=ROUND_HALF_EVEN)}% more than "
                        f"by day {pace['day']} of last month.",
                        panel="pace",
                        facts=[
                            fact("This month so far", current),
                            fact("Last month, same days", prior),
                            fact("Difference", dollars(over)),
                        ],
                        rows=facts.get("pace_rows", [])[:3],
                        action={"label": "See what changed", "route": "spending"},
                    )
                )

    # Credit use: the most-used card against the caution and warning lines.
    used = [card for card in reading["debt"]["cards"] if card["utilization"] is not None]
    if t.util.on and used:
        card = max(used, key=lambda item: Decimal(item["utilization"]))
        share = Decimal(card["utilization"])
        if share >= t.util.caution_percent:
            line = (Decimal(cents(card["limit"])) * t.util.caution_percent / 100).to_integral_value(
                rounding=ROUND_HALF_EVEN
            )
            to_pay = int((Decimal(cents(card["balance"])) - line).to_integral_value(rounding=ROUND_CEILING))
            found.append(
                alert(
                    "util",
                    "warning" if share >= t.util.warning_percent else "caution",
                    share,
                    f"{card['name']} is at {share.quantize(Decimal(1), rounding=ROUND_HALF_EVEN)}% of its limit",
                    "A balance this high costs interest and leaves little room for an emergency.",
                    panel="debt",
                    facts=[
                        fact("Balance", card["balance"]),
                        fact("Limit", card["limit"]),
                        fact("Used", card["utilization"], "percent"),
                    ],
                    advice={
                        "text": f"Pay {{value}} to get back under your {t.util.caution_percent}% line.",
                        "value": dollars(max(to_pay, 0)),
                        "unit": "USD",
                    },
                    action={"label": "Plan a payment", "route": "accounts"},
                )
            )

    # Allowance: over a category's dollar allowance, or nearly there with much of the month left.
    budgets = reading["budgets"]
    days_left = pace["days_in_month"] - pace["day"]
    over, near = [], []
    for item in budgets["items"]:
        if item["percent"] is None:
            continue
        share = Decimal(item["percent"])
        if share > 100:
            over.append((share, item))
        elif share >= t.allow.advisory_percent and days_left > t.allow.advisory_days_left:
            near.append((share, item))
    if t.allow.on and (over or near):
        listed = sorted(over or near, key=lambda pair: pair[0], reverse=True)
        share, top = listed[0]
        found.append(
            alert(
                "allow",
                "caution" if over else "advisory",
                share,
                f"{top['category']} is over its allowance"
                if over
                else f"{top['category']} has nearly used its allowance",
                f"{days_left} day{'' if days_left == 1 else 's'} of the month remain.",
                panel="budgets",
                rows=[
                    row(
                        item["category"],
                        f"{value.quantize(Decimal(1), rounding=ROUND_HALF_EVEN)}% of {item['planned_usd']}",
                        item["spent_usd"],
                    )
                    for value, item in listed
                ],
                action={"label": "Open spending", "route": "spending"},
            )
        )

    # Price feed: only when automatic prices are switched on. Manual mode never lights this.
    feed = facts.get("price") or {}
    if t.price.on and feed.get("automatic"):
        failing, age = feed.get("failing_minutes"), feed.get("quote_age_minutes")
        if failing is not None and failing >= t.price.failing_minutes:
            found.append(
                alert(
                    "price",
                    "caution",
                    failing,
                    "Automatic prices are not updating",
                    "New expenses cannot get a bitcoin price until the price source answers again. Nothing is guessed meanwhile.",
                    facts=[fact("Minutes failing", failing, "count")],
                    action={"label": "Open price settings", "route": "settings"},
                )
            )
        elif age is None or age >= t.price.stale_minutes:
            found.append(
                alert(
                    "price",
                    "advisory",
                    0 if age is None else age,
                    "The bitcoin price is out of date",
                    "Current values use the last saved price until a fresh one arrives.",
                    facts=[] if age is None else [fact("Minutes old", age, "count")],
                    action={"label": "Open price settings", "route": "settings"},
                )
            )

    # Missing price: expenses with no purchase-date bitcoin price. Shown as missing, never guessed.
    missing = facts.get("missing") or []
    if t.conv.on and missing:
        oldest = min(item["date"] for item in missing)
        aged = (today - date.fromisoformat(oldest)).days
        many = len(missing) >= t.conv.caution_count or aged >= t.conv.caution_age_days
        found.append(
            alert(
                "conv",
                "caution" if many else "advisory",
                len(missing),
                f"{len(missing)} expense{' has' if len(missing) == 1 else 's have'} no purchase-date bitcoin price",
                "Their bitcoin cost is shown as missing, never guessed. Totals that include them are marked partial "
                "until a dated price is saved.",
                rows=[
                    row(item["name"], short_date(item["date"]), item["amount"], item["currency"])
                    for item in sorted(missing, key=lambda item: item["date"])[:5]
                ],
                action={"label": "Review missing prices", "route": "settings"},
            )
        )

    # Backup: this ledger lives on one machine.
    age = facts.get("backup_days")
    if t.backup.on:
        never = age is None and reading["days_of_history"] >= max(t.backup.grace_days, 1)
        if never or (age is not None and age >= t.backup.advisory_days):
            found.append(
                alert(
                    "backup",
                    "caution" if never or age >= t.backup.caution_days else "advisory",
                    reading["days_of_history"] if never else age,
                    "This ledger has never been backed up" if never else f"Last encrypted backup was {age} days ago",
                    "This ledger lives only on this machine. A backup is the only copy that survives a failed disk.",
                    facts=[] if never else [fact("Days ago", age, "days")],
                    action={"label": "Back up now", "route": "settings"},
                )
            )

    # No stack yet: income has arrived this month and none of it has become bitcoin.
    stack = reading["stack"]
    if (
        t.stack.on
        and stack["status"] == "ready"
        and today.day >= t.stack.by_day
        and stack["buys"]["count"] == 0
        and stack["stack_rate"] is not None
    ):
        found.append(
            alert(
                "stack",
                "advisory",
                today.day,
                "No bitcoin stacked yet this month",
                "Bitcoin is your saving. Income has come in this month and none of it has been stacked.",
                panel="stack",
                action={"label": "Open Stack", "route": "stack"},
            )
        )
    return found


def is_acknowledged(found, saved):
    """Acknowledged until it gets worse: a higher level, or a larger magnitude at the same level."""
    if saved is None or RANK[found["level"]] > RANK.get(saved.level, 0):
        return False
    if RANK[found["level"]] < RANK[saved.level]:
        return True
    return Decimal(found["magnitude"]) <= Decimal(saved.magnitude)


def gather_facts(db, today, reading):
    """The few readings the dashboard does not already carry."""
    clock = datetime.now(timezone.utc)
    last_backup = db.scalar(
        select(AuditEvent.created_at)
        .where(AuditEvent.action == "backup.export")
        .order_by(AuditEvent.id.desc())
        .limit(1)
    )
    status = price_status(db)
    price = {"automatic": False}
    if status["source"] != "manual" and status["automatic"]:
        quote, history = status["quote"], status["history"] or {}
        observed = quote and (quote.get("observed_at") or quote.get("fetched_at"))
        failing = None
        if history.get("quote_error") or history.get("error"):
            since = history.get("last_success_at")
            failing = int((clock - parse_time(since)).total_seconds() // 60) if since else 10**6
        price = {
            "automatic": True,
            "quote_age_minutes": int((clock - parse_time(observed)).total_seconds() // 60) if observed else None,
            "failing_minutes": failing,
        }
    missing = []
    if reading["setup"]["has_price_source"]:
        costed = set(db.scalars(select(ExpenseCost.entry_id)))
        for entry in ledger.active_transactions(db):
            if entry.kind == "expense" and entry.id not in costed and entry.date <= str(today):
                account = ledger.account(db, entry.account_id, active=False)
                missing.append(
                    {
                        "date": entry.date,
                        "name": entry.description,
                        "amount": original(entry.amount_minor, account.currency),
                        "currency": account.currency,
                    }
                )
    return {
        "backup_days": (clock - parse_time(last_backup)).days if last_backup else None,
        "price": price,
        "missing": missing,
        "pace_rows": pace_rows(db, today),
    }


def pace_rows(db, today):
    """Categories that grew most against the same days of last month, in dollars."""
    first = today.replace(day=1)
    last_end = first - timedelta(days=1)
    last_start = last_end.replace(day=1)
    same_day = last_start.replace(day=min(today.day, last_end.day))
    now_totals = {c["name"]: c["value"] for c in flow(db, first, today, "USD")["categories"]}
    then_totals = {c["name"]: c["value"] for c in flow(db, last_start, same_day, "USD")["categories"]}
    grown = []
    for name, value in now_totals.items():
        earlier = then_totals.get(name, "0.00")
        if value is None or earlier is None:
            continue
        change = cents(value) - cents(earlier)
        if change > 0:
            grown.append((change, name))
    return [row(name, "more than last month", dollars(change)) for change, name in sorted(grown, reverse=True)]


def thresholds(db):
    saved = db.get(AlertSettings, 1)
    return Thresholds(**json.loads(saved.settings)) if saved else Thresholds()


def read(db, today=None):
    today = today or date.today()
    reading = dashboard.build(db, today)
    found = evaluate(reading, gather_facts(db, today, reading), thresholds(db))
    active = {item["id"] for item in found}
    saved = {ack.alert_id: ack for ack in db.scalars(select(AlertAcknowledgement))}
    for id, ack in saved.items():
        # A cleared alert forgets its acknowledgement, so the next occurrence is new.
        if id not in active:
            db.delete(ack)
    for item in found:
        item["acknowledged"] = is_acknowledged(item, saved.get(item["id"]))
    return {"lights": [{"id": id, "label": label} for id, label in LIGHTS], "active": found}


def acknowledge(db, items):
    for item in items:
        ack = db.get(AlertAcknowledgement, item["id"]) or AlertAcknowledgement(alert_id=item["id"])
        ack.level, ack.magnitude, ack.acknowledged_at = item["level"], item["magnitude"], now()
        db.add(ack)


@router.get("/alerts")
def read_alerts(db=Depends(get_db, scope="function")):
    return read(db)


@router.post("/alerts/acknowledge-all")
def acknowledge_all(db=Depends(get_db, scope="function")):
    serious = [item for item in read(db)["active"] if item["level"] != "advisory"]
    acknowledge(db, serious)
    ledger.audit(db, "alerts.acknowledge", "all", {"ids": [item["id"] for item in serious]})
    return {"acknowledged": [item["id"] for item in serious]}


@router.post("/alerts/{id}/acknowledge")
def acknowledge_one(id: str, db=Depends(get_db, scope="function")):
    item = next((item for item in read(db)["active"] if item["id"] == id), None)
    if item is None:
        raise HTTPException(404, "That alert is not active")
    acknowledge(db, [item])
    ledger.audit(db, "alerts.acknowledge", id, {"level": item["level"], "magnitude": item["magnitude"]})
    return {"acknowledged": [id]}


@router.get("/settings/alert-thresholds")
def read_thresholds(db=Depends(get_db, scope="function")):
    return thresholds(db).model_dump()


@router.put("/settings/alert-thresholds")
def save_thresholds(data: Thresholds, db=Depends(get_db, scope="function")):
    saved = db.get(AlertSettings, 1) or AlertSettings(id=1)
    saved.settings = json.dumps(data.model_dump())
    db.add(saved)
    ledger.audit(db, "settings.alert_thresholds", "alerts", data.model_dump())
    return data.model_dump()
