"""Explicitly fictional data. Never fetched or represented as real market history."""

from datetime import date, timedelta
from sqlalchemy import select
from .accounting import create_account, create_transaction, adjustment, balance, audit
from .models import Account, Asset, AssetPrice, Budget, Category, ExchangeRate, RecurringBill, SavingsGoal
from .reports import month_sequence, month_days
from .schemas import AccountInput, TransactionInput


def seed_demo(db, user):
    if db.scalar(select(Account.id).limit(1)):
        raise ValueError("Demo requires an empty ledger")
    today = date.today()
    months = month_sequence(today, 6)
    first = month_days(months[0])[0]
    day = first
    while day <= today:
        # Fictional daily price path, with clear source labels and no random fluctuations.
        offset = (day - first).days
        value = 92000 + offset * 155 + (offset % 13) * 92
        db.add(ExchangeRate(day=str(day), usd_per_btc=str(value), source="Fictional demo rate"))
        day += timedelta(days=1)
    db.flush()
    specs = [
        ("Cold storage", "bitcoin_wallet", "BITCOIN", "18500000"),
        ("Spending wallet", "bitcoin_wallet", "BITCOIN", "420000"),
        ("Everyday checking", "checking", "USD", "8200"),
        ("Rainy day savings", "savings", "USD", "18000"),
        ("Long-term brokerage", "brokerage", "USD", "42500"),
        ("Blue Ridge home", "real_estate", "USD", "325000"),
        ("Home mortgage", "mortgage", "USD", "214000"),
    ]
    accounts = {}
    for name, kind, currency, amount in specs:
        accounts[kind] = create_account(
            db, AccountInput(name=name, kind=kind, currency=currency, opening_balance=amount, date=first)
        )
    cats = {c.name: c.id for c in db.scalars(select(Category))}
    spending_types = {
        "Housing": "fixed",
        "Utilities": "fixed",
        "Groceries": "essential",
        "Health": "essential",
        "Transport": "essential",
        "Dining": "discretionary",
        "Shopping": "discretionary",
    }
    for category in db.scalars(select(Category).where(Category.kind == "expense")):
        category.spending_type = spending_types.get(category.name, category.spending_type)
    for idx, month in enumerate(months):
        start, end = month_days(month)
        events = [
            (2, "income", "Salary", "6200", "Monthly salary"),
            (4, "expense", "Groceries", str(286 + idx * 7), "Mountain market"),
            (7, "expense", "Utilities", "184.50", "Electric & water"),
            (9, "expense", "Transport", "72.40", "Fuel & transit"),
            (12, "expense", "Dining", "68.25", "Dinner on Main Street"),
            (16, "expense", "Groceries", "194.80", "Weekly groceries"),
            (18, "income", "Freelance", "850", "Design project"),
            (21, "expense", "Housing", "720", "Mortgage interest & insurance"),
            (23, "expense", "Health", "145", "Health & wellness"),
            (26, "expense", "Shopping", "129.95", "Home essentials"),
        ]
        for d, kind, cat, amount, description in events:
            when = date(start.year, start.month, d)
            if when > today:
                continue
            create_transaction(
                db,
                TransactionInput(
                    date=when,
                    kind=kind,
                    account_id=accounts["checking"].id,
                    amount=amount,
                    category_id=cats[cat],
                    description=description,
                ),
            )
        # Actual bitcoin activity stays distinct from the USD expenses above.
        for d, kind, category_name, amount, description in [
            (6, "income", "Freelance", "100000", "Fictional bitcoin consulting payment"),
            (14, "expense", "Dining", "18000", "Fictional bitcoin cafe purchase"),
        ]:
            when = date(start.year, start.month, d)
            if when <= today:
                create_transaction(
                    db,
                    TransactionInput(
                        date=when,
                        kind=kind,
                        account_id=accounts["bitcoin_wallet"].id,
                        amount=amount,
                        category_id=cats[category_name],
                        description=description,
                    ),
                )
        db.add(Budget(month=month, category_id=cats["Dining"], amount_minor=40000, currency="BITCOIN", scope="native"))
        when = start + timedelta(days=9)
        if when <= today:
            create_transaction(
                db,
                TransactionInput(
                    date=when,
                    kind="transfer",
                    account_id=accounts["checking"].id,
                    destination_id=accounts["brokerage"].id,
                    amount="500",
                    description="Monthly investment contribution",
                ),
            )
            create_transaction(
                db,
                TransactionInput(
                    date=when,
                    kind="transfer",
                    account_id=accounts["checking"].id,
                    destination_id=accounts["mortgage"].id,
                    amount="680",
                    description="Mortgage principal",
                ),
            )
            create_transaction(
                db,
                TransactionInput(
                    date=when,
                    kind="transfer",
                    account_id=accounts["checking"].id,
                    destination_id=accounts["savings"].id,
                    amount="1200",
                    description="Monthly savings",
                ),
            )
        for name, planned in [
            ("Groceries", "60000"),
            ("Dining", "18000"),
            ("Transport", "20000"),
            ("Housing", "70000"),
            ("Shopping", "22000"),
        ]:
            db.add(
                Budget(month=month, category_id=cats[name], amount_minor=int(planned), currency="USD", scope="native")
            )
    for kind in ("real_estate", "brokerage"):
        acc = accounts[kind]
        asset = Asset(account_id=acc.id, name=acc.name, kind=kind, quantity="1")
        db.add(asset)
        db.flush()
        # The current month has no valuation yet: one dated today would block new
        # transfers into the account and a same-day "Update value".
        for idx, month in enumerate(months[:-1]):
            day = month_days(month)[1]
            base = 32500000 if kind == "real_estate" else 4250000
            value = base + idx * (110000 if kind == "real_estate" else 65000)
            if kind == "brokerage":
                value += (idx + 1) * 50000
            entry = adjustment(
                db, acc, value - balance(db, acc.id, day), day, "Fictional manual valuation", "valuation"
            )
            db.add(AssetPrice(asset_id=asset.id, date=str(day), value_minor=value, entry_id=entry.id))
    # Upcoming bills mirror the monthly expenses above, so the planner has something to show.
    for day_of_month, category, amount, description in [
        (7, "Utilities", "184.50", "Electric & water"),
        (21, "Housing", "720.00", "Mortgage interest & insurance"),
        (23, "Health", "145.00", "Health & wellness"),
    ]:
        due = today.replace(day=day_of_month)
        if due <= today:
            due = (due.replace(day=1) + timedelta(days=32)).replace(day=day_of_month)
        db.add(
            RecurringBill(
                account_id=accounts["checking"].id,
                category_id=cats[category],
                description=description,
                amount=amount,
                frequency="monthly",
                next_due=str(due),
                anchor_day=day_of_month,
                anchor_month=due.month,
            )
        )
    # Two goals share the savings account; the earlier one fills first.
    trip = (today.replace(day=1) + timedelta(days=125)).replace(day=1)
    fund = (today.replace(day=1) + timedelta(days=400)).replace(day=1)
    for name, target, target_date in [("Summer trip", 300000, trip), ("Emergency fund", 3000000, fund)]:
        db.add(
            SavingsGoal(name=name, account_id=accounts["savings"].id, target_minor=target, target_date=str(target_date))
        )
    user.demo = True
    audit(db, "demo.seed", user.id, {"fictional": True})
