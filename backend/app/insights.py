"""Savings goals, the review queue, payee rules, and the safe-to-spend reading."""

import json
from datetime import date, timedelta
from decimal import ROUND_CEILING, Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy import select
from .accounting import account as ledger_account
from .accounting import active_transactions, audit, balance, current_rate, reporting_rate
from .auth import authenticate
from .db import get_db
from .models import Account, Category, EntryReview, RecurringBill, SavingsGoal
from .money import convert, original, to_minor
from .reports import flow, month_days
from .schemas import StrictModel

router = APIRouter(prefix="/api", dependencies=[Depends(authenticate)])

GOAL_ACCOUNT_KINDS = {"savings", "checking", "cash", "bitcoin_wallet", "brokerage", "stock", "etf"}
EVERYDAY_KINDS = {"checking", "cash"}


# ---------- Savings goals ----------


class GoalInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    account_id: int
    target: str = Field(min_length=1, max_length=40)
    target_date: date | None = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Give the goal a name")
        return value.strip()


def months_left(today, target_date):
    """Whole months remaining, counting the current one; never less than one."""
    if not target_date:
        return None
    target = date.fromisoformat(target_date)
    return max((target.year - today.year) * 12 + target.month - today.month + 1, 1)


def allocate(db, goals, day=None):
    """Goals sharing an account fill in the order they were created."""
    remaining, saved = {}, {}
    for goal in sorted(goals, key=lambda g: g.id):
        if goal.account_id not in remaining:
            remaining[goal.account_id] = max(balance(db, goal.account_id, day), 0)
        saved[goal.id] = min(goal.target_minor, remaining[goal.account_id])
        remaining[goal.account_id] -= saved[goal.id]
    return saved


def monthly_need(target_minor, saved_minor, months):
    if months is None or saved_minor >= target_minor:
        return None if months is None else 0
    return int((Decimal(target_minor - saved_minor) / months).to_integral_value(rounding=ROUND_CEILING))


def goal_dicts(db):
    goals = list(db.scalars(select(SavingsGoal).order_by(SavingsGoal.id)))
    saved = allocate(db, goals)
    today = date.today()
    shared = {}
    for goal in goals:
        shared[goal.account_id] = shared.get(goal.account_id, 0) + 1
    result = []
    for goal in goals:
        acc = db.get(Account, goal.account_id)
        months = months_left(today, goal.target_date)
        need = monthly_need(goal.target_minor, saved[goal.id], months)
        result.append(
            {
                "id": goal.id,
                "name": goal.name,
                "account_id": acc.id,
                "account": acc.name,
                "currency": acc.currency,
                "target": original(goal.target_minor, acc.currency),
                "saved": original(saved[goal.id], acc.currency),
                "remaining": original(goal.target_minor - saved[goal.id], acc.currency),
                "percent": format((Decimal(saved[goal.id]) * 100 / goal.target_minor).quantize(Decimal("0.1")), "f"),
                "complete": saved[goal.id] >= goal.target_minor,
                "target_date": goal.target_date,
                "months_left": months,
                "monthly_needed": None if need is None else original(need, acc.currency),
                "overdue": bool(goal.target_date and goal.target_date < today.isoformat()),
                "shares_account": shared[goal.account_id] > 1,
            }
        )
    return result


def apply_goal(db, goal, data):
    acc = ledger_account(db, data.account_id)
    if acc.role != "asset" or acc.kind not in GOAL_ACCOUNT_KINDS:
        raise ValueError("Choose a savings, checking, cash, bitcoin or investment account")
    target = to_minor(data.target, acc.currency)
    if target <= 0:
        raise ValueError("Enter a target greater than zero")
    goal.name, goal.account_id, goal.target_minor = data.name, acc.id, target
    goal.target_date = str(data.target_date) if data.target_date else None
    db.add(goal)
    db.flush()
    return goal


@router.get("/goals")
def list_goals(db=Depends(get_db, scope="function")):
    return goal_dicts(db)


@router.post("/goals")
def create_goal(data: GoalInput, db=Depends(get_db, scope="function")):
    goal = apply_goal(db, SavingsGoal(), data)
    audit(db, "goal.create", goal.id, data.model_dump(mode="json"))
    return next(row for row in goal_dicts(db) if row["id"] == goal.id)


@router.put("/goals/{id}")
def update_goal(id: int, data: GoalInput, db=Depends(get_db, scope="function")):
    goal = db.get(SavingsGoal, id)
    if not goal:
        raise HTTPException(404, "Goal not found")
    apply_goal(db, goal, data)
    audit(db, "goal.update", goal.id, data.model_dump(mode="json"))
    return next(row for row in goal_dicts(db) if row["id"] == goal.id)


@router.delete("/goals/{id}")
def delete_goal(id: int, db=Depends(get_db, scope="function")):
    goal = db.get(SavingsGoal, id)
    if not goal:
        raise HTTPException(404, "Goal not found")
    audit(db, "goal.delete", goal.id, {"name": goal.name})
    db.delete(goal)
    return {"ok": True}


# ---------- Review queue ----------


class ReviewInput(StrictModel):
    ids: list[int] = Field(min_length=1, max_length=5000)


def review_reasons(db, entry, reviewed):
    """Why an entry deserves a second look; empty once reviewed or when nothing is doubtful."""
    if entry.id in reviewed or entry.kind == "transfer":
        return []
    reasons = []
    if entry.import_key:
        reasons.append("imported")
    category = db.get(Category, entry.category_id) if entry.category_id else None
    if category and category.name.casefold().startswith(("other", "uncategor", "misc")):
        reasons.append("catch_all_category")
    return reasons


def reviewed_ids(db):
    return set(db.scalars(select(EntryReview.entry_id)))


