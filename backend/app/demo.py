"""The fictional demo: one made-up person's money, priced with real bitcoin closes.

The person, his pay, his bills and everything he spends are fictional; they come from the plan
in `demo_plan.py`. The bitcoin prices are real: Coinbase BTC-USD daily closes saved in
`demo_data/btc_usd_daily.json`, with their source and retrieval time. Seeding reads that file
and never calls the network, so the demo loads offline.

The demo opens five years before the file's last close and runs through today. The file ends
at a release date, so days after it have no saved close. Those days are entered in dollars
only: their bitcoin price is left missing, and he records no bitcoin buy on them, because a buy
needs a real price. The demo turns on automatic Coinbase prices, so the ledger's ordinary price
sync fills those days in when the computer is online. Nothing is guessed in the meantime.
"""

import json
from datetime import date, timedelta
from sqlalchemy import select
from . import demo_plan as plan
from .accounting import audit, create_account, create_transaction
from .demo_life import load_prices, simulate, window_start
from .models import (
    Account,
    BillOccurrence,
    Budget,
    CardTerms,
    Category,
    ExchangeRate,
    IncomeSchedule,
    RecurringBill,
)
from .money import original
from .reports import month_sequence
from .schemas import AccountInput, TransactionInput


def seed_demo(db, user, today=None, prices=None, months=None):
    """Load the demo person into an empty ledger.

    ``months`` loads only that many recent months, opening with the balances he had by then.
    The full five years is the default and what the app and the website use.
    """
    if db.scalar(select(Account.id).limit(1)):
        raise ValueError("Demo requires an empty ledger")
    today = today or date.today()
    prices = prices or load_prices()
    start = window_start(prices)
    if months:
        index = today.year * 12 + today.month - months
        start = max(start, date(index // 12, index % 12 + 1, 1))
    life = simulate(today, prices, start)

    # Real daily closes, labelled exactly as the price sync would have saved them.
    last_priced = min(prices.end, today)
    day = life.start
    while day <= last_priced:
        close = prices.close(day)
        if close is not None:
            db.add(
                ExchangeRate(
                    day=str(day),
                    usd_per_btc=close,
                    source=prices.source,
                    method=prices.method,
                    observed_at=f"{day + timedelta(days=1)}T00:00:00+00:00",
                    fetched_at=prices.retrieved_at,
                )
            )
        day += timedelta(days=1)
    # The ledger prices entries from the owner's chosen source, so choose it before the first entry.
    user.preferences = json.dumps(json.loads(user.preferences) | {"rate_source": "coinbase", "automatic_prices": True})
    db.flush()

    categories = {category.name: category for category in db.scalars(select(Category))}
    for name in plan.INCOME_CATEGORIES:
        if name not in categories:
            categories[name] = Category(name=name, kind="income")
            db.add(categories[name])
    for name, spending_type in plan.CATEGORIES.items():
        if name not in categories:
            categories[name] = Category(name=name, kind="expense")
            db.add(categories[name])
        categories[name].spending_type = spending_type
    db.flush()

    def open_account(key, kind, currency, amount, opened):
        return create_account(
            db,
            AccountInput(
                name=plan.ACCOUNTS[key],
                kind=kind,
                currency=currency,
                opening_balance=original(amount, currency),
                date=opened,
            ),
        )

    accounts = {
        "checking": open_account("checking", "checking", "USD", life.opening["checking"], life.start),
        "card": open_account("card", "credit_card", "USD", life.opening["card"], life.start),
        "bitcoin": open_account("bitcoin", "bitcoin_wallet", "BITCOIN", life.opening["bitcoin"], life.start),
    }
    if life.loan_opened:
        owed = life.opening["loan"] or plan.CAR_LOAN["principal"]
        accounts["loan"] = open_account("loan", "loan", "USD", owed, life.loan_opened)
    db.add(CardTerms(account_id=accounts["card"].id, credit_limit_minor=life.card_limit, due_day=plan.CARD_DUE_DAY))

    # Bills as they stand today. The two he cancelled are kept as destroyed.
    bills = {}
    for item in life.bills:
        bills[item["name"]] = bill = RecurringBill(
            account_id=accounts[item["pay_with"]].id,
            category_id=categories[item["category"]].id,
            description=item["name"],
            amount=original(item["amount"], "USD"),
            frequency="monthly",
            next_due=str(item["next_due"]),
            anchor_day=item["day"],
            anchor_month=item["next_due"].month,
            archived=item["destroyed"] is not None,
            destroyed_on=str(item["destroyed"]) if item["destroyed"] else None,
        )
        db.add(bill)
    if "loan" in accounts and life.balances["loan"] > 0:
        due = today.replace(day=plan.CAR_LOAN["due_day"])
        if due <= today:
            due = (due.replace(day=1) + timedelta(days=32)).replace(day=plan.CAR_LOAN["due_day"])
        due = max(due, plan.CAR_LOAN["first_payment"])
        db.add(
            RecurringBill(
                account_id=accounts["checking"].id,
                category_id=categories["Transport"].id,
                description="Car payment",
                amount=original(life.loan_payment, "USD"),
                frequency="monthly",
                next_due=str(due),
                anchor_day=plan.CAR_LOAN["due_day"],
                anchor_month=due.month,
                pays_account_id=accounts["loan"].id,
            )
        )
    db.flush()

    # Every entry goes through the same door a typed-in one does.
    for event in life.events:
        entry = create_transaction(
            db,
            TransactionInput(
                date=event.day,
                kind=event.kind,
                account_id=accounts[event.account].id,
                amount=original(event.amount, "USD"),
                description=event.description,
                category_id=categories[event.category].id if event.category else None,
                destination_id=accounts[event.destination].id if event.destination else None,
                destination_amount=str(event.bitcoin) if event.bitcoin is not None else None,
            ),
        )
        if event.bill:
            db.add(BillOccurrence(bill_id=bills[event.bill].id, due_date=str(event.day), entry_id=entry.id))

    # Paid every second Friday; the schedule only forecasts and never posts income.
    db.add(
        IncomeSchedule(
            account_id=accounts["checking"].id,
            name="Paycheck",
            amount=original(life.take_home, "USD"),
            frequency="biweekly",
            next_date=str(life.next_payday),
            anchor_day=life.next_payday.day,
        )
    )
    first_month = life.start.strftime("%Y-%m")
    for month in month_sequence(today, plan.ALLOWANCE_MONTHS):
        if month < first_month:
            continue
        for name, amount in plan.ALLOWANCES.items():
            db.add(
                Budget(month=month, category_id=categories[name].id, amount_minor=amount, currency="USD", scope="all")
            )
    user.demo = True
    audit(
        db,
        "demo.seed",
        user.id,
        {"person": "fictional", "prices": f"{prices.source} {prices.method}", "prices_through": str(prices.end)},
    )
    return life
