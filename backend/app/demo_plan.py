"""The demo person, written as a plan.

He is made up. He is a single man who is 25 today, an electrician who started as a first-year
apprentice at 20, working in the city and renting. The ledger follows his money from November
2021: a shared apartment and an old car, a better job, his own place, a car loan, rent that
goes up at every renewal, and a little bitcoin bought every payday the whole way through.

Everything here is fictional: the person, his pay, his bills and what he spends. Dollar prices
are modelled on how rent, groceries, gas and insurance moved in the United States from 2021
on, including the 2022 jump; they are approximations, not data. The only real figures in the
demo are bitcoin's prices, which come from `demo_data/btc_usd_daily.json` and never from here.

`demo.py` turns this plan into transactions. To change his life, change this file.
"""

from dataclasses import dataclass
from datetime import date

# His first month in the ledger, and the first of his paydays (every second Friday).
ORIGIN = date(2021, 11, 1)
FIRST_PAYDAY = date(2021, 11, 5)

ACCOUNTS = {"checking": "Everyday checking", "card": "Ridgeline Visa", "bitcoin": "Bitcoin wallet", "loan": "Car loan"}
# What he had on the morning of 1 November 2021.
OPENING = {"checking": 1_431_60, "card": 186_42}


def usd(value: float) -> int:
    """Dollars as written in this plan, to whole cents."""
    return round(value * 100)


def at(steps, day):
    """The value in force on ``day`` from dated steps, or None before the first step or after an end."""
    value = None
    for since, step in steps:
        if since > day:
            break
        value = step
    return value


# ---------- Work ----------

# Take-home pay for two ordinary weeks. Each step is a raise, or the job change in March 2023.
TAKE_HOME = [
    (date(2021, 11, 1), usd(1012.40)),  # first-year apprentice at a small residential outfit
    (date(2022, 6, 1), usd(1094.85)),  # second-year step
    (date(2023, 3, 13), usd(1318.60)),  # moves to a commercial contractor downtown
    (date(2024, 3, 1), usd(1486.25)),
    (date(2025, 3, 1), usd(1652.70)),
    (date(2026, 3, 1), usd(1818.40)),  # final-year apprentice
]
# The week between jobs: his first check from the new contractor covers one week, not two.
SHORT_CHECKS = {date(2023, 3, 24): 0.5}
# Overtime turns up in about one check in five, more often in summer when sites are busy.
OVERTIME_CHANCE = {"summer": 0.34, "rest": 0.16}
OVERTIME_RANGE = (0.07, 0.24)  # extra, as a share of an ordinary check

# Federal and state refunds, a few weeks after he files.
TAX_REFUNDS = {
    date(2022, 2, 25): usd(412.00),
    date(2023, 3, 3): usd(538.00),
    date(2024, 2, 23): usd(611.00),
    date(2025, 2, 28): usd(704.00),
    date(2026, 2, 27): usd(655.00),
}

# ---------- Bitcoin: his saving ----------

# Bought every payday, whatever the price is doing. He raises it when his pay goes up.
PAYDAY_BUY = [
    (date(2021, 11, 1), usd(25)),
    (date(2022, 6, 1), usd(30)),
    (date(2023, 3, 13), usd(40)),
    (date(2024, 3, 1), usd(50)),
    (date(2025, 3, 1), usd(75)),
    (date(2026, 3, 1), usd(100)),
]
# The dollars he likes to keep in checking once the bills before next payday are covered.
CUSHION = [
    (date(2021, 11, 1), usd(900)),
    (date(2023, 1, 1), usd(3400)),  # putting dollars by for a deposit and first month on his own place
    (date(2023, 8, 1), usd(1500)),  # moved in: rent alone is now over a thousand
    (date(2024, 1, 1), usd(2600)),  # and again for the down payment on a car
    (date(2024, 6, 1), usd(1500)),
    (date(2025, 3, 1), usd(1700)),
]
# Half of what checking holds beyond that cushion goes into bitcoin on payday as well, in round
# $25 steps, up to a limit. The limit starts tiny and he raises it as his pay grows.
SPARE_SHARE = 0.5
SPARE_BUY_LIMIT = [
    (date(2021, 11, 1), usd(25)),
    (date(2023, 10, 1), usd(50)),
    (date(2024, 7, 1), usd(75)),
    (date(2025, 3, 1), usd(175)),
    (date(2026, 3, 1), usd(300)),
]
# A slice of each tax refund is stacked the day it lands.
REFUND_BUY = usd(150)

