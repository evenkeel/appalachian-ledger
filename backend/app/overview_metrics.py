"""Exact personal debt levels and dated bitcoin ownership percentages."""

import calendar
import json
from datetime import date, timedelta
from decimal import Decimal
from sqlalchemy import select, func
from .models import Account, Asset, JournalEntry, Posting, User
from .accounting import current_rate, rate_for
from .money import convert
from .reports import allocation, month_days


def debt_gauge(db, debt_usd):
    user = db.scalar(select(User))
    limits = json.loads(user.preferences).get("debt_limits") if user else None
    result = {"debt_usd": debt_usd, "limits": limits, "level": None, "position": None}
    if limits is None or debt_usd is None:
        return result
    debt = max(Decimal(0), Decimal(debt_usd))
    low, medium, high = (Decimal(limits[key]) for key in ("low", "medium", "high"))
    if debt <= low:
        level, position = "low", debt / low * 25 if low else Decimal(0)
    elif debt <= medium:
        level, position = "medium", 25 + (debt - low) / (medium - low) * 25
    elif debt <= high:
        level, position = "high", 50 + (debt - medium) / (high - medium) * 25
    else:
        level, position = "dangerous", 75 + min((debt - high) / high, Decimal(1)) * 25
    result.update(level=level, position=format(position.quantize(Decimal(".1")), "f"))
    return result


def months_before(day, count):
    index = day.year * 12 + day.month - 1 - count
    year, month = divmod(index, 12)
    return date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def dominance_history(db, month, period):
    _, last = month_days(month)
    end = min(last, date.today())
    earliest = db.scalar(select(func.min(JournalEntry.date)).where(JournalEntry.status == "posted"))
    daily = period in ("1w", "1m")
    if period == "1w":
        requested = end - timedelta(days=6)
    elif period == "1m":
        requested = months_before(end, 1) + timedelta(days=1)
    elif period == "max":
        requested = date.fromisoformat(earliest) if earliest else end
    else:
        requested = months_before(end, {"6m": 6, "1y": 12, "5y": 60}[period])
    start = max(requested, date.fromisoformat(earliest)) if earliest else requested
    daily = daily or (end - start).days <= 31
    result = {
        "period": period,
        "resolution": "daily" if daily else "monthly",
        "start": str(start),
        "end": str(end),
        "points": [],
    }
    if not earliest or start > end:
        return result
    if daily:
        days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    else:
        days = [start]
        cursor = start
        while cursor <= end:
            point = min(date(cursor.year, cursor.month, calendar.monthrange(cursor.year, cursor.month)[1]), end)
            if point != days[-1]:
                days.append(point)
            cursor = point + timedelta(days=1)
    accounts = list(db.scalars(select(Account).where(Account.internal.is_(False))))
    valued = set(db.scalars(select(Asset.account_id)))
    balances = {account.id: 0 for account in accounts}
    entries = iter(
        db.execute(
            select(JournalEntry.date, Posting.account_id, Posting.amount_minor)
            .join(Posting, Posting.entry_id == JournalEntry.id)
            .where(JournalEntry.status == "posted", JournalEntry.date <= str(end))
            .order_by(JournalEntry.date, Posting.id)
        )
    )
    entry = next(entries, None)
    for day in days:
        while entry is not None and entry[0] <= str(day):
            if entry[1] in balances:
                balances[entry[1]] += entry[2]
            entry = next(entries, None)
        rate = current_rate(db, day) if day == date.today() else rate_for(db, day)
        rows = []
        for account in accounts:
            kind = (
                "debt"
                if account.role == "liability"
                else (
                    "valued_asset"
                    if account.id in valued or account.kind not in {"bitcoin_wallet", "checking", "savings", "cash"}
                    else "bitcoin"
                    if account.currency == "BITCOIN"
                    else "dollars"
                )
            )
            amount = balances[account.id] * (-1 if account.role == "liability" else 1)
            rows.append(
                {
                    "holding_type": kind,
                    "usd": convert(amount, account.currency, "USD", rate.usd_per_btc if rate else None),
                }
            )
        result["points"].append({"date": str(day), "bitcoin_dominance": allocation(rows)["bitcoin_dominance"]})
    return result
