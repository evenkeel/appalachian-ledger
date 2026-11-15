import calendar
import re
from datetime import date
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from sqlalchemy import select
from .models import Account, Asset, Budget, Category, JournalEntry, Posting, PriceQuote
from .accounting import (
    balance,
    current_rate,
    rate_for,
    active_transactions,
    transaction_dict,
    reporting_rate,
)
from .money import convert, original, to_minor
from .investments import portfolio_report


def add_nullable(values):
    values = list(values)
    with localcontext() as ctx:
        ctx.prec = 60
        return None if any(v is None for v in values) else format(sum((Decimal(v) for v in values), Decimal(0)), "f")


def accounts_report(db, day=None, denomination="BITCOIN", historical=False):
    day = day or date.today().isoformat()
    rate = rate_for(db, day) if historical else current_rate(db, day)
    valued_ids = set(db.scalars(select(Asset.account_id)))
    result = []
    for acc in db.scalars(select(Account).where(Account.internal.is_(False)).order_by(Account.id)):
        raw = balance(db, acc.id, day)
        shown = -raw if acc.role == "liability" else raw
        result.append(
            {
                "id": acc.id,
                "name": acc.name,
                "kind": acc.kind,
                "role": acc.role,
                "currency": acc.currency,
                "holding_type": (
                    "debt"
                    if acc.role == "liability"
                    else "valued_asset"
                    if acc.id in valued_ids or acc.kind not in {"bitcoin_wallet", "checking", "savings", "cash"}
                    else "bitcoin"
                    if acc.currency == "BITCOIN"
                    else "dollars"
                ),
                "archived": acc.archived,
                "exclude_from_consumer_debt": acc.exclude_from_consumer_debt,
                "exclude_from_liquid_usd": acc.exclude_from_liquid_usd,
                "portfolio": portfolio_report(db, acc.id) if not historical else None,
                "balance": original(shown, acc.currency),
                "balance_minor": str(shown),
                "value": convert(shown, acc.currency, denomination, rate.usd_per_btc if rate else None),
                "bitcoin": convert(shown, acc.currency, "BITCOIN", rate.usd_per_btc if rate else None),
                "usd": convert(shown, acc.currency, "USD", rate.usd_per_btc if rate else None),
                "rate_day": rate.day if rate else None,
                "rate_source": rate.source if rate else None,
            }
        )
    return result


def totals(accounts):
    assets = add_nullable(a["value"] for a in accounts if a["role"] == "asset")
    liabilities = add_nullable(a["value"] for a in accounts if a["role"] == "liability")
    with localcontext() as ctx:
        ctx.prec = 60
        net = str(Decimal(assets) - Decimal(liabilities)) if assets is not None and liabilities is not None else None
    return assets, liabilities, net


def month_days(month):
    if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month) or month < "1970-01":
        raise ValueError("Choose a month in YYYY-MM format, from 1970 onward")
    year, m = map(int, month.split("-"))
    return date(year, m, 1), date(year, m, calendar.monthrange(year, m)[1])


def month_sequence(end, count):
    index = end.year * 12 + end.month - 1
    return [f"{i // 12:04d}-{i % 12 + 1:02d}" for i in range(max(1970 * 12, index - count + 1), index + 1)]


EVERYDAY_KINDS = {"checking", "cash"}


def money_moved_out(db, start, end):
    """Net money moved from everyday accounts this month, net of anything moved back.

    Returns a dict: ``bitcoin`` (whole bitcoin units stacked, BIP 177), ``bitcoin_usd``
    (dollars those buys cost), ``other_usd`` (savings, investing and debt payments),
    and ``complete`` (False when a dollar amount has no exchange rate).
    """
    moved = {"bitcoin": 0, "bitcoin_usd": 0, "other_usd": 0, "complete": True}
    for entry in active_transactions(db, start, end):
        if entry.kind != "transfer" or not entry.destination_id:
            continue
        source, destination = db.get(Account, entry.account_id), db.get(Account, entry.destination_id)
        everyday_source = source.role == "asset" and source.kind in EVERYDAY_KINDS
        everyday_destination = destination.role == "asset" and destination.kind in EVERYDAY_KINDS
        # Card payments settle spending that was already counted as an expense.
        if everyday_source == everyday_destination or "credit_card" in (source.kind, destination.kind):
            continue
        other = destination if everyday_source else source
        sign = 1 if everyday_source else -1
        is_bitcoin = other.currency == "BITCOIN"
        if is_bitcoin:
            moved["bitcoin"] += sign * ((entry.destination_minor or 0) if everyday_source else entry.amount_minor)
        # Prefer the dollars actually recorded on either side of the transfer.
        if source.currency == "USD":
            usd_minor = entry.amount_minor
        elif destination.currency == "USD" and entry.destination_minor is not None:
            usd_minor = entry.destination_minor
        else:
            usd = convert(entry.amount_minor, source.currency, "USD", reporting_rate(db, entry)["value"])
            if usd is None:
                moved["complete"] = False
                continue
            usd_minor = to_minor(usd, "USD")
        moved["bitcoin_usd" if is_bitcoin else "other_usd"] += sign * usd_minor
    return moved