# ---------- The credit card ----------

CARD_LIMIT = [(date(2021, 11, 1), usd(1500)), (date(2023, 6, 1), usd(3000)), (date(2025, 4, 1), usd(5000))]
CARD_DUE_DAY = 18
CARD_APR = 0.2499
CARD_MINIMUM = usd(35)
# He pays the statement in full when he can. He will not run checking below this to do it.
CARD_PAYMENT_FLOOR = usd(600)

# ---------- The car loan ----------

# May 2024: the 2009 Civic is traded in on a used 2019 Corolla.
CAR_LOAN = {
    "opened": date(2024, 5, 25),
    "principal": usd(11_000),
    "apr": 0.094,
    "months": 60,
    "due_day": 3,
    "first_payment": date(2024, 7, 3),
}


# ---------- Bills ----------


@dataclass(frozen=True)
class Bill:
    name: str
    category: str
    day: int  # day of the month it is due
    pay_with: str  # "checking" or "card"
    amounts: tuple  # dated steps in cents; a step of None ends the bill
    seasonal: bool = False  # electricity: the amount follows the weather
    destroyed: date | None = None  # cancelled for good on this day


BILLS = (
    Bill(
        "Rent",
        "Housing",
        1,
        "checking",
        (
            (date(2021, 11, 1), usd(640)),  # his half of a two-bedroom shared with a roommate
            (date(2022, 8, 1), usd(675)),  # renewal
            (date(2023, 8, 1), usd(1095)),  # his own one-bedroom
            (date(2024, 8, 1), usd(1150)),  # renewal
            (date(2025, 8, 1), usd(1195)),  # renewal
            (date(2026, 8, 1), usd(1245)),  # renewal
        ),
    ),
    Bill(
        "Renter's insurance",
        "Housing",
        5,
        "checking",
        ((date(2023, 8, 1), usd(14.50)), (date(2024, 8, 1), usd(15.75)), (date(2025, 8, 1), usd(16.50))),
    ),
    Bill(
        "Electric",
        "Utilities",
        22,
        "checking",
        # A typical month. Half the bill while he had a roommate, all of it since.
        (
            (date(2021, 11, 1), usd(39)),
            (date(2022, 7, 1), usd(45)),
            (date(2023, 8, 1), usd(71)),
            (date(2024, 6, 1), usd(74)),
            (date(2025, 6, 1), usd(79)),
            (date(2026, 6, 1), usd(83)),
        ),
        seasonal=True,
    ),
    Bill(
        "Internet",
        "Utilities",
        9,
        "checking",
        (
            (date(2021, 11, 1), usd(32.50)),  # his half
            (date(2023, 8, 1), usd(55)),  # first-year price at the new place
            (date(2024, 8, 1), usd(70)),  # the promotion ends
            (date(2026, 2, 1), usd(75)),
        ),
    ),
    Bill(
        "Phone",
        "Utilities",
        14,
        "checking",
        ((date(2021, 11, 1), usd(45)), (date(2024, 4, 1), usd(50)), (date(2026, 1, 1), usd(55))),
    ),
    Bill(
        "Car insurance",
        "Transport",
        26,
        "checking",
        # Dear for a man of 20, dearer through 2023 and 2024 like everyone's, easing as he nears 25.
        (
            (date(2021, 11, 1), usd(148)),
            (date(2022, 5, 1), usd(153)),
            (date(2022, 11, 1), usd(162)),
            (date(2023, 5, 1), usd(177)),
            (date(2023, 11, 1), usd(191)),
            (date(2024, 6, 1), usd(229)),  # the newer car, with the cover the lender requires
            (date(2024, 11, 1), usd(238)),
            (date(2025, 5, 1), usd(231)),
            (date(2025, 11, 1), usd(222)),
            (date(2026, 5, 1), usd(214)),
            (date(2026, 11, 1), usd(196)),  # the renewal after his 25th birthday
        ),
    ),
    Bill(
        "Streaming",
        "Subscriptions",
        7,
        "card",
        ((date(2021, 11, 1), usd(13.99)), (date(2022, 2, 1), usd(15.49)), (date(2025, 2, 1), usd(17.99))),
    ),
    Bill(
        "Music",
        "Subscriptions",
        11,
        "card",
        ((date(2021, 11, 1), usd(9.99)), (date(2023, 8, 1), usd(10.99)), (date(2024, 7, 1), usd(11.99))),
    ),
    Bill(
        "Gym",
        "Subscriptions",
        2,
        "card",
        ((date(2022, 1, 2), usd(22.99)), (date(2024, 7, 1), usd(24.99)), (date(2026, 1, 1), usd(26.99))),
    ),
    # Two he signed up for and, after October 2026's repair bill, cancelled for good.
    Bill(
        "Sports streaming",
        "Subscriptions",
        16,
        "card",
        ((date(2023, 9, 1), usd(9.99)), (date(2025, 9, 1), usd(10.99))),
        destroyed=date(2026, 10, 19),
    ),
    Bill(
        "Game pass",
        "Subscriptions",
        21,
        "card",
        ((date(2024, 1, 1), usd(14.99)), (date(2025, 10, 1), usd(16.99))),
        destroyed=date(2026, 10, 19),
    ),
)

