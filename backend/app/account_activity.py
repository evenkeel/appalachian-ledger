"""A native-currency account register built from every posted ledger leg."""

from collections import OrderedDict
from datetime import date
from sqlalchemy import select
from .accounting import account
from .models import Account, Category, JournalEntry, Posting
from .money import original


def account_activity(db, account_id):
    acc = account(db, account_id, active=False)
    # Read postings rather than operating transactions: openings, valuations,
    # corrections and both sides of transfers all affect this balance.
    groups = OrderedDict()
    for entry, minor in db.execute(
        select(JournalEntry, Posting.amount_minor)
        .join(Posting, Posting.entry_id == JournalEntry.id)
        .where(Posting.account_id == acc.id, JournalEntry.status == "posted", JournalEntry.date <= str(date.today()))
        .order_by(JournalEntry.date, JournalEntry.id, Posting.id)
    ):
        if entry.id not in groups:
            groups[entry.id] = [entry, 0]
        groups[entry.id][1] += minor
    accounts = {row.id: row for row in db.scalars(select(Account))}
    categories = {row.id: row.name for row in db.scalars(select(Category))}
    reversed_ids = set(
        db.scalars(
            select(JournalEntry.reverses_id).where(
                JournalEntry.reverses_id.is_not(None),
                JournalEntry.status == "posted",
                JournalEntry.date <= str(date.today()),
            )
        )
    )
    sign = -1 if acc.role == "liability" else 1
    running = 0
    rows = []
    for entry, raw in groups.values():
        running += raw
        counterpart = entry.destination_id if entry.account_id == acc.id else entry.account_id
        other = accounts.get(counterpart) if entry.destination_id is not None else None
        rows.append(
            {
                "id": entry.id,
                "date": entry.date,
                "kind": entry.kind,
                "description": entry.description,
                "notes": entry.notes,
                "counterparty": other.name if other else None,
                "counterparty_role": other.role if other else None,
                "counterparty_kind": other.kind if other else None,
                "direction": ("in" if entry.destination_id == acc.id else "out") if other else None,
                "category": categories.get(entry.category_id),
                "change": original(sign * raw, acc.currency),
                "change_minor": str(sign * raw),
                "balance": original(sign * running, acc.currency),
                "reverses_id": entry.reverses_id,
                "reversed": entry.id in reversed_ids,
            }
        )
    return {
        "account_id": acc.id,
        "currency": acc.currency,
        "role": acc.role,
        "as_of": str(date.today()),
        "balance": original(sign * running, acc.currency),
        "rows": list(reversed(rows)),
    }