def stacked(db, start, end, income_usd):
    """Bitcoin stacked in a period, and the share of dollar income that went into it."""
    moved = money_moved_out(db, start, end)
    rate = None
    if moved["complete"] and income_usd is not None and Decimal(income_usd) > 0:
        rate = str((Decimal(moved["bitcoin_usd"]) / 100 * 100 / Decimal(income_usd)).quantize(Decimal(".1")))
    return {
        "bitcoin": original(moved["bitcoin"], "BITCOIN"),
        "usd": original(moved["bitcoin_usd"], "USD") if moved["complete"] else None,
        "other_usd": original(moved["other_usd"], "USD") if moved["complete"] else None,
        "stack_rate": rate,
    }


def flow(db, start, end, denomination, source=None):
    entries = active_transactions(db, start, end)
    income, expense, categories, income_categories = [], [], {}, {}
    conversion_status = {"current_estimate": 0, "dated_reference": 0, "missing": 0}
    spending = {key: [] for key in ("fixed", "essential", "discretionary", "unclassified")}
    for entry in entries:
        if entry.kind == "transfer":
            continue
        acc = db.get(Account, entry.account_id)
        if source and acc.currency != source:
            continue
        reference = reporting_rate(db, entry)
        if (
            acc.currency != ("BITCOIN" if denomination == "BTC" else denomination)
            and reference["basis"] in conversion_status
        ):
            conversion_status[reference["basis"]] += 1
        value = convert(entry.amount_minor, acc.currency, denomination, reference["value"])
        (income if entry.kind == "income" else expense).append(value)
        if entry.kind == "income":
            name = db.get(Category, entry.category_id).name
            income_categories.setdefault(name, []).append(value)
        if entry.kind == "expense":
            category = db.get(Category, entry.category_id)
            name = category.name
            spending[category.spending_type].append(value)
            categories.setdefault(name, []).append(value)
    inc, exp = add_nullable(income), add_nullable(expense)
    savings = None
    if inc is not None and exp is not None and Decimal(inc) > 0:
        savings = str(
            ((Decimal(inc) - Decimal(exp)) * 100 / Decimal(inc)).quantize(Decimal(".1"), rounding=ROUND_HALF_EVEN)
        )
    return {
        "spending": {key: add_nullable(values) for key, values in spending.items()},
        "conversion_status": conversion_status,
        "income_categories": [
            {"name": key, "value": add_nullable(values)} for key, values in income_categories.items()
        ],
        "income": inc,
        "expenses": exp,
        "savings_rate": savings,
        "categories": [{"name": key, "value": add_nullable(values)} for key, values in categories.items()],
    }


def ownership(accounts):
    # Account currency describes its ledger, not necessarily the asset it holds.
    result = {
        "equivalents": {
            kind: {
                currency: add_nullable(a[field] for a in accounts if a["holding_type"] == kind)
                for currency, field in (("USD", "usd"), ("BITCOIN", "bitcoin"))
            }
            for kind in ("bitcoin", "dollars", "valued_asset", "debt")
        },
        "native_other_assets": {
            currency: add_nullable(
                a["balance"] for a in accounts if a["holding_type"] == "valued_asset" and a["currency"] == currency
            )
            for currency in ("USD", "BITCOIN")
        },
        "native_liabilities": {
            currency: add_nullable(
                a["balance"] for a in accounts if a["holding_type"] == "debt" and a["currency"] == currency
            )
            for currency in ("USD", "BITCOIN")
        },
        "bitcoin_held": add_nullable(a["balance"] for a in accounts if a["holding_type"] == "bitcoin"),
        "usd_held": add_nullable(a["balance"] for a in accounts if a["holding_type"] == "dollars"),
        "valued_assets_usd": add_nullable(a["usd"] for a in accounts if a["holding_type"] == "valued_asset"),
        "liabilities_usd": add_nullable(a["usd"] for a in accounts if a["holding_type"] == "debt"),
    }
    result["allocation"] = allocation(accounts)
    return result


