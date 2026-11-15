"""Review and complete missing conversions without changing journal entries."""

from sqlalchemy import select
from .models import ConversionAttachment, ExchangeRate, JournalEntry
from .accounting import audit, rate_for
from .money import convert
from .models import Account


def candidates(db):
    reversed_ids = set(db.scalars(select(JournalEntry.reverses_id).where(JournalEntry.reverses_id.is_not(None))))
    attached_ids = set(db.scalars(select(ConversionAttachment.entry_id)))
    return [
        e
        for e in db.scalars(
            select(JournalEntry)
            .where(
                JournalEntry.status == "posted",
                JournalEntry.rate_snapshot.is_(None),
                JournalEntry.kind != "reversal",
            )
            .order_by(JournalEntry.date, JournalEntry.id)
        )
        if e.id not in reversed_ids | attached_ids
    ]


def preview(db):
    entries = candidates(db)
    items = []
    for entry in entries:
        rate = rate_for(db, entry.date)
        if not rate or rate.method not in ("daily_close", "midnight", "manual"):
            continue
        account = db.get(Account, entry.account_id)
        items.append(
            {
                "entry_id": entry.id,
                "rate_id": rate.id,
                "date": entry.date,
                "description": entry.description,
                "source": rate.source,
                "method": rate.method,
                "usd_per_btc": rate.usd_per_btc,
                "bitcoin": convert(entry.amount_minor, account.currency, "BITCOIN", rate.usd_per_btc),
                "usd": convert(entry.amount_minor, account.currency, "USD", rate.usd_per_btc),
            }
        )
        if len(items) == 500:
            break
    return {"missing": len(entries), "items": items}


def apply(db, items):
    eligible = {entry.id: entry for entry in candidates(db)}
    count = 0
    for item in items:
        existing = db.get(ConversionAttachment, item.entry_id)
        if existing and existing.rate_id == item.rate_id:
            continue  # Safe retry after a lost response.
        entry = eligible.get(item.entry_id)
        rate = db.get(ExchangeRate, item.rate_id)
        if not entry or not rate or rate.day != entry.date or rate.method not in ("daily_close", "midnight", "manual"):
            raise ValueError("A conversion changed since review. Refresh the preview.")
        selected = rate_for(db, entry.date)
        if not selected or selected.id != rate.id:
            raise ValueError("The selected price changed since review. Refresh the preview.")
        db.add(ConversionAttachment(entry_id=entry.id, rate_id=rate.id))
        db.flush()
        audit(db, "conversion.attach", entry.id, {"rate_id": rate.id, "source": rate.source, "method": rate.method})
        count += 1
    return {"attached": count}
