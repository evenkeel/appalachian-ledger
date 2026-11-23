"""The demo: a made-up person, real bitcoin prices, and nothing guessed."""

from collections import Counter, defaultdict
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from app import alerts
from app.dashboard import build
from app.db import SessionLocal
from app.demo import seed_demo
from app.demo_life import PRICE_FILE, is_payday, load_prices, simulate, window_start
from app.models import Account, BillOccurrence, ExchangeRate, ExpenseCost, JournalEntry, RecurringBill, User
from app.money import convert
from app.prices import parse_time

PRICES = load_prices()
# The day the demo was built for: the morning after the last saved close.
DAY = PRICES.end + timedelta(days=1)


def days(start, end):
    return [start + timedelta(days=n) for n in range((end - start).days + 1)]


def seeded(owner, today=DAY, **options):
    """A session on the owner's ledger holding the demo as loaded on ``today``."""
    db = SessionLocal()
    life = seed_demo(db, db.scalar(select(User)), today=today, **options)
    db.commit()
    return db, life


# ---------- The price file ----------


def test_the_price_file_holds_a_real_close_for_every_day_of_the_window():
    start = window_start(PRICES)
    assert PRICES.source == "Coinbase" and PRICES.method == "daily_close"
    assert parse_time(PRICES.retrieved_at).date() > PRICES.end, "closes are completed UTC days only"
    assert (PRICES.end.year - start.year, start.day) == (5, 1), "five years, opening on the first of a month"
    missing = [str(day) for day in days(start, PRICES.end) if PRICES.close(day) is None]
    assert not missing, f"days in the demo window with no saved close: {missing[:5]}"
    assert all(Decimal(value) > 0 for value in PRICES.closes.values())
    # A real market never repeats itself for a week; a made-up or filled-in line would.
    values = [PRICES.close(day) for day in days(start, PRICES.end)]
    assert max(Counter(values).values()) <= 2
    assert all(len(set(values[n : n + 7])) > 3 for n in range(0, len(values) - 7, 7))
    assert "ictional" not in PRICE_FILE.read_text()


def test_the_website_quote_is_a_dated_real_observation():
    assert Decimal(PRICES.quote["usd_per_btc"]) > 0
    assert parse_time(PRICES.quote["observed_at"]).date() >= PRICES.end


# ---------- His life, before it touches a ledger ----------


def test_every_bitcoin_buy_is_the_dollars_paid_at_that_days_real_close():
    life = simulate(DAY, PRICES)
    buys = [event for event in life.events if event.destination == "bitcoin"]
    assert len(buys) > 120
    for buy in buys:
        close = PRICES.close(buy.day)
        assert close is not None, f"a buy on {buy.day}, a day with no saved close"
        assert buy.bitcoin == int(convert(buy.amount, "USD", "BITCOIN", close)), buy
    assert sum(buy.bitcoin for buy in buys) + life.opening["bitcoin"] == life.balances["bitcoin"]


def test_he_buys_every_payday_through_the_whole_cycle():
    life = simulate(DAY, PRICES)
    bought = {event.day for event in life.events if event.destination == "bitcoin"}
    paid = {event.day for event in life.events if event.description.startswith("Paycheck")}
    paydays = [day for day in days(life.start, PRICES.end) if is_payday(day)]
    assert set(paydays) <= paid and set(paydays) <= bought
    # He starts small, and what he holds only ever grows.
    by_year = defaultdict(int)
    for event in life.events:
        if event.destination == "bitcoin":
            by_year[event.day.year] += event.amount
    full_years = [by_year[year] for year in sorted(by_year)[1:]]
    assert full_years[0] < full_years[-1] and full_years[0] < 200000


def test_days_after_the_price_file_get_dollars_but_no_buy_and_no_price(owner):
    # The same demo, loaded forty days after its price file ends.
    cut = PRICES.end - timedelta(days=40)
    older = replace(PRICES, end=cut, closes={day: close for day, close in PRICES.closes.items() if day <= str(cut)})
    life = simulate(DAY, older)
    after = [event for event in life.events if event.day > cut]
    assert any(event.description.startswith("Paycheck") for event in after)
    assert not [event for event in after if event.destination == "bitcoin"]
    db, _ = seeded(owner, prices=older, months=3)
    with db:
        assert not db.scalar(select(ExchangeRate).where(ExchangeRate.day > str(cut)))
        late = list(db.scalars(select(JournalEntry).where(JournalEntry.date > str(cut))))
        assert late and all(entry.rate_snapshot is None and entry.rate_id is None for entry in late)
        costed = set(db.scalars(select(ExpenseCost.entry_id)))
        assert not costed & {entry.id for entry in late}, "an expense after the file must show its price as missing"


