import json
from datetime import date
from sqlalchemy import select, or_
from .models import (
    Account,
    Asset,
    AssetPrice,
    AuditEvent,
    Category,
    ConversionAttachment,
    ExchangeRate,
    ExpenseCost,
    JournalEntry,
    Posting,
    Portfolio,
    Holding,
    PriceQuote,
    User,
)
from .prices import parse_time, utcnow
from .money import checked, to_minor, original, convert, exchange_price

LIABILITIES = {"credit_card", "loan", "mortgage", "other_liability"}


def audit(db, action, entity, detail):
    db.add(AuditEvent(action=action, entity=str(entity), detail=json.dumps(detail, sort_keys=True)))


def account(db, id, active=True):
    obj = db.get(Account, id)
    if not obj or obj.internal or (active and obj.archived):
        raise ValueError("Account not found or archived")
    return obj


def rate_for(db, day):
    source = selected_source(db)
    query = select(ExchangeRate).where(ExchangeRate.day == str(day))
    if source != "manual":
        provider, method = ("Coinbase", "daily_close") if source == "coinbase" else ("CoinGecko", "midnight")
        # A source change never silently substitutes demo or another provider's methodology.
        query = query.where(
            or_(ExchangeRate.source == "Manual", (ExchangeRate.source == provider) & (ExchangeRate.method == method))
        )
    else:
        query = query.where(or_(ExchangeRate.method == "legacy", ExchangeRate.source == "Manual"))
    return db.scalar(query.order_by((ExchangeRate.source == "Manual").desc(), ExchangeRate.id.desc()))


def selected_source(db):
    user = db.scalar(select(User))
    return json.loads(user.preferences).get("rate_source", "manual") if user else "manual"


def entry_rate(db, entry):
    if entry.rate_snapshot is not None:
        return entry.rate_snapshot
    attachment = db.get(ConversionAttachment, entry.id)
    return db.get(ExchangeRate, attachment.rate_id).usd_per_btc if attachment else None


def reporting_rate(db, entry):
    """Resolve display conversions without rewriting a journal's saved snapshot.

    Historical gaps use only an exact-date reference. Today's fresh market quote
    may be used provisionally, never substituted for a past day's rate.
    """
    saved = entry_rate(db, entry)
    if saved is not None:
        return {"value": saved, "basis": "saved", "source": None, "observed_at": None}
    reference = rate_for(db, entry.date)
    if reference:
        return {
            "value": reference.usd_per_btc,
            "basis": "dated_reference",
            "source": reference.source,
            "observed_at": reference.observed_at or reference.day,
        }
    quote = current_rate(db) if entry.date == str(date.today()) else None
    if isinstance(quote, PriceQuote):
        return {
            "value": quote.usd_per_btc,
            "basis": "current_estimate",
            "source": quote.source,
            "observed_at": quote.observed_at or quote.day,
        }
    return {"value": None, "basis": "missing", "source": None, "observed_at": None}


def current_rate(db, day=None):
    source = selected_source(db)
    if source != "manual":
        if day and str(day) < str(utcnow().astimezone().date()):
            return rate_for(db, day)
        quote = db.get(PriceQuote, "Coinbase" if source == "coinbase" else "CoinGecko")
        if quote and -60 <= (utcnow() - parse_time(quote.observed_at)).total_seconds() <= 600:
            return quote
        return None
    return db.scalar(
        select(ExchangeRate)
        .where(
            ExchangeRate.day <= str(day or date.today()),
            or_(ExchangeRate.method == "legacy", ExchangeRate.source == "Manual"),
        )
        .order_by(ExchangeRate.day.desc(), ExchangeRate.id.desc())
    )


def internal_account(db, role, currency):
    name = f"__{role}_{currency}"
    result = db.scalar(select(Account).where(Account.name == name))
    if not result:
        result = Account(name=name, kind=role, role=role, currency=currency, internal=True)
        db.add(result)
        db.flush()
    return result


def balance(db, id, day=None):
    stmt = (
        select(Posting.amount_minor).join(JournalEntry).where(Posting.account_id == id, JournalEntry.status == "posted")
    )
    if day:
        stmt = stmt.where(JournalEntry.date <= str(day))
    # Python integers prevent SQLite SUM overflow, then enforce the balance bound.
    return checked(sum(db.scalars(stmt)))


