"""User-confirmed recurring expenses. Scheduling never posts a payment by itself."""

import calendar
import unicodedata
from datetime import date, timedelta
from sqlalchemy import select
from fastapi import HTTPException
from . import accounting as ledger
from .models import RecurringBill, BillOccurrence, Category, JournalEntry
from .money import to_minor, original
from .schemas import TransactionInput


def normalized_name(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def advance(bill):
    if bill.frequency == "once":
        return None
    due = date.fromisoformat(bill.next_due)
    if bill.frequency == "weekly":
        return str(due + timedelta(days=7))
    if bill.frequency == "yearly":
        year, month = due.year + 1, bill.anchor_month
    else:
        interval = {"monthly": 1, "quarterly": 3, "semiannual": 6}[bill.frequency]
        year, month_index = divmod(due.year * 12 + due.month - 1 + interval, 12)
        month = month_index + 1
    return str(date(year, month, min(bill.anchor_day, calendar.monthrange(year, month)[1])))


def get_bill(db, bill_id, include_archived=False):
    bill = db.get(RecurringBill, bill_id)
    if not bill or (bill.archived and not include_archived):
        raise HTTPException(404, "Recurring bill not found")
    return bill


def bill_dict(db, bill):
    account = ledger.account(db, bill.account_id, active=False)
    category = db.get(Category, bill.category_id)
    return {
        key: getattr(bill, key)
        for key in ("id", "account_id", "category_id", "description", "notes", "amount", "frequency", "next_due")
    } | {
        "account": account.name,
        "category": category.name,
        "currency": account.currency,
        "account_archived": account.archived,
    }


def save(db, data, bill=None):
    tx = data.transaction
    account = ledger.account(db, tx.account_id)
    category = db.get(Category, tx.category_id)
    if not category or category.kind != "expense":
        raise ValueError("Choose an expense category")
    amount = to_minor(tx.amount, account.currency)
    if amount <= 0:
        raise ValueError("Bill amount must be positive")
    if data.record_now and tx.date > date.today():
        raise ValueError("Record payments on today or an earlier date")
    if bill and data.record_now:
        raise ValueError("Use Record to pay an existing bill")
    occurrence = bill and db.scalar(
        select(BillOccurrence).where(BillOccurrence.bill_id == bill.id, BillOccurrence.due_date == str(tx.date))
    )
    if occurrence:
        reversed_entry = db.scalar(select(JournalEntry.id).where(JournalEntry.reverses_id == occurrence.entry_id))
        replaced = db.scalar(select(JournalEntry.id).where(JournalEntry.replaces_id == occurrence.entry_id))
        if reversed_entry is None or replaced is not None:
            raise ValueError("That bill occurrence was already recorded. Choose a new due date.")
        # Its payment was deleted, so the occurrence can be scheduled and recorded again.
        db.delete(occurrence)
        db.flush()
    schedule_changed = bill is None or bill.next_due != str(tx.date) or bill.frequency != data.frequency
    bill = bill or RecurringBill()
    bill.account_id, bill.category_id = account.id, category.id
    bill.description, bill.notes = tx.description, tx.notes
    bill.amount, bill.frequency = original(amount, account.currency), data.frequency
    bill.next_due = str(tx.date)
    if schedule_changed:
        bill.anchor_day, bill.anchor_month = tx.date.day, tx.date.month
    db.add(bill)
    db.flush()
    if data.record_now:
        entry = ledger.create_transaction(db, tx)
        db.add(BillOccurrence(bill_id=bill.id, due_date=bill.next_due, entry_id=entry.id))
        next_due = advance(bill)
        if next_due is None:
            bill.archived = True
        else:
            bill.next_due = next_due
    ledger.audit(db, "recurring_bill.save", bill.id, {"record_now": data.record_now})
    return bill_dict(db, bill)


def record(db, bill, data):
    # The client submits the occurrence it saw. A retry returns the original
    # entry even after the schedule has advanced, including after a reversal.
    existing = db.scalar(
        select(BillOccurrence).where(BillOccurrence.bill_id == bill.id, BillOccurrence.due_date == str(data.due_date))
    )
    if existing:
        return {"entry_id": existing.entry_id, "already_recorded": True}
    if bill.archived:
        raise HTTPException(404, "Planned expense is no longer active")
    if str(data.due_date) != bill.next_due:
        raise HTTPException(409, "This bill changed. Refresh before recording it.")
    if data.date > date.today():
        raise ValueError("Record payments on today or an earlier date")
    account = ledger.account(db, bill.account_id)
    actual_minor = to_minor(data.amount, account.currency)
    used = set(db.scalars(select(BillOccurrence.entry_id)))
    matches = [
        entry
        for entry in ledger.active_transactions(db, data.date, data.date)
        if entry.kind == "expense"
        and entry.account_id == bill.account_id
        and entry.amount_minor == actual_minor
        and entry.id not in used
        and normalized_name(entry.description) == normalized_name(bill.description)
        and normalized_name(bill.description)
    ]
    if len(matches) > 1:
        raise ValueError("Multiple recorded expenses match this payment. Review Transactions before confirming.")
    matched_existing = bool(matches)
    entry = (
        matches[0]
        if matches
        else ledger.create_transaction(
            db,
            TransactionInput(
                date=data.date,
                kind="expense",
                account_id=bill.account_id,
                category_id=bill.category_id,
                description=bill.description,
                notes=bill.notes,
                amount=data.amount,
            ),
        )
    )
    db.add(BillOccurrence(bill_id=bill.id, due_date=bill.next_due, entry_id=entry.id))
    next_due = advance(bill)
    if next_due is None:
        bill.archived = True
    else:
        bill.next_due = next_due
    ledger.audit(
        db,
        "recurring_bill.record",
        bill.id,
        {"entry_id": entry.id, "due_date": str(data.due_date), "matched_existing": matched_existing},
    )
    return {"entry_id": entry.id, "already_recorded": False, "matched_existing": matched_existing}


def reconcile(db, account_id=None):
    """Link unambiguous recorded expenses; never manufacture a payment.

    Both the expense and the active bill must be unique for the exact account,
    amount, due date and normalized name. A linked expense cannot pay two bills.
    Repeat rounds allow an old schedule to catch up over already-recorded months.
    """
    from .models import Account

    used = set(db.scalars(select(BillOccurrence.entry_id)))
    entries = {}
    for entry in ledger.active_transactions(db):
        if entry.kind != "expense" or entry.id in used or not normalized_name(entry.description):
            continue
        if account_id is not None and entry.account_id != account_id:
            continue
        key = (entry.account_id, entry.amount_minor, entry.date, normalized_name(entry.description))
        entries.setdefault(key, []).append(entry)
    statement = select(RecurringBill).where(RecurringBill.archived.is_(False))
    if account_id is not None:
        statement = statement.where(RecurringBill.account_id == account_id)
    bills = list(db.scalars(statement.order_by(RecurringBill.id)))
    matched = []
    while len(matched) < 1000:
        groups = {}
        for bill in bills:
            if bill.archived or bill.next_due > str(date.today()) or not normalized_name(bill.description):
                continue
            currency = db.get(Account, bill.account_id).currency
            key = (bill.account_id, to_minor(bill.amount, currency), bill.next_due, normalized_name(bill.description))
            groups.setdefault(key, []).append(bill)
        changed = False
        for key, candidates in groups.items():
            expenses = [entry for entry in entries.get(key, []) if entry.id not in used]
            if len(candidates) != 1 or len(expenses) != 1:
                continue
            bill, entry = candidates[0], expenses[0]
            due = bill.next_due
            db.add(BillOccurrence(bill_id=bill.id, due_date=due, entry_id=entry.id))
            used.add(entry.id)
            next_due = advance(bill)
            if next_due is None:
                bill.archived = True
            else:
                bill.next_due = next_due
            ledger.audit(db, "recurring_bill.match", bill.id, {"entry_id": entry.id, "due_date": due})
            matched.append({"bill_id": bill.id, "entry_id": entry.id, "due_date": due})
            changed = True
            if len(matched) == 1000:
                break
        if not changed:
            break
    return {"matched": len(matched), "items": matched}