def test_his_money_holds_together_for_five_years():
    life = simulate(DAY, PRICES)
    assert life.start == window_start(PRICES) and life.events[0].day == life.start
    assert life.lowest_checking > 20000, "checking never runs dry"
    assert life.highest_card_use <= 0.9
    assert life.longest_quiet_stretch <= 1, "no empty stretches"
    assert life.days_without_entries < len(days(life.start, DAY)) // 10
    # Every bill is paid on every due date, and no bill is left overdue today.
    paid = defaultdict(set)
    for event in life.events:
        if event.bill:
            paid[event.bill].add(event.day)
    assert len(paid["Rent"]) == 61 and all(day.day == 1 for day in paid["Rent"])
    assert all(bill["next_due"] > DAY for bill in life.bills if not bill["destroyed"])
    # Months are lived, not copied: no two have the same entries.
    months = defaultdict(list)
    for event in life.events:
        months[event.day.strftime("%Y-%m")].append((event.day.day, event.description, event.amount))
    assert len(months) == 61 and len({tuple(rows) for rows in months.values()}) == 61
    assert min(len(rows) for month, rows in months.items() if month != DAY.strftime("%Y-%m")) > 45


def test_dollar_prices_rise_and_the_same_day_always_reads_the_same():
    life = simulate(DAY, PRICES)
    rent = {event.day.year: event.amount for event in life.events if event.bill == "Rent" and event.day.month == 9}
    assert rent[2022] < rent[2023] < rent[2024] < rent[2025] < rent[2026]
    shops = defaultdict(list)
    for event in life.events:
        if event.description == "Groceries":
            shops[event.day.year].append(event.amount)
    average = {year: sum(rows) / len(rows) for year, rows in shops.items()}
    assert average[2022] < average[2023] < average[2026] and average[2026] > average[2022] * 1.2
    # Loading the demo a month later adds a month; it does not rewrite what came before.
    longer = simulate(DAY + timedelta(days=30), PRICES)
    assert longer.events[: len(life.events)] == life.events and len(longer.events) > len(life.events)


# ---------- In the ledger ----------


def test_the_loaded_demo_has_no_fictional_or_guessed_rate_anywhere(owner):
    db, life = seeded(owner)
    with db:
        rates = {rate.day: rate for rate in db.scalars(select(ExchangeRate))}
        assert sorted(rates) == [str(day) for day in days(life.start, PRICES.end)]
        for day, rate in rates.items():
            assert (rate.source, rate.method, rate.usd_per_btc) == ("Coinbase", "daily_close", PRICES.close(day)), day
            assert rate.observed_at == f"{date.fromisoformat(day) + timedelta(days=1)}T00:00:00+00:00"
            assert rate.fetched_at == PRICES.retrieved_at

        accounts = {account.id: account for account in db.scalars(select(Account))}
        entries = list(db.scalars(select(JournalEntry).order_by(JournalEntry.id)))
        assert len(entries) > 4000
        for entry in entries:
            # Every entry on a day with a close carries exactly that close.
            assert entry.date <= str(PRICES.end) or entry.date == str(DAY)
            if entry.date <= str(PRICES.end):
                assert entry.rate_snapshot == PRICES.close(entry.date) and entry.rate_id == rates[entry.date].id, (
                    entry.date
                )
            else:
                assert entry.rate_snapshot is None and entry.rate_id is None

        buys = [
            e
            for e in entries
            if e.kind == "transfer" and e.destination_id and accounts[e.destination_id].currency == "BITCOIN"
        ]
        assert len(buys) > 120
        for buy in buys:
            assert str(buy.destination_minor) == convert(buy.amount_minor, "USD", "BITCOIN", PRICES.close(buy.date)), (
                buy.date
            )

        costs = {cost.entry_id: cost for cost in db.scalars(select(ExpenseCost))}
        expenses = [e for e in entries if e.kind == "expense" and e.date <= str(PRICES.end)]
        assert len(expenses) > 3500 and {e.id for e in expenses} == set(costs)
        for expense in expenses:
            cost = costs[expense.id]
            close = PRICES.close(expense.date)
            assert (cost.source, cost.method, cost.usd_per_btc) == ("Coinbase", "daily_close", close)
            assert cost.bitcoin == convert(expense.amount_minor, "USD", "BITCOIN", close)

        words = [rate.source for rate in rates.values()] + [cost.source for cost in costs.values()]
        assert not [word for word in words if "ictional" in word or "demo" in word.lower()]

        # The ledger agrees with the plan to the cent and to the bitcoin.
        from app.accounting import balance

        by_name = {account.name: account for account in accounts.values()}
        assert balance(db, by_name["Everyday checking"].id) == life.balances["checking"]
        assert -balance(db, by_name["Ridgeline Visa"].id) == life.balances["card"]
        assert -balance(db, by_name["Car loan"].id) == life.balances["loan"]
        assert balance(db, by_name["Bitcoin wallet"].id) == life.balances["bitcoin"]
        assert {"Blue Ridge home", "Home mortgage", "Long-term brokerage", "Cold storage"}.isdisjoint(by_name)

        # Bills keep their history, and the two he cancelled are destroyed, not forgotten.
        rent = db.scalar(select(RecurringBill).where(RecurringBill.description == "Rent"))
        assert len(list(db.scalars(select(BillOccurrence).where(BillOccurrence.bill_id == rent.id)))) == 61
        destroyed = list(db.scalars(select(RecurringBill).where(RecurringBill.destroyed_on.is_not(None))))
        assert {bill.description for bill in destroyed} == {"Sports streaming", "Game pass"}