# Electricity through the year, against a typical month: air conditioning in summer, a little heat in winter.
ELECTRIC_SEASON = {
    1: 1.12,
    2: 1.06,
    3: 0.92,
    4: 0.84,
    5: 0.9,
    6: 1.1,
    7: 1.3,
    8: 1.28,
    9: 1.04,
    10: 0.84,
    11: 0.88,
    12: 1.04,
}

# ---------- What things cost ----------

# Price levels against November 2021, read off US averages: groceries jumped in 2022 and then
# crept; eating out kept climbing; everything else sat between. Approximations, not data.
PRICE_LEVEL = {
    "groceries": [
        (date(2021, 11, 1), 1.00),
        (date(2022, 3, 1), 1.04),
        (date(2022, 7, 1), 1.09),
        (date(2022, 11, 1), 1.12),
        (date(2023, 6, 1), 1.14),
        (date(2024, 6, 1), 1.155),
        (date(2025, 6, 1), 1.185),
        (date(2026, 6, 1), 1.21),
    ],
    "eating_out": [
        (date(2021, 11, 1), 1.00),
        (date(2022, 6, 1), 1.05),
        (date(2022, 12, 1), 1.085),
        (date(2023, 6, 1), 1.115),
        (date(2023, 12, 1), 1.14),
        (date(2024, 6, 1), 1.16),
        (date(2024, 12, 1), 1.18),
        (date(2025, 6, 1), 1.205),
        (date(2025, 12, 1), 1.225),
        (date(2026, 6, 1), 1.25),
    ],
    "general": [
        (date(2021, 11, 1), 1.00),
        (date(2022, 6, 1), 1.055),
        (date(2022, 12, 1), 1.075),
        (date(2023, 12, 1), 1.11),
        (date(2024, 12, 1), 1.14),
        (date(2025, 12, 1), 1.17),
        (date(2026, 6, 1), 1.185),
    ],
}