def post(db, entry, legs):
    effective_date = date.fromisoformat(entry.date)
    if effective_date > date.today() or effective_date.year < 1970:
        raise ValueError("Entries must be dated between 1970 and today")
    totals = {}
    if len(legs) < 2:
        raise ValueError("A journal entry requires at least two postings")
    for acc, amount in legs:
        portfolio = db.get(Portfolio, acc.id) if not acc.internal else None
        if portfolio and entry.date < portfolio.started_on:
            raise ValueError(
                "Share tracking has started for this account. Use a current adjustment instead of changing earlier history."
            )
        if not acc.internal and entry.kind != "valuation" and not (portfolio and entry.date == str(date.today())):
            latest = db.scalar(
                select(AssetPrice.date)
                .join(Asset)
                .where(Asset.account_id == acc.id, AssetPrice.date >= entry.date)
                .limit(1)
            )
            if latest:
                raise ValueError(
                    "This account has a valuation on or after that date. Record a current adjustment instead of changing valued history."
                )
        checked(amount)
        totals[acc.currency] = totals.get(acc.currency, 0) + amount
        checked(balance(db, acc.id) + amount)
    if any(totals.values()):
        raise ValueError("Journal must balance independently in each original currency")
    db.add(entry)
    db.flush()
    for acc, amount in legs:
        db.add(Posting(entry_id=entry.id, account_id=acc.id, amount_minor=amount))
    db.flush()
    entry.status = "posted"
    db.flush()
    audit(db, "journal.post", entry.id, {"kind": entry.kind, "date": entry.date})
    return entry


def adjustment(db, acc, amount, day, description, kind="adjustment"):
    rate = rate_for(db, day)
    # Positive user-facing liability balance means a credit (negative ledger balance).
    signed = -amount if acc.role == "liability" else amount
    return post(
        db,
        JournalEntry(
            date=str(day),
            kind=kind,
            description=description,
            account_id=acc.id,
            amount_minor=amount,
            rate_id=rate.id if rate else None,
            rate_snapshot=rate.usd_per_btc if rate else None,
        ),
        [(acc, signed), (internal_account(db, "equity", acc.currency), -signed)],
    )


def create_account(db, data):
    if data.name.startswith("__") or not data.name.strip():
        raise ValueError("Invalid account name")
    if data.kind == "bitcoin_wallet" and data.currency != "BITCOIN":
        raise ValueError("Bitcoin wallets must use bitcoin")
    obj = Account(
        name=data.name.strip(),
        kind=data.kind,
        role="liability" if data.kind in LIABILITIES else "asset",
        currency=data.currency,
    )
    db.add(obj)
    db.flush()
    amount = to_minor(data.opening_balance, data.currency)
    adjustment(db, obj, amount, data.date, "Opening balance", "opening")
    audit(db, "account.create", obj.id, {"name": obj.name})
    return obj


def create_transaction(db, data, import_key=None, replaces_id=None):
    acc = account(db, data.account_id)
    amount = to_minor(data.amount, acc.currency)
    if amount <= 0:
        raise ValueError("Transaction amount must be positive")
    if data.kind in {"expense", "transfer"} and db.get(Portfolio, acc.id):
        marked = sum(db.scalars(select(Holding.marked_minor).where(Holding.account_id == acc.id)))
        cash = balance(db, acc.id) - marked
        if amount > cash:
            raise ValueError("This payment exceeds the brokerage account's uninvested cash")
    rate = rate_for(db, data.date)
    snapshot = rate.usd_per_btc if rate else None
    previous = db.get(JournalEntry, replaces_id) if replaces_id else None
    if previous and previous.kind == data.kind == "expense" and previous.date == str(data.date):
        # Cost history already preserves this reference. Keep the corrected
        # journal, reports and budgets on the same purchase-date basis.
        cost = db.get(ExpenseCost, previous.id)
        saved = cost.usd_per_btc if cost else entry_rate(db, previous)
        if saved is not None:
            snapshot = saved
            rate = db.get(ExchangeRate, previous.rate_id) if previous.rate_id else None
            if rate and rate.usd_per_btc != saved:
                rate = None
    entry = JournalEntry(
        date=str(data.date),
        kind=data.kind,
        description=data.description,
        notes=data.notes,
        account_id=acc.id,
        amount_minor=amount,
        rate_id=rate.id if rate else None,
        rate_snapshot=snapshot,
        import_key=import_key,
        replaces_id=replaces_id,
    )
    if data.kind == "transfer":
        dest = account(db, data.destination_id)
        if dest.id == acc.id:
            raise ValueError("Transfer needs two different accounts")
        if data.category_id:
            raise ValueError("Transfers cannot have income or expense categories")
        target = to_minor(data.destination_amount or data.amount, dest.currency)
        if target <= 0:
            raise ValueError("Destination amount must be positive")
        if acc.currency == dest.currency and target != amount:
            raise ValueError("Same-currency transfers must have equal amounts")
        entry.destination_id, entry.destination_minor = dest.id, target
        legs = [(acc, -amount), (dest, target)]
        if acc.currency != dest.currency:
            if data.destination_amount is None:
                raise ValueError("Enter the actual received amount for a cross-currency transfer")
            legs += [
                (internal_account(db, "clearing", acc.currency), amount),
                (internal_account(db, "clearing", dest.currency), -target),
            ]
    else:
        if data.destination_id or data.destination_amount:
            raise ValueError("Only transfers have a destination")
        category = db.get(Category, data.category_id) if data.category_id else None
        if not category or category.kind != data.kind:
            raise ValueError("Choose a matching income or expense category")
        entry.category_id = category.id
        signed = amount if data.kind == "income" else -amount
        legs = [(acc, signed), (internal_account(db, data.kind, acc.currency), -signed)]
    result = post(db, entry, legs)
    if data.kind == "expense":
        from .costs import capture

        capture(db, entry_id=entry.id)
    return result