def allocation(accounts):
    """Asset shares exclude debt; bitcoin dominance uses positive net worth."""
    values = {
        kind: add_nullable(a["usd"] for a in accounts if a["holding_type"] == kind)
        for kind in ("bitcoin", "dollars", "valued_asset", "debt")
    }
    assets = add_nullable(values[kind] for kind in ("bitcoin", "dollars", "valued_asset"))
    if assets is None:
        status = "missing_values"
    elif any(Decimal(values[kind]) < 0 for kind in ("bitcoin", "dollars", "valued_asset")):
        status = "negative_assets"
    elif Decimal(assets) <= 0:
        status = "empty"
    else:
        status = "ready"
    shares = {
        kind: format((Decimal(values[kind]) * 100 / Decimal(assets)).quantize(Decimal(".1")), "f")
        if status == "ready"
        else None
        for kind in ("bitcoin", "dollars", "valued_asset")
    }
    net = None if assets is None or values["debt"] is None else str(Decimal(assets) - Decimal(values["debt"]))
    dominance = None
    if net is not None and Decimal(net) > 0 and values["bitcoin"] is not None:
        dominance = format((Decimal(values["bitcoin"]) * 100 / Decimal(net)).quantize(Decimal(".1")), "f")
    return {
        "bitcoin_usd": values["bitcoin"],
        "dollars_usd": values["dollars"],
        "other_assets_usd": values["valued_asset"],
        "liabilities_usd": values["debt"],
        "assets_usd": assets,
        "asset_percentages": shares,
        "status": status,
        "net_worth_usd": net,
        "bitcoin_dominance": dominance,
    }


def account_performance(db, history, accounts, denomination):
    """Reconcile value changes after net additions, not a time-weighted investment return."""
    start, end = history[0], history[-1]
    reversed_ids = select(JournalEntry.reverses_id).where(JournalEntry.reverses_id.is_not(None))
    rows = db.execute(
        select(Posting, JournalEntry)
        .join(JournalEntry)
        .where(
            JournalEntry.status == "posted",
            JournalEntry.date > start["date"],
            JournalEntry.date <= end["date"],
            JournalEntry.kind.not_in(["valuation", "reversal"]),
            JournalEntry.id.not_in(reversed_ids),
        )
    ).all()
    beginnings = {a["id"]: a["value"] for a in start["accounts"]}
    result = []
    for acc in accounts:
        if acc["role"] != "asset":
            continue
        additions = add_nullable(
            convert(p.amount_minor, acc["currency"], denomination, reporting_rate(db, entry)["value"])
            for p, entry in rows
            if p.account_id == acc["id"]
        )
        beginning, ending = beginnings[acc["id"]], acc["value"]
        change = None
        if beginning is not None and ending is not None and additions is not None:
            change = format(Decimal(ending) - Decimal(beginning) - Decimal(additions), "f")
        result.append(
            {
                "account_id": acc["id"],
                "start_date": start["date"],
                "end_date": end["date"],
                "start_value": beginning,
                "end_value": ending,
                "net_additions": additions,
                "value_change": change,
            }
        )
    return result


def dual_values(db, records, start, end):
    result = {}
    for unit, field in (("BITCOIN", "bitcoin"), ("USD", "usd")):
        assets, liabilities, net = totals([{**a, "value": a[field]} for a in records])
        result[unit] = {"assets": assets, "liabilities": liabilities, "net_worth": net, **flow(db, start, end, unit)}
    return result


def dashboard(db, month, months=6, denomination="BITCOIN"):
    start, end = month_days(month)
    end = min(end, date.today())
    historical = end < date.today()
    accounts = accounts_report(db, str(end), denomination, historical)
    assets, liabilities, net = totals(accounts)
    history = []
    for key in month_sequence(end, months):
        first, last = month_days(key)
        day = min(last, date.today())
        records = accounts_report(db, str(day), denomination, day < date.today())
        a, liabilities_at_date, n = totals(records)
        point_rate = rate_for(db, day) if day < date.today() else current_rate(db, day)
        dual = dual_values(db, records, first, day)
        history.append(
            {
                "month": key,
                "stacked": stacked(db, first, day, dual["USD"]["income"]),
                "bitcoin_held": ownership(records)["bitcoin_held"],
                "allocation": allocation(records),
                "dual": dual,
                "usd_per_btc": point_rate.usd_per_btc if point_rate else None,
                "date": str(day),
                "assets": a,
                "liabilities": liabilities_at_date,
                "net_worth": n,
                **flow(db, first, day, denomination),
                "flows": {currency: flow(db, first, day, denomination, currency) for currency in ("USD", "BITCOIN")},
                "native_flows": {currency: flow(db, first, day, currency, currency) for currency in ("USD", "BITCOIN")},
                "rate_day": point_rate.day if point_rate else None,
                "accounts": [
                    {
                        "id": row["id"],
                        "name": row["name"],
                        "balance": row["balance"],
                        "currency": row["currency"],
                        "value": row["value"],
                    }
                    for row in records
                ],
            }
        )
    rate = rate_for(db, end) if historical else current_rate(db, end)
    baseline = next(
        (p for p in history if p["dual"]["USD"]["expenses"] is not None and Decimal(p["dual"]["USD"]["expenses"]) > 0),
        None,
    )
    for point in history:
        amount = baseline["dual"]["USD"]["expenses"] if baseline else None
        point["lifestyle"] = {
            "USD": amount,
            "BITCOIN": convert(to_minor(amount, "USD"), "USD", "BITCOIN", point["usd_per_btc"]) if amount else None,
        }
    dual = dual_values(db, accounts, start, end)
    return {
        "month": month,
        "dual": dual,
        "stacked": stacked(db, start, end, dual["USD"]["income"]),
        "lifestyle_baseline": baseline["month"] if baseline else None,
        "denomination": denomination,
        "assets": assets,
        "liabilities": liabilities,
        "net_worth": net,
        **flow(db, start, end, denomination),
        "ownership": ownership(accounts),
        "flows": {currency: flow(db, start, end, denomination, currency) for currency in ("USD", "BITCOIN")},
        "native_flows": {currency: flow(db, start, end, currency, currency) for currency in ("USD", "BITCOIN")},
        "performance": account_performance(db, history, accounts, denomination),
        "history": history,
        "accounts": accounts,
        "recent": [transaction_dict(db, e, reporting=True) for e in active_transactions(db, start, end)[:8]],
        "rate": {
            "usd_per_btc": rate.usd_per_btc,
            "day": rate.day,
            "source": rate.source,
            "fetched_at": rate.fetched_at,
            "stale": False if isinstance(rate, PriceQuote) else rate.day != str(end),
            "observed_at": rate.observed_at,
        }
        if rate
        else None,
        "valuation_basis": "dated historical rate" if historical else "latest recorded rate",
        "missing_rates": net is None,
    }