# A gallon of regular by month, close to the US average; 2022 is the spike everyone remembers.
GAS_PRICE = {
    2021: {11: 3.39, 12: 3.31},
    2022: {
        1: 3.31,
        2: 3.52,
        3: 4.22,
        4: 4.11,
        5: 4.44,
        6: 4.93,
        7: 4.56,
        8: 3.98,
        9: 3.70,
        10: 3.82,
        11: 3.69,
        12: 3.21,
    },
    2023: {
        1: 3.34,
        2: 3.39,
        3: 3.42,
        4: 3.60,
        5: 3.56,
        6: 3.57,
        7: 3.60,
        8: 3.84,
        9: 3.84,
        10: 3.61,
        11: 3.32,
        12: 3.13,
    },
    2024: {
        1: 3.08,
        2: 3.21,
        3: 3.43,
        4: 3.61,
        5: 3.60,
        6: 3.46,
        7: 3.48,
        8: 3.39,
        9: 3.21,
        10: 3.14,
        11: 3.05,
        12: 3.02,
    },
    2025: {
        1: 3.08,
        2: 3.12,
        3: 3.10,
        4: 3.17,
        5: 3.15,
        6: 3.16,
        7: 3.14,
        8: 3.14,
        9: 3.17,
        10: 3.08,
        11: 3.06,
        12: 2.98,
    },
    2026: {
        1: 2.96,
        2: 3.02,
        3: 3.11,
        4: 3.19,
        5: 3.22,
        6: 3.20,
        7: 3.18,
        8: 3.15,
        9: 3.12,
        10: 3.06,
        11: 3.02,
        12: 2.99,
    },
}
LATEST_GAS = 3.05  # for months this table has not reached

# ---------- Everyday spending ----------


@dataclass(frozen=True)
class Habit:
    names: tuple  # what the entry is called; picked in turn at random
    category: str
    pay_with: str  # "checking" (his debit card) or "card"
    low: float  # a small one, in November 2021 dollars
    high: float  # a big one
    level: str  # which price level moves it
    chance: tuple  # how likely on each weekday, Monday first
    cut_back: float = 1.0  # how much of it survives when money is tight (1 = all of it)
    since: date | None = None
    until: date | None = None
    step: int = 0  # round to this many cents, for amounts that only come in round figures


WEEKDAYS = (1, 1, 1, 1, 1, 0, 0)
EVERY_DAY = (1, 1, 1, 1, 1, 1, 1)


def on(days, chance):
    return tuple(day * chance for day in days)


