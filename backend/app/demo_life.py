"""Turns the plan in `demo_plan.py` into the demo person's dated transactions.

Pure arithmetic: no database and no network. Dollars are fictional and come from the plan.
Bitcoin amounts are real arithmetic on real prices: every buy is the dollars paid divided by
that day's Coinbase close from the price file, rounded the way the ledger rounds. A day with
no close in the file gets no buy; nothing is guessed or interpolated.

The same day always produces the same entries, whatever day the demo is loaded on, so moving
the window forward at a release extends his history without rewriting it.
"""

import calendar
import json
import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from pathlib import Path

from . import demo_plan as plan
from .money import convert

PRICE_FILE = Path(__file__).parent / "demo_data" / "btc_usd_daily.json"
WINDOW_YEARS = 5


@dataclass(frozen=True)
class Prices:
    """Real BTC-USD daily closes, as saved by `scripts/demo_prices.py`."""

    source: str
    method: str
    retrieved_at: str
    start: date
    end: date
    closes: dict
    quote: dict | None

    def close(self, day):
        return self.closes.get(str(day))


def load_prices(path=PRICE_FILE):
    data = json.loads(Path(path).read_text())
    return Prices(
        source=data["source"],
        method=data["method"],
        retrieved_at=data["retrieved_at"],
        start=date.fromisoformat(data["start"]),
        end=date.fromisoformat(data["end"]),
        closes=data["closes"],
        quote=data.get("quote"),
    )


def window_start(prices):
    """The demo opens on the first day of the month five years before the last saved close."""
    start = date(prices.end.year - WINDOW_YEARS, prices.end.month, 1)
    return max(start, plan.ORIGIN, prices.start)


@dataclass
class Event:
    day: date
    kind: str  # "income", "expense" or "transfer"
    account: str  # "checking" or "card"
    amount: int  # cents
    description: str
    category: str | None = None
    destination: str | None = None  # for a transfer: "card", "loan" or "bitcoin"
    bitcoin: int | None = None  # bitcoin received, for a buy
    bill: str | None = None  # the bill this payment belongs to


@dataclass
class Life:
    start: date
    today: date
    events: list  # from `start` on, in the order they happened
    opening: dict  # balances on the morning of `start`: checking, card, loan (cents) and bitcoin
    balances: dict  # the same, at the end of `today`
    loan_opened: date | None  # when the car loan appears in the window, if it has
    loan_payment: int
    bills: list  # every bill as it stands today: name, category, pay_with, amount, day, next_due, destroyed
    next_payday: date
    take_home: int
    card_limit: int
    lowest_checking: int
    highest_card_use: float
    days_without_entries: int = 0
    longest_quiet_stretch: int = 0
    notes: dict = field(default_factory=dict)


def day_in_month(year, month, day):
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_month(day):
    return (day.replace(day=1) + timedelta(days=32)).replace(day=1)


def is_payday(day):
    return day >= plan.FIRST_PAYDAY and (day - plan.FIRST_PAYDAY).days % 14 == 0


