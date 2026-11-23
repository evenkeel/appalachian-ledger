"""Permanent purchase-date cost observations; never use a recording-time spot quote."""

from decimal import Decimal, localcontext
from sqlalchemy import select
from . import accounting as ledger
from .models import Account, BillOccurrence, ConversionAttachment, ExpenseCost, ExchangeRate, JournalEntry
from .money import convert


def capture(db, day=None, entry_id=None):
    count = 0
    if entry_id is not None:
        # One entry: look only at its own record, however long the history is.
        entries = [db.get(JournalEntry, entry_id)]
        saved = {entry_id} if db.get(ExpenseCost, entry_id) else set()
    else:
        entries = ledger.active_transactions(db)
        saved = set(db.scalars(select(ExpenseCost.entry_id)))
    for entry in entries:
        if entry.kind != "expense" or entry.id in saved or (day and entry.date != str(day)):
            continue
        # Existing immutable journal rates take precedence over later references.
        value = ledger.entry_rate(db, entry)
        rate = db.get(ExchangeRate, entry.rate_id) if entry.rate_id else None
        attachment = db.get(ConversionAttachment, entry.id)
        if attachment and rate is None:
            rate = db.get(ExchangeRate, attachment.rate_id)
        previous = db.get(JournalEntry, entry.replaces_id) if entry.replaces_id else None
        previous_cost = db.get(ExpenseCost, entry.replaces_id) if entry.replaces_id else None
        if previous_cost and previous.date == entry.date:
            value = previous_cost.usd_per_btc
        if value is None:
            rate = ledger.rate_for(db, entry.date)
            value = rate.usd_per_btc if rate else None
        if value is None:
            continue
        account = db.get(Account, entry.account_id)
        db.add(
            ExpenseCost(
                entry_id=entry.id,
                usd=convert(entry.amount_minor, account.currency, "USD", value),
                bitcoin=convert(entry.amount_minor, account.currency, "BITCOIN", value),
                usd_per_btc=value,
                source=previous_cost.source
                if previous_cost and previous.date == entry.date
                else rate.source
                if rate
                else "Saved journal reference",
                method=previous_cost.method
                if previous_cost and previous.date == entry.date
                else rate.method
                if rate
                else "saved",
                observed_at=previous_cost.observed_at
                if previous_cost and previous.date == entry.date
                else (rate.observed_at or rate.day)
                if rate
                else entry.date,
            )
        )
        count += 1
    db.flush()
    return count


def change(current, previous):
    if current is None or previous is None or Decimal(previous) == 0:
        return None
    with localcontext() as ctx:
        ctx.prec = 60
        return format(((Decimal(current) / Decimal(previous) - 1) * 100).quantize(Decimal(".01")), "f")


def history(db, bill_id=None, category_id=None, search=""):
    bill_entries = None
    if bill_id is not None:
        from .recurring import get_bill

        get_bill(db, bill_id, include_archived=True)
        bill_entries = set(db.scalars(select(BillOccurrence.entry_id).where(BillOccurrence.bill_id == bill_id)))
        # Corrections preserve a bill's identity even when its name/account changes.
        for id, replaces in db.execute(select(JournalEntry.id, JournalEntry.replaces_id).order_by(JournalEntry.id)):
            if replaces in bill_entries:
                bill_entries.add(id)
    observations = {row.entry_id: row for row in db.scalars(select(ExpenseCost))}
    payments = []
    for entry in reversed(ledger.active_transactions(db)):
        if entry.kind != "expense" or (bill_entries is not None and entry.id not in bill_entries):
            continue
        if category_id is not None and entry.category_id != category_id:
            continue
        if search.strip().casefold() not in entry.description.casefold():
            continue
        account = db.get(Account, entry.account_id)
        cost = observations.get(entry.id)
        # Native amounts are always known even when their conversion is missing.
        usd = cost.usd if cost else convert(entry.amount_minor, account.currency, "USD", None)
        bitcoin = cost.bitcoin if cost else convert(entry.amount_minor, account.currency, "BITCOIN", None)
        payments.append(
            {
                "id": entry.id,
                "date": entry.date,
                "recorded_at": entry.created_at,
                "description": entry.description,
                "account": account.name,
                "usd": usd,
                "bitcoin": bitcoin,
                "rate": cost.usd_per_btc if cost else None,
                "source": cost.source if cost else None,
                "method": cost.method if cost else None,
                "quote_at": cost.observed_at if cost else None,
            }
        )
    months = {}
    for payment in payments:
        month = payment["date"][:7]
        row = months.setdefault(
            month,
            {
                "month": month,
                "payments": 0,
                "usd": Decimal(0),
                "bitcoin": Decimal(0),
                "missing_usd": 0,
                "missing_bitcoin": 0,
            },
        )
        row["payments"] += 1
        for unit in ("usd", "bitcoin"):
            if payment[unit] is None:
                row[f"missing_{unit}"] += 1
            else:
                row[unit] += Decimal(payment[unit])
    result = []
    for month in sorted(months):
        row = months[month]
        for unit in ("usd", "bitcoin"):
            row[unit] = None if row[f"missing_{unit}"] else format(row[unit], ".2f" if unit == "usd" else ".0f")
            row[f"change_{unit}"] = change(row[unit], result[-1][unit]) if result else None
        result.append(row)
    return {"payments": list(reversed(payments)), "months": list(reversed(result))}


def snapshot_dict(db, entry_id):
    cost = db.get(ExpenseCost, entry_id)
    if cost is None:
        return None
    return {name: getattr(cost, name) for name in ("usd", "bitcoin", "usd_per_btc", "source", "method", "observed_at")}
