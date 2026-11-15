"""Monthly spending, acquisition activity and transfers into long-term accounts."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select

from .accounting import active_transactions, balance, current_rate, rate_for, reporting_rate
from .models import Account, Category
from .money import convert, original, exchange_price
from .reports import add_nullable, budget_overview, month_days, month_sequence


def account_group(account):
    if account.role != "asset":
        return None
    if account.kind == "savings":
        return "savings"
    if account.currency == "BITCOIN" or account.kind in {"brokerage", "stock", "etf"}:
        return "investing"
    return None


def tracking_report(db, month, months, account_id=None, category_id=None):
    start, end = month_days(month)
    if start.year < 1970 or start > date.today():
        raise ValueError("Choose a month from 1970 through the current month")
    accounts = {a.id: a for a in db.scalars(select(Account).where(Account.internal.is_(False)))}
    if account_id is not None and account_id not in accounts:
        raise ValueError("Account not found")
    if category_id is not None:
        category = db.get(Category, category_id)
        if not category or category.kind != "expense":
            raise ValueError("Choose an expense category")
    months = min(months, (start.year - 1970) * 12 + start.month)
    keys = month_sequence(end, months)
    entries = active_transactions(db, keys[0] + "-01", min(end, date.today()))
    selected = [a for a in accounts.values() if account_id is None or a.id == account_id]
    groups = {group: {a.id for a in selected if account_group(a) == group} for group in ("savings", "investing")}
    rows = []
    for key in keys:
        _, last = month_days(key)
        last = min(last, date.today())
        quote = current_rate(db, last) if last == date.today() else rate_for(db, last)
        plans = [b for b in budget_overview(db, key) if category_id is None or b["category_id"] == category_id]
        allowances = [b["planned_usd"] for b in plans if b["planned_usd"] is not None]
        planned = add_nullable(allowances) if allowances else None
        spent = add_nullable(b["spent_usd"] for b in plans)
        row = {
            "month": key,
            "date": last.isoformat(),
            "planned_usd": planned,
            "spent_usd": spent,
            "remaining_usd": str(Decimal(planned) - Decimal(spent))
            if planned is not None and spent is not None
            else None,
            "unbudgeted_usd": add_nullable(b["spent_usd"] for b in plans if b["planned_usd"] is None),
            "estimated": any(b["estimated"] for b in plans),
        }
        contributions = {group: [] for group in groups}
        bought, paid, count = 0, 0, 0
        for entry in entries:
            if entry.date[:7] != key or entry.kind != "transfer":
                continue
            source, destination = accounts[entry.account_id], accounts[entry.destination_id]
            if (
                source.currency == "USD"
                and destination.currency == "BITCOIN"
                and source.role == destination.role == "asset"
                and (account_id is None or account_id in (source.id, destination.id))
            ):
                bought += entry.destination_minor
                paid += entry.amount_minor
                count += 1
            for group, ids in groups.items():
                incoming, outgoing = destination.id in ids, source.id in ids
                if incoming == outgoing:
                    continue  # Moving between accounts in the group is not a new contribution.
                # The actual USD exchange leg is authoritative, even without a price reference.
                if source.currency == "USD":
                    value = original(entry.amount_minor, "USD")
                elif destination.currency == "USD":
                    value = original(entry.destination_minor, "USD")
                else:
                    reference = reporting_rate(db, entry)
                    value = convert(
                        entry.destination_minor if incoming else entry.amount_minor,
                        "BITCOIN",
                        "USD",
                        reference["value"],
                    )
                    row["estimated"] |= reference["basis"] == "current_estimate"
                contributions[group].append(value if incoming or value is None else str(-Decimal(value)))
        for group, ids in groups.items():
            row[f"{group}_net_usd"] = add_nullable(contributions[group])
            row[f"{group}_balance_usd"] = add_nullable(
                convert(balance(db, id, last), accounts[id].currency, "USD", quote.usd_per_btc if quote else None)
                for id in ids
            )
        row.update(
            bitcoin_bought=str(bought),
            bitcoin_paid_usd=original(paid, "USD"),
            purchase_count=count,
            average_price_usd=exchange_price(paid, bought),
            bitcoin_balance=str(
                sum(balance(db, a.id, last) for a in selected if a.role == "asset" and a.currency == "BITCOIN")
            ),
        )
        rows.append(row)
    return {"history": rows}