HABITS = (
    Habit(
        ("Corner store", "Grocery top-up", "Milk and bread"),
        "Groceries",
        "checking",
        5.5,
        19,
        "groceries",
        on(EVERY_DAY, 0.2),
    ),
    Habit(
        ("Lunch", "Sandwich shop", "Food truck", "Gas station lunch", "Diner lunch"),
        "Dining",
        "checking",
        8.5,
        13.5,
        "eating_out",
        on(WEEKDAYS, 0.4),
        cut_back=0.5,
    ),
    Habit(
        ("Coffee", "Coffee and a breakfast sandwich", "Coffee"),
        "Dining",
        "checking",
        2.25,
        6.25,
        "eating_out",
        on(WEEKDAYS, 0.3),
        cut_back=0.6,
    ),
    Habit(
        ("Energy drink and snacks", "Gas station snacks", "Vending machine"),
        "Dining",
        "checking",
        2.5,
        7.5,
        "eating_out",
        on(WEEKDAYS, 0.24),
        cut_back=0.6,
    ),
    Habit(
        ("Pizza", "Chinese takeout", "Tacos", "Wings", "Burger place", "Sub shop"),
        "Dining",
        "card",
        12.5,
        27,
        "eating_out",
        (0.16, 0.16, 0.18, 0.18, 0.22, 0.22, 0.32),
        cut_back=0.4,
    ),
    Habit(
        ("Bar tab", "Beers with the crew", "Pool hall", "Brewery"),
        "Nights out",
        "card",
        22,
        58,
        "eating_out",
        (0, 0, 0.03, 0.1, 0.48, 0.5, 0.05),
        cut_back=0.3,
    ),
    Habit(
        ("Cash from the ATM",),
        "Other expense",
        "checking",
        20,
        60,
        "general",
        (0.02, 0.02, 0.02, 0.03, 0.09, 0.08, 0.02),
        cut_back=0.5,
        step=usd(20),
    ),
    Habit(
        ("Ballgame tickets", "Concert", "Movie night", "Bowling"),
        "Nights out",
        "card",
        16,
        82,
        "general",
        (0, 0, 0, 0, 0.03, 0.09, 0.05),
        cut_back=0.15,
    ),
    Habit(
        ("Parking", "Parking meter", "Parking garage"), "Transport", "checking", 3.5, 13, "general", on(WEEKDAYS, 0.07)
    ),
    Habit(
        ("Pharmacy", "Household stuff", "Hardware store", "Dollar store"),
        "Shopping",
        "checking",
        8,
        41,
        "general",
        on(EVERY_DAY, 0.085),
        cut_back=0.7,
    ),
    Habit(
        ("Online order", "Online order", "Phone case", "Video game"),
        "Shopping",
        "card",
        11,
        62,
        "general",
        on(EVERY_DAY, 0.04),
        cut_back=0.25,
    ),
    Habit(
        ("Jeans", "Work shirts", "Sneakers", "Hoodie", "Work gloves and socks"),
        "Shopping",
        "card",
        22,
        92,
        "general",
        (0.012, 0.012, 0.012, 0.012, 0.02, 0.05, 0.04),
        cut_back=0.2,
    ),
    Habit(
        ("Hand tools", "Drill bits and blades", "Tool bag", "Meter leads"),
        "Shopping",
        "card",
        16,
        118,
        "general",
        on(EVERY_DAY, 0.011),
        cut_back=0.3,
    ),
    Habit(("Prescription", "Pharmacy copay"), "Health", "checking", 9, 28, "general", on(EVERY_DAY, 0.012)),
    Habit(("Car wash",), "Transport", "checking", 9, 15, "general", (0, 0, 0, 0, 0.01, 0.05, 0.04), cut_back=0.2),
    # No washer in the one-bedroom.
    Habit(
        ("Laundromat",),
        "Personal care",
        "checking",
        5.5,
        8.5,
        "general",
        (0.03, 0.03, 0.03, 0.03, 0.03, 0.2, 0.62),
        since=date(2023, 8, 6),
    ),
)

# One proper grocery shop a week, on Saturday or Sunday. It grows a little when he lives alone.
WEEKLY_SHOP = {"low": 46, "high": 74, "saturday": 0.6, "alone_since": date(2023, 8, 1), "alone": 1.14}
# A tank about every eight days.
FILL_UP = {"gallons": (9.2, 11.8), "soonest": 6, "latest": 10, "chance": 0.3}
# A haircut about every four weeks, with a tip.
HAIRCUT = {
    "soonest": 24,
    "latest": 33,
    "chance": 0.16,
    "price": [
        (date(2021, 11, 1), usd(24)),
        (date(2023, 1, 1), usd(27)),
        (date(2024, 6, 1), usd(30)),
        (date(2026, 1, 1), usd(33)),
    ],
}
# An oil change about every five months.
OIL_CHANGE = {"every_days": 150, "low": 44, "high": 72}
# Christmas presents, bought over the middle of December.
CHRISTMAS = {
    "from_day": 9,
    "to_day": 22,
    "chance": 0.3,
    "low": 22,
    "high": 78,
    "names": ("Christmas present", "Present for Mom", "Present for Dad", "Present for his sister"),
}

# ---------- The things that only happen once ----------