def payday_after(day):
    behind = (day - plan.FIRST_PAYDAY).days
    return plan.FIRST_PAYDAY if behind < 0 else plan.FIRST_PAYDAY + timedelta(days=(behind // 14 + 1) * 14)


def loan_payment():
    """The level monthly payment, to the cent."""
    with localcontext() as ctx:
        ctx.prec = 40
        rate = Decimal(str(plan.CAR_LOAN["apr"])) / 12
        principal, months = Decimal(plan.CAR_LOAN["principal"]), plan.CAR_LOAN["months"]
        payment = principal * rate / (1 - (1 + rate) ** -months)
        return int(payment.quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def monthly_interest(balance, apr):
    with localcontext() as ctx:
        ctx.prec = 40
        return int((Decimal(balance) * Decimal(str(apr)) / 12).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def gas_price(day):
    return plan.GAS_PRICE.get(day.year, {}).get(day.month, plan.LATEST_GAS)


def bill_due(bill, day):
    """The bill's amount if it falls due on ``day``, else None."""
    if day != day_in_month(day.year, day.month, bill.day):
        return None
    if bill.destroyed and day >= bill.destroyed:
        return None
    return plan.at(bill.amounts, day)


def simulate(today, prices, start=None):
    """His whole life from the plan's first day through ``today``; entries are kept from ``start`` on."""
    start = start or window_start(prices)
    if today < start:
        raise ValueError("The demo's price file starts after today. Check this computer's date.")
    limit = lambda day: plan.at(plan.CARD_LIMIT, day)  # noqa: E731
    money = {"checking": plan.OPENING["checking"], "card": plan.OPENING["card"], "loan": 0, "bitcoin": 0}
    opening = None
    events = []
    carried = 0  # what last month's card payment left unpaid
    statement = 0
    payment = loan_payment()
    last_fill, last_cut, last_oil = (
        plan.ORIGIN - timedelta(days=5),
        plan.ORIGIN - timedelta(days=16),
        plan.ORIGIN - timedelta(days=70),
    )
    shop_on_sunday = False
    lowest, highest_use = money["checking"], 0.0
    quiet, longest_quiet, empty_days = 0, 0, 0
    one_offs = {}
    for item in plan.ONE_OFFS:
        one_offs.setdefault(item.day, []).append(item)

    made = [0]  # entries so far, counting the ones before the window opens

    def record(event):
        made[0] += 1
        if event.day >= start:
            events.append(event)

    def spend(day, name, category, amount, pay_with, *, bill=None, must=True):
        """One purchase. A debit he cannot cover goes on the card; a full card falls back to debit."""
        room = limit(day) * 9 // 10 - money["card"]
        if pay_with == "checking" and amount > money["checking"] - 2500:
            if amount <= room:
                pay_with = "card"
            elif not must:
                return False
        elif pay_with == "card" and amount > room:
            if amount <= money["checking"] - 2500:
                pay_with = "checking"
            elif not must:
                return False
        if pay_with == "card":
            money["card"] += amount
        else:
            money["checking"] -= amount
        record(Event(day, "expense", pay_with, amount, name, category, bill=bill))
        return True

    def checking_bills_between(after, through):
        """What checking has to cover after ``after`` up to and including ``through``."""
        total, day = 0, after + timedelta(days=1)
        while day <= through:
            for bill in plan.BILLS:
                if bill.pay_with == "checking":
                    total += bill_due(bill, day) or 0
            if money["loan"] and day.day == plan.CAR_LOAN["due_day"] and day >= plan.CAR_LOAN["first_payment"]:
                total += payment
            day += timedelta(days=1)
        return total

    def buy(day, dollars):
        close = prices.close(day)
        dollars = min(dollars, money["checking"] - 2500)
        if close is None or dollars <= 0:
            return
        received = int(convert(dollars, "USD", "BITCOIN", close))
        if received <= 0:
            return
        money["checking"] -= dollars
        money["bitcoin"] += received
        record(Event(day, "transfer", "checking", dollars, "Bitcoin buy", destination="bitcoin", bitcoin=received))

    day = plan.ORIGIN
    while day <= today:
        if day == start:
            opening = dict(money)
        before = made[0]
        rng = random.Random(f"appalachian-demo|{day.isoformat()}")
        roll = rng.random

        def between(low, high, level=1.0):
            return round((low + (high - low) * roll() ** 1.5) * level * 100)

        cushion = plan.at(plan.CUSHION, day)
        # He counts what is on the card as already spent.
        tight = money["checking"] - money["card"] < cushion * 2 // 5 or carried > 0

        # Money in.
        if is_payday(day):
            pay = round(plan.at(plan.TAKE_HOME, day) * plan.SHORT_CHECKS.get(day, 1))
            chance = plan.OVERTIME_CHANCE["summer" if day.month in (5, 6, 7, 8, 9) else "rest"]
            overtime = roll() < chance and day not in plan.SHORT_CHECKS
            if overtime:
                low, high = plan.OVERTIME_RANGE
                pay = round(pay * (1 + low + (high - low) * roll()))
            money["checking"] += pay
            record(
                Event(day, "income", "checking", pay, "Paycheck, with overtime" if overtime else "Paycheck", "Salary")
            )
        if day in plan.TAX_REFUNDS:
            money["checking"] += plan.TAX_REFUNDS[day]
            record(Event(day, "income", "checking", plan.TAX_REFUNDS[day], "Tax refund", "Other income"))
        for item in one_offs.get(day, []):
            if item.kind == "income":
                money["checking"] += item.amount
                record(Event(day, "income", "checking", item.amount, item.name, item.category))

        # The card: interest on what was left unpaid, then this month's statement, then the payment.
        if day.day == 1:
            if carried > 0:
                interest = monthly_interest(carried, plan.CARD_APR)
                if interest:
                    money["card"] += interest
                    record(Event(day, "expense", "card", interest, "Interest charge", "Other expense"))
            statement = money["card"]
        if day.day == plan.CARD_DUE_DAY and statement > 0:
            reserve = checking_bills_between(day, payday_after(day)) + plan.CARD_PAYMENT_FLOOR
            afford = money["checking"] - reserve
            owed = min(statement, money["card"])
            paid = owed if afford >= owed else max(min(plan.CARD_MINIMUM, owed), afford // 2500 * 2500)
            paid = max(0, min(paid, owed, money["checking"] - 2500))
            if paid:
                money["checking"] -= paid
                money["card"] -= paid
                record(
                    Event(
                        day,
                        "transfer",
                        "checking",
                        paid,
                        f"Payment: {plan.ACCOUNTS['checking']} → {plan.ACCOUNTS['card']}",
                        destination="card",
                    )
                )
            carried = owed - paid

        # The car loan.
        if day == plan.CAR_LOAN["opened"]:
            money["loan"] = plan.CAR_LOAN["principal"]
            last_oil = day
        if money["loan"] and day.day == plan.CAR_LOAN["due_day"] and day >= plan.CAR_LOAN["first_payment"]:
            interest = monthly_interest(money["loan"], plan.CAR_LOAN["apr"])
            principal = min(payment - interest, money["loan"])
            money["checking"] -= principal + interest
            money["loan"] -= principal
            record(
                Event(
                    day,
                    "transfer",
                    "checking",
                    principal,
                    f"Payment: {plan.ACCOUNTS['checking']} → {plan.ACCOUNTS['loan']}",
                    destination="loan",
                )
            )
            if interest:
                record(
                    Event(
                        day, "expense", "checking", interest, f"Interest & fees: {plan.ACCOUNTS['loan']}", "Transport"
                    )
                )

        # Bills, on the day they are due.
        for bill in plan.BILLS:
            amount = bill_due(bill, day)
            if amount is None:
                continue
            if bill.seasonal:
                amount = round(amount * plan.ELECTRIC_SEASON[day.month] * (0.93 + 0.14 * roll()))
            spend(day, bill.name, bill.category, amount, bill.pay_with, bill=bill.name)

        # The things that only happen once.
        for item in one_offs.get(day, []):
            if item.kind == "expense":
                spend(day, item.name, item.category, item.amount, item.pay_with)

        # The week's proper grocery shop.
        weekday = day.weekday()
        shop = plan.WEEKLY_SHOP
        if weekday == 5:
            shop_on_sunday = roll() >= shop["saturday"]
        if (weekday == 5 and not shop_on_sunday) or (weekday == 6 and shop_on_sunday):
            level = plan.at(plan.PRICE_LEVEL["groceries"], day) * (shop["alone"] if day >= shop["alone_since"] else 1)
            spend(
                day,
                "Groceries",
                "Groceries",
                between(shop["low"], shop["high"], level * (0.9 if tight else 1)),
                "checking",
            )

        # Gas, a haircut, an oil change: each comes round when it is due.
        since = (day - last_fill).days
        if since >= plan.FILL_UP["latest"] or (since >= plan.FILL_UP["soonest"] and roll() < plan.FILL_UP["chance"]):
            low, high = plan.FILL_UP["gallons"]
            spend(day, "Gas", "Transport", round((low + (high - low) * roll()) * gas_price(day) * 100), "card")
            last_fill = day
        since = (day - last_cut).days
        if weekday != 6 and (
            since >= plan.HAIRCUT["latest"] or (since >= plan.HAIRCUT["soonest"] and roll() < plan.HAIRCUT["chance"])
        ):
            price = plan.at(plan.HAIRCUT["price"], day)
            spend(day, "Haircut", "Personal care", price + round(price * (0.15 + 0.1 * roll()) / 100) * 100, "checking")
            last_cut = day
        if weekday == 5 and (day - last_oil).days >= plan.OIL_CHANGE["every_days"]:
            spend(
                day,
                "Oil change",
                "Transport",
                between(plan.OIL_CHANGE["low"], plan.OIL_CHANGE["high"], plan.at(plan.PRICE_LEVEL["general"], day)),
                "card",
            )
            last_oil = day
        gifts = plan.CHRISTMAS
        if day.month == 12 and gifts["from_day"] <= day.day <= gifts["to_day"] and roll() < gifts["chance"]:
            name = gifts["names"][int(roll() * len(gifts["names"]))]
            spend(
                day,
                name,
                "Gifts & events",
                between(gifts["low"], gifts["high"], plan.at(plan.PRICE_LEVEL["general"], day)),
                "card",
            )

        # Everyday habits. When money is tight he cuts back on the ones he can.
        for habit in plan.HABITS:
            if (habit.since and day < habit.since) or (habit.until and day > habit.until):
                continue
            chance = habit.chance[weekday] * (habit.cut_back if tight else 1)
            if roll() < chance:
                name = habit.names[int(roll() * len(habit.names))]
                amount = between(habit.low, habit.high, plan.at(plan.PRICE_LEVEL[habit.level], day))
                if habit.step:
                    amount = max(habit.step, round(amount / habit.step) * habit.step)
                spend(day, name, habit.category, amount, habit.pay_with, must=habit.cut_back == 1.0)

        # Bitcoin: every payday, more when checking has spare beyond the bills and his cushion.
        if is_payday(day):
            dollars = plan.at(plan.PAYDAY_BUY, day)
            spare = (
                money["checking"] - money["card"] - dollars - checking_bills_between(day, payday_after(day)) - cushion
            )
            if spare > 0 and not tight:
                dollars += min(plan.at(plan.SPARE_BUY_LIMIT, day), int(spare * plan.SPARE_SHARE) // 2500 * 2500)
            buy(day, dollars)
        if day in plan.TAX_REFUNDS:
            buy(day, plan.REFUND_BUY)

        # He is in a shop most days. Two days running with nothing at all would not be like him.
        entries_today = made[0] - before
        if entries_today == 0 and quiet >= 1:
            spend(
                day,
                "Corner store",
                "Groceries",
                between(4.5, 12, plan.at(plan.PRICE_LEVEL["groceries"], day)),
                "checking",
            )
            entries_today = 1
        lowest = min(lowest, money["checking"])
        highest_use = max(highest_use, money["card"] / limit(day))
        if entries_today == 0:
            quiet += 1
            if day >= start:
                empty_days += 1
                longest_quiet = max(longest_quiet, quiet)
        else:
            quiet = 0
        day += timedelta(days=1)

    bills = []
    for bill in plan.BILLS:
        destroyed = bill.destroyed if bill.destroyed and bill.destroyed <= today else None
        due = day_in_month(today.year, today.month, bill.day)
        if due <= today:
            following = next_month(today)
            due = day_in_month(following.year, following.month, bill.day)
        amount = plan.at(bill.amounts, destroyed - timedelta(days=1) if destroyed else due)
        if amount is None:
            continue  # not started yet
        bills.append(
            {
                "name": bill.name,
                "category": bill.category,
                "pay_with": bill.pay_with,
                "amount": amount,
                "day": bill.day,
                "next_due": due,
                "destroyed": destroyed,
            }
        )
    loan_seen = money["loan"] > 0 or (opening or {}).get("loan", 0) > 0
    return Life(
        start=start,
        today=today,
        events=events,
        opening=opening,
        balances=dict(money),
        loan_opened=(max(plan.CAR_LOAN["opened"], start) if loan_seen else None),
        loan_payment=payment,
        bills=bills,
        next_payday=payday_after(today),
        take_home=plan.at(plan.TAKE_HOME, payday_after(today)),
        card_limit=limit(today),
        lowest_checking=lowest,
        highest_card_use=highest_use,
        days_without_entries=empty_days,
        longest_quiet_stretch=longest_quiet,
    )