@router.post("/transactions/review")
def mark_reviewed(data: ReviewInput, db=Depends(get_db, scope="function")):
    done = reviewed_ids(db)
    active = {entry.id for entry in active_transactions(db)}
    marked = 0
    for id in set(data.ids):
        if id in active and id not in done:
            db.add(EntryReview(entry_id=id))
            marked += 1
    audit(db, "transactions.review", "review", {"marked": marked})
    return {"marked": marked}


# ---------- Payee rules ----------


class PayeeRule(StrictModel):
    match: str = Field(min_length=2, max_length=80)
    category_id: int
    account_id: int | None = None

    @field_validator("match")
    @classmethod
    def match_not_blank(cls, value):
        if len(value.strip()) < 2:
            raise ValueError("Use at least two characters to match")
        return value.strip()


class PayeeRulesInput(StrictModel):
    payee_rules: list[PayeeRule] = Field(max_length=500)


@router.put("/settings/payee-rules")
def save_payee_rules(data: PayeeRulesInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    seen = set()
    for rule in data.payee_rules:
        category = db.get(Category, rule.category_id)
        if not category:
            raise HTTPException(422, "Choose an existing category")
        if rule.account_id is not None:
            acc = db.get(Account, rule.account_id)
            if not acc or acc.internal or acc.archived:
                raise HTTPException(422, "Choose an active account")
        key = (rule.match.casefold(), category.kind)
        if key in seen:
            raise HTTPException(422, f"“{rule.match}” already has a rule")
        seen.add(key)
    prefs = json.loads(user.preferences)
    prefs["payee_rules"] = data.model_dump(mode="json")["payee_rules"]
    user.preferences = json.dumps(prefs)
    audit(db, "settings.payee_rules", user.id, {"count": len(data.payee_rules)})
    return {"ok": True}


# ---------- Safe to spend ----------


def bills_due(db, today, end, rate):
    """Unpaid occurrences through month end, including anything already overdue."""
    total, count, complete = 0, 0, True
    for bill in db.scalars(select(RecurringBill).where(RecurringBill.archived.is_(False))):
        due = date.fromisoformat(bill.next_due)
        acc = db.get(Account, bill.account_id)
        while due <= end:
            usd = convert(to_minor(bill.amount, acc.currency), acc.currency, "USD", rate)
            if usd is None:
                complete = False
            else:
                total += to_minor(usd, "USD")
            count += 1
            if bill.frequency != "weekly":
                break
            due += timedelta(days=7)
    return total, count, complete


def set_aside(db, start, end):
    """Net money moved out of everyday accounts into savings, investments, bitcoin or debt."""
    total, complete = 0, True
    for entry in active_transactions(db, start, end):
        if entry.kind != "transfer" or not entry.destination_id:
            continue
        source, destination = db.get(Account, entry.account_id), db.get(Account, entry.destination_id)
        everyday_source = source.role == "asset" and source.kind in EVERYDAY_KINDS
        everyday_destination = destination.role == "asset" and destination.kind in EVERYDAY_KINDS
        # Card payments settle spending that was already counted as an expense.
        if everyday_source == everyday_destination or "credit_card" in (source.kind, destination.kind):
            continue
        usd = convert(entry.amount_minor, source.currency, "USD", reporting_rate(db, entry)["value"])
        if usd is None:
            complete = False
            continue
        total += to_minor(usd, "USD") * (1 if everyday_source else -1)
    return total, complete


def goals_still_to_fund(db, today, start, rate):
    """This month's share of dated goals, less what has already reached their accounts."""
    goals = [g for g in db.scalars(select(SavingsGoal)) if g.target_date]
    if not goals:
        return 0, True
    before = start - timedelta(days=1)
    opening = allocate(db, list(db.scalars(select(SavingsGoal))), before)
    needs, complete = {}, True
    for goal in goals:
        need = monthly_need(goal.target_minor, opening[goal.id], months_left(today, goal.target_date)) or 0
        needs[goal.account_id] = needs.get(goal.account_id, 0) + need
    total = 0
    for account_id, need in needs.items():
        acc = db.get(Account, account_id)
        arrived = max(balance(db, account_id) - balance(db, account_id, before), 0)
        usd = convert(max(need - arrived, 0), acc.currency, "USD", rate)
        if usd is None:
            complete = False
        else:
            total += to_minor(usd, "USD")
    return total, complete


def safe_to_spend(db, today=None):
    """What is left of this month's income after spending, saving, and the bills still to come."""
    today = today or date.today()
    start, end = month_days(today.strftime("%Y-%m"))
    quote = current_rate(db)
    rate = quote.usd_per_btc if quote else None
    activity = flow(db, start, end, "USD")
    aside, aside_complete = set_aside(db, start, end)
    bills, bill_count, bills_complete = bills_due(db, today, end, rate)
    goals, goals_complete = goals_still_to_fund(db, today, start, rate)
    complete = (
        activity["income"] is not None
        and activity["expenses"] is not None
        and aside_complete
        and bills_complete
        and goals_complete
    )
    days = (end - today).days + 1
    amount = per_day = None
    if complete:
        amount = to_minor(activity["income"], "USD") - to_minor(activity["expenses"], "USD") - aside - bills - goals
        per_day = int(Decimal(max(amount, 0)) / days)
    return {
        "month": today.strftime("%Y-%m"),
        "amount": None if amount is None else original(amount, "USD"),
        "per_day": None if per_day is None else original(per_day, "USD"),
        "days_left": days,
        "income": activity["income"],
        "spent": activity["expenses"],
        "set_aside": original(aside, "USD"),
        "bills_due": original(bills, "USD"),
        "bills_count": bill_count,
        "goals": original(goals, "USD"),
        "complete": complete,
    }