@dataclass(frozen=True)
class OneOff:
    day: date
    name: str
    category: str
    amount: int
    pay_with: str = "card"
    kind: str = "expense"


def yearly(month, day, name, category, amount, pay_with, years=range(2022, 2040), growth=0.03):
    return tuple(
        OneOff(date(year, month, day), name, category, round(amount * (1 + growth) ** (year - 2022)), pay_with)
        for year in years
    )


ONE_OFFS = (
    *yearly(4, 9, "Car registration and inspection", "Transport", usd(84.50), "checking"),
    *yearly(2, 11, "Dentist: cleaning copay", "Health", usd(35), "checking"),
    *yearly(10, 3, "Work boots", "Shopping", usd(139), "card"),
    # September 2022: the old Civic lets him down.
    OneOff(date(2022, 9, 14), "Alternator and battery", "Transport", usd(612.48)),
    # Summer 2023: his own place.
    OneOff(date(2023, 7, 28), "Security deposit", "Housing", usd(1095), "checking"),
    OneOff(date(2023, 8, 1), "Moving truck", "Housing", usd(118.40)),
    OneOff(date(2023, 8, 2), "Mattress and frame", "Shopping", usd(389)),
    OneOff(date(2023, 8, 3), "Kitchen stuff", "Shopping", usd(142.77)),
    OneOff(date(2023, 8, 5), "Couch, second-hand", "Shopping", usd(150), "checking"),
    OneOff(date(2023, 8, 9), "Internet setup fee", "Utilities", usd(35), "checking"),
    OneOff(date(2023, 8, 22), "Old deposit returned", "Other income", usd(640), "checking", "income"),
    # May 2024: the newer car.
    OneOff(date(2024, 5, 25), "Down payment on the Corolla", "Transport", usd(900), "checking"),
    OneOff(date(2024, 5, 25), "Title and registration", "Transport", usd(187.25), "checking"),
    # Autumn 2024: a friend's wedding, and he is a groomsman.
    OneOff(date(2024, 9, 21), "Bachelor weekend", "Gifts & events", usd(265)),
    OneOff(date(2024, 10, 9), "Suit rental", "Gifts & events", usd(189)),
    OneOff(date(2024, 10, 11), "Hotel for the wedding", "Gifts & events", usd(312.40)),
    OneOff(date(2024, 10, 12), "Wedding gift", "Gifts & events", usd(120), "checking"),
    # July 2025: a long weekend at the beach with friends.
    OneOff(date(2025, 7, 18), "Beach house, his share", "Gifts & events", usd(220)),
    OneOff(date(2025, 7, 19), "Seafood dinner", "Dining", usd(64.80)),
    OneOff(date(2025, 12, 8), "Urgent care visit", "Health", usd(185)),
    # October 2026: the rough month. Brakes and tyres, then a filling.
    OneOff(date(2026, 10, 6), "Brakes, rotors and two tires", "Transport", usd(864.17)),
    OneOff(date(2026, 10, 15), "Dentist: filling", "Health", usd(162)),
)

# ---------- How the ledger files it ----------

INCOME_CATEGORIES = ("Salary", "Other income")
# Expense categories and how fixed each kind of spending is.
CATEGORIES = {
    "Housing": "fixed",
    "Utilities": "fixed",
    "Subscriptions": "fixed",
    "Transport": "essential",
    "Groceries": "essential",
    "Health": "essential",
    "Personal care": "essential",
    "Dining": "discretionary",
    "Nights out": "discretionary",
    "Shopping": "discretionary",
    "Gifts & events": "discretionary",
    "Other expense": "unclassified",
}
# Dollar limits he sets himself for the spending he can steer, for this month and the eleven before it.
ALLOWANCES = {"Groceries": usd(450), "Dining": usd(380), "Nights out": usd(300), "Shopping": usd(220)}
ALLOWANCE_MONTHS = 12
