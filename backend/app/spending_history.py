"""Historical expense comparisons; convert each dated expense before summing."""

from datetime import date
from fastapi import APIRouter, Depends, Query
from .auth import authenticate
from .db import get_db
from . import accounting as ledger
from .costs import snapshot_dict
from .models import Account, Category
from .money import convert, original
from .reports import add_nullable

router = APIRouter(prefix="/api", dependencies=[Depends(authenticate)])


def expense_rows(db, start, end, category_id, account_id, rate):
    rows = []
    for entry in ledger.active_transactions(db, start, end):
        if entry.kind != "expense" or (category_id is not None and entry.category_id != category_id):
            continue
        if account_id is not None and entry.account_id != account_id:
            continue
        acc = db.get(Account, entry.account_id)
        cost = snapshot_dict(db, entry.id)
        reference = ledger.reporting_rate(db, entry)
        # Unfinished-day spot estimates are not historical observations.
        historical_rate = reference["value"] if reference["basis"] != "current_estimate" else None
        value = cost["usd_per_btc"] if cost else historical_rate
        bitcoin = convert(entry.amount_minor, acc.currency, "BITCOIN", value)
        usd = convert(entry.amount_minor, acc.currency, "USD", value)
        rows.append(
            {
                "id": entry.id,
                "date": entry.date,
                "description": entry.description,
                "category": db.get(Category, entry.category_id).name,
                "account": acc.name,
                "amount": original(entry.amount_minor, acc.currency),
                "currency": acc.currency,
                "usd": usd,
                "bitcoin": bitcoin,
                "rate": value,
                "source": cost["source"]
                if cost
                else reference["source"] or ("Saved journal reference" if value else None),
                "method": cost["method"] if cost else reference["basis"],
                "hypothetical_value_usd": convert(int(bitcoin), "BITCOIN", "USD", rate.usd_per_btc if rate else None)
                if bitcoin is not None
                else None,
            }
        )
    return rows


def spending_history(db, start, end, category_id=None, account_id=None, interval="month", summary=False):
    if start > end or start.year < 1970 or end > date.today() or (end - start).days > 366 * 50:
        raise ValueError("Choose a date range of at most 50 years, from 1970 through today")
    rate = ledger.current_rate(db)
    with ledger.bulk_read(db):
        rows = expense_rows(db, start, end, category_id, account_id, rate)

    def aggregate(items):
        return {
            "count": len(items),
            "usd": add_nullable(r["usd"] for r in items),
            "bitcoin": add_nullable(r["bitcoin"] for r in items),
            "hypothetical_value_usd": add_nullable(r["hypothetical_value_usd"] for r in items),
            "missing_usd": sum(r["usd"] is None for r in items),
            "missing_bitcoin": sum(r["bitcoin"] is None for r in items),
        }

    groups, categories = {}, {}
    for row in rows:
        key = row["date"][: 4 if interval == "year" else 7]
        groups.setdefault(key, []).append(row)
        categories.setdefault(row["category"], []).append(row)
    return {
        "start": str(start),
        "end": str(end),
        "interval": interval,
        "totals": aggregate(rows),
        "periods": [{"period": key, **aggregate(items)} for key, items in sorted(groups.items())],
        "categories": [{"name": key, **aggregate(items)} for key, items in sorted(categories.items())],
        # A chart of several years needs the sums only, not five hundred entries it will never list.
        "transactions": [] if summary else rows[:500],
        "transactions_truncated": not summary and len(rows) > 500,
        "current_reference": {
            "price_usd": rate.usd_per_btc,
            "day": rate.day,
            "source": rate.source,
            "older": rate.day != date.today().isoformat(),
        }
        if rate
        else None,
    }


@router.get("/spending-history")
def history(
    start: date,
    end: date,
    interval: str = Query("month", pattern="^(month|year)$"),
    category_id: int | None = None,
    account_id: int | None = None,
    summary: bool = False,
    db=Depends(get_db, scope="function"),
):
    return spending_history(db, start, end, category_id, account_id, interval, summary)