def test_on_the_day_it_was_built_for_the_demo_is_calm_and_complete(owner):
    db, life = seeded(owner)
    with db:
        data = build(db, DAY)
        assert data["first_entry_date"] == str(life.start) and data["days_of_history"] > 1825
        assert [account["name"] for account in data["checking"]["accounts"]] == ["Everyday checking"]
        ahead = data["cash_ahead"]
        assert ahead["status"] == "ready" and ahead["short"] is None
        assert (
            ahead["next_paycheck"]["name"] == "Paycheck"
            and date.fromisoformat(ahead["next_paycheck"]["date"]).weekday() == 4
        )
        assert [(row["name"], row["plan"]) for row in ahead["cards"]] == [("Ridgeline Visa", "full")]
        bills = {row["name"]: row for row in data["bills"]["items"]}
        assert {"Rent", "Electric", "Internet", "Phone", "Car insurance", "Car payment", "Streaming", "Gym"} <= set(
            bills
        )
        assert all(not row["overdue"] and row["days_until"] > 0 for row in bills.values())
        assert bills["Car payment"]["payoff"] == f"{life.balances['loan'] / 100:.2f}"
        assert data["bills"]["destroyed"]["count"] == 2
        (card,) = data["debt"]["cards"]
        assert card["name"] == "Ridgeline Visa" and Decimal(card["utilization"]) < 30
        assert [loan["name"] for loan in data["debt"]["loans"]] == ["Car loan"]
        stack = data["stack"]
        assert stack["status"] == "ready" and stack["held"] == str(life.balances["bitcoin"])
        assert stack["streak_months"] >= 6 and stack["stack_rate"] is not None
        assert data["pace"]["missing_conversions"] <= 3, "only today's own entries can still lack a close"
        assert data["budgets"]["items"]
        assert data["setup"] == {
            "has_account": True,
            "has_paycheck": True,
            "has_bills": True,
            "has_bitcoin": True,
            "has_price_source": True,
            "has_backup": False,
        }
        lights = {item["id"]: item["level"] for item in alerts.read(db, DAY)["active"]}
        assert not {"overdue", "cash", "util", "pace"} & set(lights), lights
        assert all(level != "warning" for level in lights.values())


def test_a_shorter_demo_opens_with_the_balances_he_had_by_then(owner):
    db, life = seeded(owner, months=4)
    with db:
        full = simulate(DAY, PRICES)
        assert life.balances == full.balances and life.start > full.start
        assert life.start.day == 1 and db.scalar(select(JournalEntry.date).order_by(JournalEntry.date)) == str(
            life.start
        )
        assert life.opening["bitcoin"] > 0 and life.opening["loan"] > 0