def budgets_report(db, month):
    start, end = month_days(month)
    entries = active_transactions(db, start, end)
    result = []
    for budget in db.scalars(select(Budget).where(Budget.month == month)):
        values = []
        for entry in entries:
            if entry.kind == "expense" and entry.category_id == budget.category_id:
                acc = db.get(Account, entry.account_id)
                if budget.scope == "all" or acc.currency == budget.currency:
                    values.append(
                        convert(entry.amount_minor, acc.currency, budget.currency, reporting_rate(db, entry)["value"])
                    )
        actual = add_nullable(values)
        planned = original(budget.amount_minor, budget.currency)
        result.append(
            {
                "id": budget.id,
                "category_id": budget.category_id,
                "category": db.get(Category, budget.category_id).name,
                "currency": budget.currency,
                "scope": budget.scope,
                "planned": planned,
                "actual": actual,
                "remaining": str(Decimal(planned) - Decimal(actual)) if actual is not None else None,
                "percent": str((Decimal(actual) * 100 / Decimal(planned)).quantize(Decimal(".1")))
                if actual is not None
                else None,
            }
        )
    return result


def budget_overview(db, month):
    """USD category plans with historical equivalents of posted spending only.

    Older currency/scope plans remain intact in the legacy budgets report.
    This category view includes expenses in both currencies; it never converts
    a bitcoin allowance into an assumed USD plan.
    """
    start, end = month_days(month)
    plans = list(db.scalars(select(Budget).where(Budget.month == month)))
    dollars = {p.category_id: p for p in plans if p.currency == "USD"}
    spent = {}
    estimated_categories = set()
    category_ids = {p.category_id for p in plans}
    for entry in active_transactions(db, start, end):
        if entry.kind != "expense":
            continue
        category_ids.add(entry.category_id)
        currency = db.get(Account, entry.account_id).currency
        values = spent.setdefault(entry.category_id, {"USD": [], "BITCOIN": []})
        reference = reporting_rate(db, entry)
        if reference["basis"] == "current_estimate":
            estimated_categories.add(entry.category_id)
        for unit in values:
            values[unit].append(convert(entry.amount_minor, currency, unit, reference["value"]))
    result = []
    for cat in db.scalars(select(Category).where(Category.id.in_(category_ids)).order_by(Category.name)):
        plan = dollars.get(cat.id)
        planned = original(plan.amount_minor, "USD") if plan else None
        values = spent.get(cat.id, {"USD": [], "BITCOIN": []})
        usd, bitcoin = add_nullable(values["USD"]), add_nullable(values["BITCOIN"])
        result.append(
            {
                "category_id": cat.id,
                "category": cat.name,
                "budget_id": plan.id if plan else None,
                "estimated": cat.id in estimated_categories,
                "planned_usd": planned,
                "spent_usd": usd,
                "spent_bitcoin": bitcoin,
                "remaining_usd": str(Decimal(planned) - Decimal(usd))
                if planned is not None and usd is not None
                else None,
                "percent": str(
                    (Decimal(usd) * 100 / Decimal(planned)).quantize(Decimal(".1"), rounding=ROUND_HALF_EVEN)
                )
                if planned is not None and usd is not None
                else None,
            }
        )
    return result