def active_transactions(db, start=None, end=None):
    reversals = select(JournalEntry.reverses_id).where(JournalEntry.reverses_id.is_not(None))
    stmt = select(JournalEntry).where(
        JournalEntry.kind.in_(["income", "expense", "transfer"]),
        JournalEntry.status == "posted",
        JournalEntry.id.not_in(reversals),
    )
    if start:
        stmt = stmt.where(JournalEntry.date >= str(start))
    if end:
        stmt = stmt.where(JournalEntry.date <= str(end))
    return list(db.scalars(stmt.order_by(JournalEntry.date.desc(), JournalEntry.id.desc())))


def validate_portfolio_cash(db, account_ids):
    for id in set(account_ids):
        if db.get(Portfolio, id):
            marked = sum(db.scalars(select(Holding.marked_minor).where(Holding.account_id == id)))
            if balance(db, id) < marked:
                raise ValueError("This correction exceeds the brokerage account's uninvested cash")


def reverse(db, id, validate_cash=True):
    entry = db.get(JournalEntry, id)
    if not entry or entry.kind not in ("income", "expense", "transfer"):
        raise ValueError("Transaction not found")
    if db.scalar(select(JournalEntry).where(JournalEntry.reverses_id == id)):
        raise ValueError("Transaction already reversed")
    legs = [
        (db.get(Account, p.account_id), -p.amount_minor)
        for p in db.scalars(select(Posting).where(Posting.entry_id == id))
    ]
    post(
        db,
        JournalEntry(
            date=entry.date,
            kind="reversal",
            description=f"Reversal of entry {id}",
            account_id=entry.account_id,
            amount_minor=-entry.amount_minor,
            rate_snapshot=entry.rate_snapshot,
            rate_id=entry.rate_id,
            reverses_id=id,
        ),
        legs,
    )
    affected = [acc.id for acc, _ in legs if not acc.internal]
    if validate_cash:
        validate_portfolio_cash(db, affected)
    audit(db, "transaction.reverse", id, {"original_description": entry.description})
    return affected


def transaction_dict(db, entry, reporting=False):
    from .costs import snapshot_dict

    acc = db.get(Account, entry.account_id)
    destination = db.get(Account, entry.destination_id) if entry.destination_id else None
    cat = db.get(Category, entry.category_id) if entry.category_id else None
    reference = (
        reporting_rate(db, entry)
        if reporting
        else {"value": entry_rate(db, entry), "basis": "saved", "source": None, "observed_at": None}
    )
    return {
        "id": entry.id,
        "date": entry.date,
        "kind": entry.kind,
        "description": entry.description,
        "notes": entry.notes,
        "account_id": acc.id,
        "account": acc.name,
        "currency": acc.currency,
        "amount": original(entry.amount_minor, acc.currency),
        "actual_exchange_price": exchange_price(
            entry.amount_minor if acc.currency == "USD" else entry.destination_minor,
            entry.destination_minor if acc.currency == "USD" else entry.amount_minor,
        )
        if destination and destination.currency != acc.currency
        else None,
        "destination_id": entry.destination_id,
        "destination_currency": db.get(Account, entry.destination_id).currency if entry.destination_id else None,
        "destination_account": db.get(Account, entry.destination_id).name if entry.destination_id else None,
        "destination_amount": original(entry.destination_minor, db.get(Account, entry.destination_id).currency)
        if entry.destination_id
        else None,
        "category_id": entry.category_id,
        "category": cat.name if cat else "Transfer",
        "bitcoin": convert(entry.amount_minor, acc.currency, "BITCOIN", reference["value"]),
        "usd": convert(entry.amount_minor, acc.currency, "USD", reference["value"]),
        "conversion_basis": reference["basis"],
        "conversion_rate": reference["value"],
        "conversion_source": reference["source"],
        "conversion_at": reference["observed_at"],
        "rate_snapshot": entry_rate(db, entry),
        "original_rate_snapshot": entry.rate_snapshot,
        "conversion_attachment_rate_id": attachment.rate_id
        if (attachment := db.get(ConversionAttachment, entry.id))
        else None,
        "rate_id": entry.rate_id,
        "valuation_basis": "native bitcoin" if acc.currency == "BITCOIN" else "historical purchasing power",
        "created_at": entry.created_at,
        "purchase_cost": snapshot_dict(db, entry.id),
    }
