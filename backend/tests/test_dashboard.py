from datetime import date, datetime, timezone
from types import SimpleNamespace

from sqlalchemy import func, select

from app.dashboard import bill_dates, build, milestone, monthly_minor, next_day_of_month, paycheck_dates
from app.db import SessionLocal
from app.models import JournalEntry, Posting, RecurringBill
from conftest import category, new_account, post, transaction

DAY = date(2026, 3, 10)


def reading(today=DAY):
    """The dashboard as it would read on a fixed day."""
    with SessionLocal() as db:
        return build(db, today)


def bill(client, account, name, amount, due, frequency="monthly"):
    payload = {
        "kind": "expense",
        "account_id": account,
        "category_id": category(client, "expense"),
        "description": name,
        "amount": amount,
        "date": due,
    }
    return post(client, "/recurring-bills", {"transaction": payload, "frequency": frequency, "record_now": False})


def paycheck(client, account, amount, next_date, frequency="monthly", name="Salary"):
    payload = {"account_id": account, "name": name, "amount": amount, "frequency": frequency, "next_date": next_date}
    return post(client, "/income-schedules", payload)


def schedule(frequency, next_date, anchor_day=None):
    first = date.fromisoformat(next_date)
    return SimpleNamespace(frequency=frequency, next_date=next_date, anchor_day=anchor_day or first.day)


def journal_count():
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(JournalEntry))


# ---------- Shape ----------


def test_empty_ledger_returns_the_documented_shape(owner):
    result = owner.get("/api/dashboard")
    assert result.status_code == 200, result.text
    data = result.json()
    assert set(data) == {
        "today",
        "month",
        "first_entry_date",
        "days_of_history",
        "price",
        "checking",
        "cash_ahead",
        "bills",
        "stack",
        "pace",
        "debt",
        "budgets",
        "setup",
    }
    today = date.today()
    assert data["today"] == today.isoformat() and data["month"] == today.strftime("%Y-%m")
    assert data["first_entry_date"] is None and data["days_of_history"] == 0
    assert data["price"] is None
    assert data["checking"] == {"total": "0.00", "accounts": []}
    assert data["cash_ahead"] == {
        "status": "needs_account",
        "horizon_days": 30,
        "start": "0.00",
        "events": [],
        "next_paycheck": None,
        "due_before_paycheck": "0.00",
        "low": {"date": today.isoformat(), "balance": "0.00"},
        "short": None,
        "leans_on_estimate": None,
        "covered_days": None,
        "cards": [],
        "other_bills": 0,
    }
    assert data["bills"] == {
        "items": [],
        "next_7": "0.00",
        "next_30": "0.00",
        "paid_this_month": {"count": 0, "total": "0.00"},
        "destroyed": {"count": 0, "monthly_freed": "0.00"},
    }
    assert data["stack"] == {
        "status": "needs_bitcoin",
        "held": "0",
        "month_start": "0",
        "gained": "0",
        "buys": {"count": 0, "usd": "0.00", "bitcoin": "0"},
        "stack_rate": None,
        "rates": [],
        "history": [],
        "milestone": None,
        "streak_months": 0,
        "best_month": None,
    }
    assert data["pace"]["day"] == today.day
    assert data["pace"]["current"] == {"USD": ["0.00"] * today.day, "BITCOIN": ["0"] * today.day}
    assert data["pace"]["previous"] is None and data["pace"]["missing_conversions"] == 0
    assert data["debt"] == {"cards": [], "loans": []}
    assert data["budgets"]["items"] == []
    assert data["setup"] == {
        "has_account": False,
        "has_paycheck": False,
        "has_bills": False,
        "has_bitcoin": False,
        "has_price_source": False,
        "has_backup": False,
    }


def test_dashboard_and_its_writes_need_a_session(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/income-schedules").status_code == 401
    assert client.post("/api/income-schedules", json={}).status_code == 401
    assert client.put("/api/accounts/1/card-terms", json={}).status_code == 401
    assert client.post("/api/recurring-bills/1/destroy").status_code == 401


def test_writes_are_refused_without_the_csrf_token(owner):
    checking = new_account(owner)
    card = new_account(owner, "Card", amount="100", kind="credit_card")
    rent = bill(owner, checking, "Rent", "400.00", "2026-03-15")
    pay = paycheck(owner, checking, "500", "2026-03-15")
    del owner.headers["X-CSRF-Token"]
    body = {"account_id": checking, "name": "Pay", "amount": "5", "frequency": "weekly", "next_date": "2026-03-01"}
    assert owner.post("/api/income-schedules", json=body).status_code == 403
    assert owner.put(f"/api/income-schedules/{pay['id']}", json=body).status_code == 403
    assert owner.delete(f"/api/income-schedules/{pay['id']}").status_code == 403
    assert owner.put(f"/api/accounts/{card}/card-terms", json={"credit_limit": "500", "due_day": 5}).status_code == 403
    assert owner.put(f"/api/recurring-bills/{rent['id']}/pays-account", json={"account_id": card}).status_code == 403
    assert owner.post(f"/api/recurring-bills/{rent['id']}/destroy").status_code == 403
    assert owner.post(f"/api/recurring-bills/{rent['id']}/restore").status_code == 403
    assert owner.post(f"/api/recurring-bills/{rent['id']}/pay-off", json={"date": "2026-03-01"}).status_code == 403
    assert owner.get("/api/dashboard").status_code == 200
    assert [row["id"] for row in owner.get("/api/income-schedules").json()] == [pay["id"]]
    assert len(owner.get("/api/recurring-bills").json()) == 1


# ---------- Dollars in checking and cash ahead ----------


def test_dollars_in_checking_total_only_everyday_accounts(owner):
    checking = new_account(owner, "Checking", amount="1000")
    cash = new_account(owner, "Wallet cash", amount="50.25", kind="cash")
    new_account(owner, "Savings", amount="500", kind="savings")
    new_account(owner, "Cold storage", "BITCOIN", "900000", "bitcoin_wallet")
    new_account(owner, "Bitcoin checking", "BITCOIN", "7000", "checking")
    new_account(owner, "Card", amount="75", kind="credit_card")
    reserved = new_account(owner, "Tax reserve", amount="300")
    closed = new_account(owner, "Old checking", amount="20")
    assert owner.patch(
        f"/api/accounts/{reserved}", json={"name": "Tax reserve", "exclude_from_liquid_usd": True}
    ).is_success
    assert owner.patch(f"/api/accounts/{closed}", json={"name": "Old checking", "archived": True}).is_success
    data = reading()
    assert data["checking"] == {
        "total": "1050.25",
        "accounts": [
            {"id": checking, "name": "Checking", "balance": "1000.00"},
            {"id": cash, "name": "Wallet cash", "balance": "50.25"},
        ],
    }
    assert data["cash_ahead"]["start"] == "1050.25"
    assert data["setup"]["has_account"] is True
    # Money that arrives after the day being read is not there yet.
    transaction(owner, checking, kind="income", amount="40.00", date="2026-03-11")
    assert reading()["checking"]["total"] == "1050.25"
    assert reading(date(2026, 3, 11))["checking"]["total"] == "1090.25"


def card_terms(client, card, due_day):
    response = client.put(f"/api/accounts/{card}/card-terms", json={"credit_limit": None, "due_day": due_day})
    assert response.status_code == 200, response.text


def test_a_card_is_paid_off_in_full_from_checking_on_its_due_day(owner):
    checking = new_account(owner, amount="2000")
    card = new_account(owner, "Visa", amount="300", kind="credit_card")
    card_terms(owner, card, 25)
    savings = new_account(owner, "Savings", amount="900", kind="savings")
    bill(owner, checking, "Rent", "300.00", "2026-03-12")
    bill(owner, card, "Phone", "150.00", "2026-03-11")
    bill(owner, card, "Internet", "120.00", "2026-03-30")
    bill(owner, savings, "Storage unit", "40.00", "2026-03-13")
    paycheck(owner, checking, "1000", "2026-03-15")
    ahead = reading()["cash_ahead"]
    rows = [(e["kind"], e["name"], e["amount"], e["balance_after"]) for e in ahead["events"]]
    # Bills charged to the card never touch the line themselves; the card's payment does.
    assert rows == [
        ("bill", "Rent", "300.00", "1700.00"),
        ("paycheck", "Salary", "1000.00", "2700.00"),
        ("card", "Visa", "450.00", "2250.00"),
    ]
    payment = ahead["events"][2]
    assert payment["owed_now"] == "300.00" and payment["charged"] == "150.00" and payment["charged_count"] == 1
    assert payment["account_id"] == card and payment["date"] == "2026-03-25"
    assert ahead["cards"] == [
        {
            "account_id": card,
            "name": "Visa",
            "owed": "300.00",
            "due_day": 25,
            "plan": "full",
            "paid_by": None,
            "next_payment": {"date": "2026-03-25", "amount": "450.00"},
            "charges": {"count": 2, "total": "270.00"},
        }
    ]
    assert ahead["due_before_paycheck"] == "300.00"
    # A bill paid from savings is neither: it is counted, not drawn.
    assert ahead["other_bills"] == 1


def test_a_card_payment_due_before_payday_can_make_checking_short(owner):
    checking = new_account(owner, amount="360.39")
    card = new_account(owner, "Visa", amount="0", kind="credit_card")
    card_terms(owner, card, 14)
    bill(owner, card, "Insurance", "250.00", "2026-03-11")
    bill(owner, card, "Phone", "180.00", "2026-03-13")
    paycheck(owner, checking, "2000", "2026-03-20")
    ahead = reading()["cash_ahead"]
    assert ahead["due_before_paycheck"] == "430.00"
    assert ahead["short"] == {"date": "2026-03-14", "amount": "69.61"}
    assert ahead["low"] == {"date": "2026-03-14", "balance": "-69.61"}
    assert ahead["covered_days"] == 3


def test_the_low_point_counts_a_card_paid_off_after_payday(owner):
    checking = new_account(owner, amount="400")
    card = new_account(owner, "Visa", amount="1100", kind="credit_card")
    card_terms(owner, card, 24)
    bill(owner, checking, "Water", "50.00", "2026-03-12")
    paycheck(owner, checking, "1000", "2026-03-15")
    ahead = reading()["cash_ahead"]
    # $350 is left before payday, but only $250 once the card is paid: that is what is free.
    assert [e["balance_after"] for e in ahead["events"]] == ["350.00", "1350.00", "250.00"]
    assert ahead["low"] == {"date": "2026-03-24", "balance": "250.00"} and ahead["short"] is None
    assert ahead["due_before_paycheck"] == "50.00"
    transaction(owner, card, amount="600.00")
    ahead = reading()["cash_ahead"]
    # The paycheck does not cover it either.
    assert ahead["low"] == {"date": "2026-03-24", "balance": "-350.00"}
    assert ahead["short"] == {"date": "2026-03-24", "amount": "350.00"}


def test_a_card_due_twice_in_the_window_is_cleared_each_time(owner):
    new_account(owner, amount="5000")
    card = new_account(owner, "Visa", amount="200", kind="credit_card")
    card_terms(owner, card, 10)
    bill(owner, card, "Phone", "60.00", "2026-04-10")  # charged on the due day itself: waits for the next payment
    bill(owner, card, "Gym", "30.00", "2026-04-20")
    ahead = reading(date(2026, 4, 10))["cash_ahead"]
    rows = [(e["date"], e["amount"], e["owed_now"], e["charged"], e["charged_count"]) for e in ahead["events"]]
    assert rows == [("2026-04-10", "200.00", "200.00", "0.00", 0), ("2026-05-10", "90.00", "0.00", "90.00", 2)]
    assert ahead["cards"][0]["next_payment"] == {"date": "2026-04-10", "amount": "200.00"}


def test_a_bill_that_pays_a_card_is_the_plan_for_that_card(owner):
    checking = new_account(owner, amount="1000")
    card = new_account(owner, "Visa", amount="8000", kind="credit_card")
    card_terms(owner, card, 25)
    payment = bill(owner, checking, "Visa payment", "300.00", "2026-03-20")
    assert owner.put(f"/api/recurring-bills/{payment['id']}/pays-account", json={"account_id": card}).status_code == 200
    bill(owner, card, "Phone", "60.00", "2026-03-15")
    ahead = reading()["cash_ahead"]
    # A balance being paid down on a plan is not forecast as one payment in full.
    assert [(e["kind"], e["date"], e["amount"], e.get("account_id")) for e in ahead["events"]] == [
        ("bill", "2026-03-20", "300.00", card)
    ]
    assert ahead["short"] is None and ahead["other_bills"] == 0
    assert ahead["cards"] == [
        {
            "account_id": card,
            "name": "Visa",
            "owed": "8000.00",
            "due_day": 25,
            "plan": "bill",
            "paid_by": "Visa payment",
            "next_payment": {"date": "2026-03-20", "amount": "300.00"},
            "charges": {"count": 1, "total": "60.00"},
        }
    ]


def test_a_card_with_no_due_day_is_listed_but_not_drawn(owner):
    new_account(owner, amount="1000")
    card = new_account(owner, "Visa", amount="200", kind="credit_card")
    new_account(owner, "Unused card", amount="0", kind="credit_card")
    bill(owner, card, "Phone", "60.00", "2026-03-15")
    ahead = reading()["cash_ahead"]
    assert ahead["events"] == [] and ahead["covered_days"] is None
    # A card that owes nothing and has no bills on it has nothing to pay, so it is left out.
    assert ahead["cards"] == [
        {
            "account_id": card,
            "name": "Visa",
            "owed": "200.00",
            "due_day": None,
            "plan": None,
            "paid_by": None,
            "next_payment": None,
            "charges": {"count": 1, "total": "60.00"},
        }
    ]


def test_cash_ahead_walks_bills_and_paychecks_in_order(owner):
    checking = new_account(owner, amount="1000")
    rent = bill(owner, checking, "Rent", "400.00", "2026-03-05")
    power = bill(owner, checking, "Power", "100.00", "2026-03-15")
    weekly = bill(owner, checking, "Bus pass", "10.00", "2026-03-12", "weekly")
    pay = paycheck(owner, checking, "500", "2026-03-15")
    data = reading()
    ahead = data["cash_ahead"]
    assert ahead["status"] == "ready" and ahead["horizon_days"] == 30 and ahead["start"] == "1000.00"
    assert [(e["kind"], e["date"], e["name"], e["amount"], e["balance_after"]) for e in ahead["events"]] == [
        ("bill", "2026-03-10", "Rent", "400.00", "600.00"),  # overdue, so it lands on today
        ("bill", "2026-03-12", "Bus pass", "10.00", "590.00"),
        ("bill", "2026-03-15", "Power", "100.00", "490.00"),  # same day: the bill comes first
        ("paycheck", "2026-03-15", "Salary", "500.00", "990.00"),
        ("bill", "2026-03-19", "Bus pass", "10.00", "980.00"),
        ("bill", "2026-03-26", "Bus pass", "10.00", "970.00"),
        ("bill", "2026-04-02", "Bus pass", "10.00", "960.00"),
        ("bill", "2026-04-05", "Rent", "400.00", "560.00"),
        ("bill", "2026-04-09", "Bus pass", "10.00", "550.00"),
    ]
    first, paid = ahead["events"][0], ahead["events"][3]
    assert first == {
        "kind": "bill",
        "date": "2026-03-10",
        "name": "Rent",
        "amount": "400.00",
        "balance_after": "600.00",
        "overdue": True,
        "bill_id": rent["id"],
    }
    assert paid == {
        "kind": "paycheck",
        "date": "2026-03-15",
        "name": "Salary",
        "amount": "500.00",
        "balance_after": "990.00",
        "schedule_id": pay["id"],
        "estimate": False,
    }
    assert [e["overdue"] for e in ahead["events"] if e["kind"] == "bill"] == [True] + [False] * 7
    assert ahead["next_paycheck"] == {"date": "2026-03-15", "name": "Salary", "amount": "500.00", "estimate": False}
    assert ahead["due_before_paycheck"] == "510.00"
    assert ahead["low"] == {"date": "2026-03-15", "balance": "490.00"}
    assert ahead["short"] is None
    # Bills alone: Power on 15 April is the first the balance cannot meet, 36 days out.
    assert ahead["covered_days"] == 35
    bills = {row["id"]: row for row in data["bills"]["items"]}
    assert [row["name"] for row in data["bills"]["items"]] == ["Rent", "Bus pass", "Power"]
    assert bills[rent["id"]]["days_until"] == -5 and bills[rent["id"]]["overdue"] is True
    assert bills[power["id"]]["days_until"] == 5 and bills[power["id"]]["overdue"] is False
    assert bills[weekly["id"]]["monthly_amount"] == "43.33"
    assert data["bills"]["next_7"] == "510.00" and data["bills"]["next_30"] == "950.00"
    assert data["setup"]["has_bills"] is True and data["setup"]["has_paycheck"] is True


def test_exactly_zero_is_not_short_and_the_deepest_gap_is_reported(owner):
    checking = new_account(owner, amount="100")
    bill(owner, checking, "Deposit", "100.00", "2026-03-12", "once")
    ahead = reading()["cash_ahead"]
    assert ahead["short"] is None
    assert ahead["low"] == {"date": "2026-03-12", "balance": "0.00"}
    assert ahead["next_paycheck"] is None and ahead["due_before_paycheck"] == "100.00"
    assert ahead["covered_days"] == 60
    bill(owner, checking, "Repair", "30.00", "2026-03-20", "once")
    bill(owner, checking, "Fee", "5.00", "2026-03-28", "once")
    paycheck(owner, checking, "20.00", "2026-03-25")
    ahead = reading()["cash_ahead"]
    assert [e["balance_after"] for e in ahead["events"]] == ["0.00", "-30.00", "-10.00", "-15.00"]
    assert ahead["short"] == {"date": "2026-03-20", "amount": "30.00"}
    assert ahead["low"] == {"date": "2026-03-20", "balance": "-30.00"}
    assert ahead["due_before_paycheck"] == "130.00"
    assert ahead["covered_days"] == 9


def test_cash_ahead_states_and_accounts_outside_everyday_cash(owner):
    savings = new_account(owner, "Savings", amount="900", kind="savings")
    assert reading()["cash_ahead"]["status"] == "needs_account"
    checking = new_account(owner, amount="250")
    ahead = reading()["cash_ahead"]
    assert ahead["status"] == "needs_bills" and ahead["covered_days"] is None
    assert ahead["low"] == {"date": "2026-03-10", "balance": "250.00"} and ahead["events"] == []
    # A bill paid from savings and a paycheck landing there never move everyday cash.
    bill(owner, savings, "Insurance", "60.00", "2026-03-14")
    paycheck(owner, savings, "75.00", "2026-03-20", name="Side income")
    data = reading()
    ahead = data["cash_ahead"]
    assert ahead["status"] == "ready" and ahead["events"] == [] and ahead["next_paycheck"] is None
    assert ahead["due_before_paycheck"] == "0.00" and ahead["covered_days"] is None
    assert data["bills"]["next_7"] == "60.00" and data["bills"]["next_30"] == "60.00"
    assert [row["account"] for row in data["bills"]["items"]] == ["Savings"]
    paycheck(owner, checking, "40.00", "2026-04-20")
    ahead = reading()["cash_ahead"]
    # The next paycheck is reported even when it falls beyond the thirty days shown.
    assert ahead["next_paycheck"] == {"date": "2026-04-20", "name": "Salary", "amount": "40.00", "estimate": False}
    assert ahead["events"] == []


def test_paycheck_dates_follow_each_frequency():
    def dates(item, after, end):
        return [str(day) for day in paycheck_dates(item, date.fromisoformat(after), date.fromisoformat(end))]

    assert dates(schedule("weekly", "2026-03-06"), "2026-03-10", "2026-03-27") == [
        "2026-03-13",
        "2026-03-20",
        "2026-03-27",
    ]
    assert dates(schedule("biweekly", "2026-01-02"), "2026-02-10", "2026-03-13") == [
        "2026-02-13",
        "2026-02-27",
        "2026-03-13",
    ]
    # A schedule that has not started yet begins on its first date.
    assert dates(schedule("biweekly", "2026-03-20"), "2026-03-10", "2026-04-05") == ["2026-03-20", "2026-04-03"]
    assert dates(schedule("monthly", "2026-01-31"), "2026-01-31", "2026-04-30") == [
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
    ]
    # Semimonthly pairs: the anchor and fifteen days later, or fifteen days earlier and the anchor.
    assert dates(schedule("semimonthly", "2026-01-01"), "2026-01-01", "2026-03-01") == [
        "2026-01-16",
        "2026-02-01",
        "2026-02-16",
        "2026-03-01",
    ]
    assert dates(schedule("semimonthly", "2026-01-15"), "2026-01-14", "2026-02-28") == [
        "2026-01-15",
        "2026-01-30",
        "2026-02-15",
        "2026-02-28",
    ]
    assert dates(schedule("semimonthly", "2026-01-31"), "2026-02-10", "2026-03-31") == [
        "2026-02-16",
        "2026-02-28",
        "2026-03-16",
        "2026-03-31",
    ]
    assert dates(schedule("semimonthly", "2026-01-20"), "2026-01-01", "2026-02-20") == [
        "2026-01-20",
        "2026-02-05",
        "2026-02-20",
    ]


def test_semimonthly_and_biweekly_paychecks_are_projected(owner):
    checking = new_account(owner, amount="10")
    paycheck(owner, checking, "1000", "2026-01-31", "semimonthly", "Twice a month")
    paycheck(owner, checking, "700", "2026-01-02", "biweekly", "Every other Friday")
    # A paycheck dated today is assumed to have landed; the next one is a month away.
    paycheck(owner, checking, "55", "2026-02-10", "monthly", "Pension")
    ahead = reading(date(2026, 2, 10))["cash_ahead"]
    assert [(e["date"], e["name"], e["balance_after"]) for e in ahead["events"]] == [
        ("2026-02-13", "Every other Friday", "710.00"),
        ("2026-02-16", "Twice a month", "1710.00"),
        ("2026-02-27", "Every other Friday", "2410.00"),
        ("2026-02-28", "Twice a month", "3410.00"),
        ("2026-03-10", "Pension", "3465.00"),
    ]
    assert ahead["next_paycheck"] == {
        "date": "2026-02-13",
        "name": "Every other Friday",
        "amount": "700.00",
        "estimate": False,
    }
    assert ahead["status"] == "needs_bills" and ahead["low"] == {"date": "2026-02-10", "balance": "10.00"}


def test_bill_dates_repeat_without_touching_the_schedule():
    weekly = SimpleNamespace(frequency="weekly", next_due="2026-02-24", anchor_day=24, anchor_month=2)
    # Only the saved due date is carried as overdue; the weeks between are not stacked up.
    assert [str(day) for day in bill_dates(weekly, DAY, date(2026, 3, 24))] == [
        "2026-02-24",
        "2026-03-10",
        "2026-03-17",
        "2026-03-24",
    ]
    assert weekly.next_due == "2026-02-24"
    month_end = SimpleNamespace(frequency="monthly", next_due="2026-01-31", anchor_day=31, anchor_month=1)
    assert [str(day) for day in bill_dates(month_end, date(2026, 1, 31), date(2026, 4, 30))] == [
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
    ]
    once = SimpleNamespace(frequency="once", next_due="2026-03-12", anchor_day=12, anchor_month=3)
    assert [str(day) for day in bill_dates(once, DAY, date(2026, 12, 31))] == ["2026-03-12"]


# ---------- Bills ----------


def test_monthly_amounts_round_half_even():
    assert monthly_minor(1000, "weekly") == 4333
    assert monthly_minor(1000, "monthly") == 1000
    assert monthly_minor(10000, "quarterly") == 3333
    assert monthly_minor(10000, "semiannual") == 1667
    assert monthly_minor(10000, "yearly") == 833
    assert monthly_minor(10000, "once") == 0
    assert monthly_minor(6, "yearly") == 0  # 0.5 of a cent rounds to the even cent below
    assert monthly_minor(18, "yearly") == 2  # 1.5 rounds to the even cent above
    assert monthly_minor(30, "yearly") == 2  # 2.5 rounds down to the even cent


def test_bill_rows_and_payments_recorded_this_month(owner):
    checking = new_account(owner, amount="2000")
    loan = new_account(owner, "Car loan", amount="1200", kind="loan")
    car = bill(owner, checking, "Car payment", "300.00", "2026-03-20")
    yearly = bill(owner, checking, "Domain", "100.00", "2026-09-01", "yearly")
    internet = bill(owner, checking, "Internet", "60.00", "2026-03-08")
    old = bill(owner, checking, "Water", "45.00", "2026-02-08")
    linked = owner.put(f"/api/recurring-bills/{car['id']}/pays-account", json={"account_id": loan})
    assert linked.status_code == 200 and linked.json()["pays_account_id"] == loan
    rows = {row["name"]: row for row in reading()["bills"]["items"]}
    assert rows["Car payment"] == {
        "id": car["id"],
        "name": "Car payment",
        "amount": "300.00",
        "currency": "USD",
        "due_date": "2026-03-20",
        "days_until": 10,
        "overdue": False,
        "frequency": "monthly",
        "monthly_amount": "300.00",
        "account_id": checking,
        "account": "Checking",
        "category": rows["Car payment"]["category"],
        "pays_account_id": loan,
        "payoff": "1200.00",
    }
    assert rows["Car payment"]["category"]
    assert rows["Domain"]["monthly_amount"] == "8.33" and rows["Domain"]["id"] == yearly["id"]
    assert rows["Internet"]["pays_account_id"] is None and rows["Internet"]["payoff"] is None
    assert reading()["bills"]["paid_this_month"] == {"count": 0, "total": "0.00"}
    paid = post(
        owner,
        f"/recurring-bills/{internet['id']}/record",
        {"due_date": "2026-03-08", "date": "2026-03-08", "amount": "61.50"},
    )
    post(
        owner,
        f"/recurring-bills/{old['id']}/record",
        {"due_date": "2026-02-08", "date": "2026-02-09", "amount": "45.00"},
    )
    assert reading()["bills"]["paid_this_month"] == {"count": 1, "total": "61.50"}
    assert reading(date(2026, 2, 20))["bills"]["paid_this_month"] == {"count": 1, "total": "45.00"}
    # A corrected payment is still that bill's payment; a deleted one is not.
    entry = next(t for t in owner.get("/api/transactions").json() if t["id"] == paid["entry_id"])
    fixed = owner.put(
        f"/api/transactions/{entry['id']}",
        json={
            "date": "2026-03-09",
            "kind": "expense",
            "account_id": checking,
            "amount": "70.00",
            "category_id": entry["category_id"],
            "description": "Internet",
        },
    )
    assert fixed.status_code == 200, fixed.text
    assert reading()["bills"]["paid_this_month"] == {"count": 1, "total": "70.00"}
    assert owner.delete(f"/api/transactions/{fixed.json()['id']}").status_code == 200
    assert reading()["bills"]["paid_this_month"] == {"count": 0, "total": "0.00"}
    unlinked = owner.put(f"/api/recurring-bills/{car['id']}/pays-account", json={"account_id": None})
    assert unlinked.status_code == 200 and unlinked.json()["pays_account_id"] is None


def test_destroy_stamps_the_bill_frees_its_monthly_cost_and_posts_nothing(owner):
    checking = new_account(owner, amount="500")
    weekly = bill(owner, checking, "Gym", "10.00", "2026-03-12", "weekly")
    quarterly = bill(owner, checking, "Storage", "100.00", "2026-04-01", "quarterly")
    archived = bill(owner, checking, "Magazine", "9.00", "2026-03-30")
    before = journal_count()
    result = owner.post(f"/api/recurring-bills/{weekly['id']}/destroy")
    assert result.status_code == 200 and result.json() == {"monthly_freed": "43.33"}
    assert owner.post(f"/api/recurring-bills/{quarterly['id']}/destroy").json() == {"monthly_freed": "33.33"}
    # Archiving the ordinary way is not a destroyed bill.
    assert owner.delete(f"/api/recurring-bills/{archived['id']}").status_code == 200
    assert journal_count() == before
    assert owner.get("/api/transactions").json() == []
    assert owner.get("/api/accounts").json()[0]["balance"] == "500.00"
    assert owner.get("/api/recurring-bills").json() == []
    with SessionLocal() as db:
        saved = db.get(RecurringBill, weekly["id"])
        assert saved.archived is True and saved.destroyed_on == date.today().isoformat()
        assert db.get(RecurringBill, archived["id"]).destroyed_on is None
    data = reading()
    assert data["bills"]["destroyed"] == {"count": 2, "monthly_freed": "76.66"}
    assert data["bills"]["items"] == [] and data["cash_ahead"]["events"] == []
    assert owner.post(f"/api/recurring-bills/{weekly['id']}/destroy").status_code == 404
    assert owner.post("/api/recurring-bills/9999/destroy").status_code == 404
    actions = [event["action"] for event in owner.get("/api/audit").json()]
    assert actions.count("recurring_bill.destroy") == 2


def test_pay_off_posts_one_balanced_transfer_zeroes_the_debt_and_destroys_the_bill(owner):
    checking = new_account(owner, amount="5000")
    loan = new_account(owner, "Car loan", amount="1200.55", kind="loan")
    car = bill(owner, checking, "Car payment", "300.00", "2026-03-20")
    unlinked = owner.post(f"/api/recurring-bills/{car['id']}/pay-off", json={"date": "2026-03-01"})
    assert unlinked.status_code == 422
    assert owner.put(f"/api/recurring-bills/{car['id']}/pays-account", json={"account_id": loan}).status_code == 200
    assert owner.post(f"/api/recurring-bills/{car['id']}/pay-off", json={"date": "2999-01-01"}).status_code == 422
    assert owner.post(f"/api/recurring-bills/{car['id']}/pay-off", json={}).status_code == 422
    before = journal_count()
    result = owner.post(f"/api/recurring-bills/{car['id']}/pay-off", json={"date": "2026-03-01"})
    assert result.status_code == 200, result.text
    paid = result.json()
    assert paid["amount"] == "1200.55" and paid["monthly_freed"] == "300.00"
    assert journal_count() == before + 1
    (transfer,) = owner.get("/api/transactions").json()
    assert transfer["id"] == paid["entry_id"] and transfer["kind"] == "transfer" and transfer["date"] == "2026-03-01"
    assert (transfer["account_id"], transfer["destination_id"]) == (checking, loan)
    assert transfer["amount"] == "1200.55" and transfer["destination_amount"] == "1200.55"
    with SessionLocal() as db:
        legs = db.execute(select(Posting.account_id, Posting.amount_minor).where(Posting.entry_id == paid["entry_id"]))
        assert sorted(legs.all()) == sorted([(checking, -120055), (loan, 120055)])
        saved = db.get(RecurringBill, car["id"])
        assert saved.archived is True and saved.destroyed_on == date.today().isoformat()
    balances = {row["id"]: row["balance"] for row in owner.get("/api/accounts").json()}
    assert balances[loan] == "0.00" and balances[checking] == "3799.45"
    data = reading()
    assert data["bills"]["destroyed"] == {"count": 1, "monthly_freed": "300.00"}
    assert data["debt"]["loans"][0]["balance"] == "0.00"
    assert owner.get("/api/recurring-bills").json() == []
    assert owner.post(f"/api/recurring-bills/{car['id']}/pay-off", json={"date": "2026-03-01"}).status_code == 404
    # Nothing is left to pay on a cleared debt.
    again = bill(owner, checking, "Car payment again", "300.00", "2026-03-20")
    owner.put(f"/api/recurring-bills/{again['id']}/pays-account", json={"account_id": loan})
    assert owner.post(f"/api/recurring-bills/{again['id']}/pay-off", json={"date": "2026-03-01"}).status_code == 409
    assert journal_count() == before + 1


def test_pay_off_is_refused_when_the_paying_account_is_short(owner):
    checking = new_account(owner, amount="1200.54")
    loan = new_account(owner, "Car loan", amount="1200.55", kind="loan")
    car = bill(owner, checking, "Car payment", "300.00", "2026-03-20")
    owner.put(f"/api/recurring-bills/{car['id']}/pays-account", json={"account_id": loan})
    before = journal_count()
    refused = owner.post(f"/api/recurring-bills/{car['id']}/pay-off", json={"date": "2026-03-01"})
    assert refused.status_code == 409 and "Checking" in refused.json()["detail"]
    assert journal_count() == before and owner.get("/api/transactions").json() == []
    (kept,) = owner.get("/api/recurring-bills").json()
    assert kept["id"] == car["id"]
    with SessionLocal() as db:
        assert db.get(RecurringBill, car["id"]).destroyed_on is None
    # One more cent in the account is exactly enough.
    transaction(owner, checking, kind="income", amount="0.01")
    assert owner.post(f"/api/recurring-bills/{car['id']}/pay-off", json={"date": "2026-03-01"}).status_code == 200
    balances = {row["id"]: row["balance"] for row in owner.get("/api/accounts").json()}
    assert balances[loan] == "0.00" and balances[checking] == "0.00"


def test_destroyed_bills_are_listed_and_can_be_brought_back(owner):
    checking = new_account(owner, "Checking", amount="1000")
    gym = bill(owner, checking, "Gym", "30.00", "2026-01-05")
    yearly = bill(owner, checking, "Domain", "24.00", "2026-01-20", "yearly")
    bill(owner, checking, "Rent", "400.00", "2026-03-15")
    assert owner.get("/api/recurring-bills/destroyed").json() == []
    assert owner.post(f"/api/recurring-bills/{gym['id']}/restore").status_code == 409
    for item in (gym, yearly):
        assert owner.post(f"/api/recurring-bills/{item['id']}/destroy").is_success
    before = journal_count()
    listed = owner.get("/api/recurring-bills/destroyed").json()
    assert [row["name"] for row in listed] == ["Domain", "Gym"]
    assert listed[0] | {"destroyed_on": None} == {
        "id": yearly["id"],
        "name": "Domain",
        "amount": "24.00",
        "currency": "USD",
        "frequency": "yearly",
        "monthly_amount": "2.00",
        "destroyed_on": None,
        "account": "Checking",
        "category": listed[0]["category"],
        "paid_off": False,
    }
    assert listed[0]["destroyed_on"] == date.today().isoformat()

    restored = owner.post(f"/api/recurring-bills/{gym['id']}/restore")
    assert restored.status_code == 200, restored.text
    # The due date rolls forward on its own day of the month, never into the past.
    assert restored.json()["next_due"] >= date.today().isoformat()
    assert restored.json()["next_due"][-2:] == "05"
    assert [row["name"] for row in owner.get("/api/recurring-bills/destroyed").json()] == ["Domain"]
    assert sorted(row["description"] for row in owner.get("/api/recurring-bills").json()) == ["Gym", "Rent"]
    assert owner.post(f"/api/recurring-bills/{gym['id']}/restore").status_code == 409
    assert journal_count() == before


def test_pays_account_must_be_a_debt_in_the_same_currency(owner):
    checking = new_account(owner)
    savings = new_account(owner, "Savings", kind="savings")
    bitcoin_loan = new_account(owner, "Bitcoin loan", "BITCOIN", "50000", "loan")
    card = new_account(owner, "Card", amount="80", kind="credit_card")
    rent = bill(owner, checking, "Rent", "400.00", "2026-03-15")

    def link(bill_id, account_id):
        return owner.put(f"/api/recurring-bills/{bill_id}/pays-account", json={"account_id": account_id})

    assert link(rent["id"], savings).status_code == 422
    assert link(rent["id"], bitcoin_loan).status_code == 422
    assert link(rent["id"], 9999).status_code == 422
    assert link(9999, card).status_code == 404
    assert owner.put(f"/api/recurring-bills/{rent['id']}/pays-account", json={}).status_code == 422
    assert link(rent["id"], card).status_code == 200
    assert reading()["bills"]["items"][0]["payoff"] == "80.00"


# ---------- Paycheck schedules and card terms ----------


def test_income_schedule_crud_and_validation(owner):
    checking = new_account(owner)
    card = new_account(owner, "Card", kind="credit_card")
    closed = new_account(owner, "Closed", kind="cash")
    assert owner.patch(f"/api/accounts/{closed}", json={"name": "Closed", "archived": True}).is_success
    good = {"account_id": checking, "name": " Salary ", "amount": "3100", "frequency": "semimonthly"}
    good["next_date"] = "2026-03-01"
    for change in (
        {"frequency": "quarterly"},
        {"amount": "0"},
        {"amount": "-5"},
        {"amount": "10.001"},
        {"amount": "lots"},
        {"name": "   "},
        {"name": "x" * 121},
        {"account_id": 9999},
        {"account_id": card},
        {"account_id": closed},
        {"next_date": "not-a-date"},
        {"surprise": True},
    ):
        assert owner.post("/api/income-schedules", json=good | change).status_code == 422, change
    assert owner.get("/api/income-schedules").json() == []
    created = post(owner, "/income-schedules", good)
    assert created["name"] == "Salary" and created["amount"] == "3100.00" and created["currency"] == "USD"
    assert created["account"] == "Checking" and created["next_date"] == "2026-03-01"
    assert created["frequency"] == "semimonthly" and date.fromisoformat(created["next_occurrence"]) > date.today()
    updated = owner.put(
        f"/api/income-schedules/{created['id']}",
        json=good | {"name": "Wages", "amount": "1500.50", "frequency": "biweekly", "next_date": "2026-03-06"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Wages" and updated.json()["amount"] == "1500.50"
    assert owner.put(f"/api/income-schedules/{created['id']}", json=good | {"amount": "0"}).status_code == 422
    assert owner.put("/api/income-schedules/9999", json=good).status_code == 404
    assert [row["name"] for row in owner.get("/api/income-schedules").json()] == ["Wages"]
    assert reading()["cash_ahead"]["next_paycheck"] == {
        "date": "2026-03-20",
        "name": "Wages",
        "amount": "1500.50",
        "estimate": False,
    }
    assert owner.delete(f"/api/income-schedules/{created['id']}").status_code == 200
    assert owner.get("/api/income-schedules").json() == []
    assert reading()["setup"]["has_paycheck"] is False and reading()["cash_ahead"]["next_paycheck"] is None
    assert owner.delete(f"/api/income-schedules/{created['id']}").status_code == 404
    assert owner.put(f"/api/income-schedules/{created['id']}", json=good).status_code == 404
    actions = [event["action"] for event in owner.get("/api/audit").json()]
    assert {"income_schedule.create", "income_schedule.update", "income_schedule.archive"} <= set(actions)
    assert owner.get("/api/transactions").json() == []


def test_card_terms_validation_and_utilisation(owner):
    checking = new_account(owner)
    card = new_account(owner, "Ridge card", amount="1284.36", kind="credit_card")
    spare = new_account(owner, "Spare card", amount="0", kind="credit_card")

    def save(account, **body):
        return owner.put(f"/api/accounts/{account}/card-terms", json=body)

    cards = {row["name"]: row for row in reading()["debt"]["cards"]}
    assert cards["Ridge card"] == {
        "account_id": card,
        "name": "Ridge card",
        "balance": "1284.36",
        "limit": None,
        "utilization": None,
        "due_day": None,
        "next_due": None,
    }
    assert save(checking, credit_limit="500", due_day=5).status_code == 422
    assert save(9999, credit_limit="500", due_day=5).status_code == 404
    for body in (
        {"credit_limit": "0"},
        {"credit_limit": "-1"},
        {"credit_limit": "10.001"},
        {"credit_limit": "plenty"},
        {"due_day": 0},
        {"due_day": 32},
        {"limit": "500"},
    ):
        assert save(card, **body).status_code == 422, body
    saved = save(card, credit_limit="6000", due_day=28)
    assert saved.status_code == 200 and saved.json() == {"account_id": card, "credit_limit": "6000.00", "due_day": 28}
    assert save(spare, credit_limit="1000", due_day=31).status_code == 200
    cards = {row["name"]: row for row in reading()["debt"]["cards"]}
    assert cards["Ridge card"]["limit"] == "6000.00" and cards["Ridge card"]["utilization"] == "21.4"
    assert cards["Ridge card"]["due_day"] == 28 and cards["Ridge card"]["next_due"] == "2026-03-28"
    assert cards["Spare card"]["utilization"] == "0.0" and cards["Spare card"]["next_due"] == "2026-03-31"
    assert reading(date(2026, 3, 29))["debt"]["cards"][0]["next_due"] == "2026-04-28"
    assert reading(date(2026, 2, 10))["debt"]["cards"][1]["next_due"] == "2026-02-28"
    # Terms can be cleared one at a time, or entirely.
    assert save(card, credit_limit=None, due_day=28).json()["credit_limit"] is None
    row = reading()["debt"]["cards"][0]
    assert row["limit"] is None and row["utilization"] is None and row["next_due"] == "2026-03-28"
    assert save(card, credit_limit=None, due_day=None).status_code == 200
    row = reading()["debt"]["cards"][0]
    assert row["due_day"] is None and row["next_due"] is None


def test_next_day_of_month_clamps_and_rolls_over():
    assert next_day_of_month(date(2026, 3, 28), 28) == date(2026, 3, 28)
    assert next_day_of_month(date(2026, 12, 29), 28) == date(2027, 1, 28)
    assert next_day_of_month(date(2026, 1, 31), 30) == date(2026, 2, 28)
    assert next_day_of_month(date(2028, 2, 1), 31) == date(2028, 2, 29)


# ---------- Stack ----------


def buy(client, source, wallet, usd, bitcoin, day):
    return transaction(
        client, source, "transfer", usd, destination_id=wallet, destination_amount=bitcoin, date=day, description="Buy"
    )


def test_stack_counts_buys_holdings_rate_streak_and_best_month(owner):
    checking = new_account(owner, amount="10000")
    wallet = new_account(owner, "Cold storage", "BITCOIN", "1000000", "bitcoin_wallet")
    savings = new_account(owner, "Savings", kind="savings")
    buy(owner, checking, wallet, "300", "310000", "2026-02-10")
    transaction(owner, checking, kind="income", amount="800.00", date="2026-03-02")
    buy(owner, checking, wallet, "100", "100000", "2026-03-03")
    buy(owner, checking, wallet, "150", "140000", "2026-03-05")
    # Not buys: moving dollars to savings, and a buy that was later deleted.
    transaction(owner, checking, "transfer", "50", destination_id=savings, date="2026-03-06")
    undone = buy(owner, checking, wallet, "75", "70000", "2026-03-07")
    assert owner.delete(f"/api/transactions/{undone['id']}").status_code == 200
    data = reading()
    assert data["first_entry_date"] == "2026-01-01" and data["days_of_history"] == 69
    stack = data["stack"]
    assert stack == {
        "status": "ready",
        "held": "1550000",
        "month_start": "1310000",
        "gained": "240000",
        "buys": {"count": 2, "usd": "250.00", "bitcoin": "240000"},
        "stack_rate": "31.2",  # 250 of 800 is 31.25: half-even
        "rates": [
            {"month": "2026-01", "rate": None},
            {"month": "2026-02", "rate": None},
            {"month": "2026-03", "rate": "31.2"},
        ],
        "history": [
            {"month": "2026-01", "held": "1000000"},
            {"month": "2026-02", "held": "1310000"},
            {"month": "2026-03", "held": "1550000"},
        ],
        "milestone": {"previous": "1500000", "next": "1600000"},
        "streak_months": 2,
        "best_month": {"month": "2026-02", "bitcoin": "310000"},
    }
    assert data["setup"]["has_bitcoin"] is True
    # Selling some back lowers the stack without undoing the buys.
    transaction(
        owner, wallet, "transfer", "50000", destination_id=checking, destination_amount="40.00", date="2026-03-08"
    )
    stack = reading()["stack"]
    assert stack["held"] == "1500000" and stack["gained"] == "190000"
    assert stack["buys"] == {"count": 2, "usd": "250.00", "bitcoin": "240000"}
    assert stack["milestone"] == {"previous": "1500000", "next": "1600000"}
    april = reading(date(2026, 4, 5))["stack"]
    assert april["streak_months"] == 2 and april["buys"]["count"] == 0 and april["stack_rate"] is None
    assert [row["month"] for row in april["rates"]] == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert april["rates"][-2]["rate"] == "31.2" and april["month_start"] == "1500000" and april["gained"] == "0"
    assert reading(date(2026, 5, 5))["stack"]["streak_months"] == 0
    later = reading(date(2026, 9, 5))["stack"]
    assert [row["month"] for row in later["history"]] == [
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
    ]
    # Bitcoin income with no saved conversion leaves the month's dollar income unknown.
    transaction(owner, wallet, kind="income", amount="5000", date="2026-03-04")
    stack = reading()["stack"]
    assert stack["stack_rate"] is None and stack["rates"][-1] == {"month": "2026-03", "rate": None}
    assert stack["held"] == "1505000"


def test_milestones_step_on_the_second_digit():
    assert milestone(21932000) == {"previous": "21000000", "next": "22000000"}
    assert milestone(22000000) == {"previous": "22000000", "next": "23000000"}
    assert milestone(99999999) == {"previous": "99000000", "next": "100000000"}
    assert milestone(100000000) == {"previous": "100000000", "next": "110000000"}
    assert milestone(0) == {"previous": "0", "next": "1000"}
    assert milestone(4321) == {"previous": "4000", "next": "5000"}


def test_price_reading_and_setup_flags(owner):
    new_account(owner)
    assert reading()["price"] is None
    assert reading()["setup"]["has_price_source"] is False and reading()["setup"]["has_backup"] is False
    post(owner, "/rates", {"day": "2026-03-10", "usd_per_btc": "118750"})
    assert reading()["price"] == {
        "usd_per_btc": "118750.00",
        "bitcoin_per_usd": "842",
        "source": "Manual",
        "day": "2026-03-10",
        "observed_at": None,
        "stale": False,
    }
    stale = reading(date(2026, 3, 12))["price"]
    assert stale["stale"] is True and stale["day"] == "2026-03-10"
    assert reading(date(2026, 3, 9))["price"] is None
    # 100,000,000 / 40,000,000 is exactly 2.5: half-even keeps the even unit.
    post(owner, "/rates", {"day": "2026-03-11", "usd_per_btc": "40000000"})
    post(owner, "/rates", {"day": "2026-03-12", "usd_per_btc": "123456.789"})
    assert reading(date(2026, 3, 11))["price"]["bitcoin_per_usd"] == "2"
    assert reading(date(2026, 3, 12))["price"]["usd_per_btc"] == "123456.789"
    assert reading()["setup"]["has_price_source"] is True
    assert owner.post("/api/backup", json={"passphrase": "a-long-backup-passphrase"}).status_code == 200
    assert reading()["setup"]["has_backup"] is True


def test_a_chosen_price_provider_counts_as_a_price_source(owner):
    settings = owner.get("/api/settings").json()["preferences"]
    assert owner.put("/api/settings", json=settings | {"rate_source": "coinbase"}).status_code == 200
    data = owner.get("/api/dashboard").json()
    assert data["setup"]["has_price_source"] is True and data["price"] is None


# ---------- Pace, debt and budgets ----------


def test_pace_is_cumulative_and_unknown_from_the_first_missing_conversion(owner):
    checking = new_account(owner, amount="1000")
    wallet = new_account(owner, "Spending wallet", "BITCOIN", "500000", "bitcoin_wallet")
    post(owner, "/rates", {"day": "2026-02-10", "usd_per_btc": "60000"})
    post(owner, "/rates", {"day": "2026-03-02", "usd_per_btc": "100000"})
    transaction(owner, checking, amount="30.00", date="2026-02-10")
    transaction(owner, checking, amount="50.00", date="2026-03-02")
    transaction(owner, checking, kind="income", amount="999.00", date="2026-03-02")
    data = reading(date(2026, 3, 4))["pace"]
    assert data["day"] == 4 and data["days_in_month"] == 31 and data["missing_conversions"] == 0
    assert data["current"] == {
        "USD": ["0.00", "50.00", "50.00", "50.00"],
        "BITCOIN": ["0", "50000", "50000", "50000"],
    }
    assert data["previous"]["USD"] == ["0.00"] * 9 + ["30.00"] * 19
    assert data["previous"]["BITCOIN"] == ["0"] * 9 + ["50000"] * 19
    # No price was saved for these days, so neither purchase has a conversion.
    transaction(owner, checking, amount="20.00", date="2026-03-05")
    transaction(owner, wallet, amount="1000", date="2026-03-07")
    data = reading()["pace"]
    assert data["day"] == 10 and data["missing_conversions"] == 2
    assert data["current"]["USD"] == ["0.00"] + ["50.00"] * 3 + ["70.00"] * 2 + [None] * 4
    assert data["current"]["BITCOIN"] == ["0"] + ["50000"] * 3 + [None] * 6
    april = reading(date(2026, 4, 2))["pace"]
    assert april["current"] == {"USD": ["0.00", "0.00"], "BITCOIN": ["0", "0"]} and april["missing_conversions"] == 0
    assert april["previous"]["USD"][:7] == ["0.00", "50.00", "50.00", "50.00", "70.00", "70.00", None]
    assert len(april["previous"]["USD"]) == 31 and april["previous"]["BITCOIN"][4:] == [None] * 27
    assert reading(date(2026, 5, 10))["pace"]["previous"] is None


def test_loans_report_the_change_since_the_window_opened(owner):
    checking = new_account(owner, amount="5000")
    mortgage = new_account(owner, "Home mortgage", amount="200000", kind="mortgage")
    other = new_account(owner, "Family loan", amount="0", kind="other_liability")
    closed = new_account(owner, "Old loan", amount="10", kind="loan")
    assert owner.patch(f"/api/accounts/{closed}", json={"name": "Old loan", "archived": True}).is_success
    transaction(owner, checking, "transfer", "500", destination_id=mortgage, date="2026-02-15")
    data = reading()["debt"]
    assert data["cards"] == []
    assert data["loans"] == [
        {
            "account_id": mortgage,
            "name": "Home mortgage",
            "balance": "199500.00",
            "change": {"since": "2026-01-01", "amount": "-500.00"},
        },
        {
            "account_id": other,
            "name": "Family loan",
            "balance": "0.00",
            "change": {"since": "2026-01-01", "amount": "0.00"},
        },
    ]
    # Six months on, the comparison starts at the end of the window's first month.
    transaction(owner, checking, "transfer", "250", destination_id=mortgage, date="2026-06-15")
    later = reading(date(2026, 9, 10))["debt"]["loans"][0]
    assert later["balance"] == "199250.00" and later["change"] == {"since": "2026-04-30", "amount": "-250.00"}


def test_budgets_list_only_dollar_allowances(owner):
    checking = new_account(owner, amount="1000")
    expenses = [c for c in owner.get("/api/categories").json() if c["kind"] == "expense"]
    groceries, dining, shopping = (
        next(c["id"] for c in expenses if c["name"] == n) for n in ("Groceries", "Dining", "Shopping")
    )
    post(owner, "/budgets", {"month": "2026-03", "category_id": groceries, "amount": "900"})
    post(owner, "/budgets", {"month": "2026-03", "category_id": shopping, "amount": "50"})
    post(owner, "/budgets", {"month": "2026-03", "category_id": dining, "amount": "40000", "currency": "BITCOIN"})
    post(owner, "/budgets", {"month": "2026-02", "category_id": dining, "amount": "75"})
    transaction(owner, checking, amount="648.20", date="2026-03-03", category_id=groceries)
    transaction(owner, checking, amount="12.00", date="2026-03-04", category_id=dining)
    data = reading()["budgets"]
    assert data["month_elapsed_percent"] == "32.3"
    assert data["items"] == [
        {
            "category_id": groceries,
            "category": "Groceries",
            "planned_usd": "900.00",
            "spent_usd": "648.20",
            "percent": "72.0",
        },
        {
            "category_id": shopping,
            "category": "Shopping",
            "planned_usd": "50.00",
            "spent_usd": "0.00",
            "percent": "0.0",
        },
    ]
    assert reading(date(2026, 2, 14))["budgets"]["month_elapsed_percent"] == "50.0"


# ---------- Demo ----------


def test_demo_dashboard_has_a_card_a_paycheck_and_bills(owner):
    assert owner.post("/api/demo").status_code == 200
    result = owner.get("/api/dashboard")
    assert result.status_code == 200, result.text
    data = result.json()
    today = date.today()
    (card,) = data["debt"]["cards"]
    assert card["name"] == "Ridgeline Visa" and card["balance"] == "1284.36"
    assert card["limit"] == "6000.00" and card["utilization"] == "21.4" and card["due_day"] == 28
    assert [loan["name"] for loan in data["debt"]["loans"]] == ["Home mortgage"]
    ahead = data["cash_ahead"]
    assert ahead["status"] == "ready" and ahead["short"] is None
    pay = ahead["next_paycheck"]
    assert pay["name"] == "Salary" and pay["amount"] == "3100.00"
    assert date.fromisoformat(pay["date"]) > today and date.fromisoformat(pay["date"]).day in (1, 16)
    assert sum(event["kind"] == "paycheck" for event in ahead["events"]) >= 2
    # Five bills come out of checking. One of them pays the card down, so the card is left to that bill.
    assert sum(event["kind"] == "bill" for event in ahead["events"]) == 5
    assert all(event["kind"] != "card" for event in ahead["events"])
    assert [(row["name"], row["plan"], row["paid_by"]) for row in ahead["cards"]] == [
        ("Ridgeline Visa", "bill", "Ridgeline Visa payment")
    ]
    bills = {row["name"]: row for row in data["bills"]["items"]}
    assert set(bills) == {
        "Electric & water",
        "Mortgage interest & insurance",
        "Health & wellness",
        "Internet",
        "Car insurance",
        "Phone",
        "Streaming",
        "Ridgeline Visa payment",
    }
    assert all(not row["overdue"] and row["days_until"] > 0 for row in bills.values())
    assert bills["Ridgeline Visa payment"]["pays_account_id"] == card["account_id"]
    assert bills["Ridgeline Visa payment"]["payoff"] == "1284.36"
    assert bills["Streaming"]["monthly_amount"] == "22.99"
    assert data["checking"]["accounts"][0]["name"] == "Everyday checking"
    stack = data["stack"]
    assert stack["status"] == "ready" and len(stack["rates"]) == 6 and len(stack["history"]) == 6
    assert stack["streak_months"] >= 5 and stack["best_month"]["bitcoin"] == "754300"
    assert stack["buys"]["count"] == (today.day >= 10) + (today.day >= 17)
    assert data["price"]["source"] == "Fictional demo rate" and data["pace"]["missing_conversions"] == 0
    assert data["budgets"]["items"]
    assert data["setup"] == {
        "has_account": True,
        "has_paycheck": True,
        "has_bills": True,
        "has_bitcoin": True,
        "has_price_source": True,
        "has_backup": False,
    }
    (salary,) = owner.get("/api/income-schedules").json()
    assert salary["frequency"] == "semimonthly" and salary["next_occurrence"] == pay["date"]


# ---------- Bitcoin-denominated bills and backups ----------


def test_bitcoin_bills_need_a_price_before_they_count_in_dollar_totals(owner):
    wallet = new_account(owner, "Spending wallet", "BITCOIN", "500000", "bitcoin_wallet")
    hosting = bill(owner, wallet, "Node hosting", "20000", "2026-03-12")
    data = reading()
    (row,) = data["bills"]["items"]
    assert row["amount"] == "20000" and row["currency"] == "BITCOIN" and row["monthly_amount"] == "20000"
    # Never guessed: without a price the dollar totals are unknown.
    assert data["bills"]["next_7"] is None and data["bills"]["next_30"] is None
    assert data["cash_ahead"]["status"] == "needs_account" and data["cash_ahead"]["events"] == []
    post(owner, "/rates", {"day": "2026-03-10", "usd_per_btc": "100000"})
    data = reading()
    assert data["bills"]["next_7"] == "20.00" and data["bills"]["next_30"] == "20.00"
    assert owner.post(f"/api/recurring-bills/{hosting['id']}/destroy").json() == {"monthly_freed": "20000"}
    assert reading()["bills"]["destroyed"] == {"count": 1, "monthly_freed": "20.00"}
    assert reading(date(2026, 3, 9))["bills"]["destroyed"] == {"count": 1, "monthly_freed": None}


def test_backup_status_reports_the_last_encrypted_backup(owner):
    assert owner.get("/api/backup/status").json() == {"last_backup_at": None}
    assert owner.post("/api/backup", json={"passphrase": "correct horse battery"}).is_success
    made = owner.get("/api/backup/status").json()["last_backup_at"]
    age = datetime.now(timezone.utc) - datetime.fromisoformat(made)
    assert 0 <= age.total_seconds() < 60


def test_backup_and_restore_keep_schedules_card_terms_and_bill_links(owner):
    checking = new_account(owner, amount="900")
    card = new_account(owner, "Card", amount="120", kind="credit_card")
    paycheck(owner, checking, "500", "2026-03-15")
    assert owner.put(f"/api/accounts/{card}/card-terms", json={"credit_limit": "1000", "due_day": 9}).status_code == 200
    payment = bill(owner, checking, "Card payment", "120.00", "2026-03-20")
    owner.put(f"/api/recurring-bills/{payment['id']}/pays-account", json={"account_id": card})
    gone = bill(owner, checking, "Old plan", "12.00", "2026-03-22")
    assert owner.post(f"/api/recurring-bills/{gone['id']}/destroy").status_code == 200
    passphrase = "long-backup-passphrase"
    exported = owner.post("/api/backup", json={"passphrase": passphrase})
    assert exported.status_code == 200
    assert owner.delete(f"/api/recurring-bills/{payment['id']}").status_code == 200
    restored = owner.post(
        "/api/restore",
        data={"passphrase": passphrase},
        files={"file": ("ledger.albackup", exported.content, "application/octet-stream")},
    )
    assert restored.status_code == 200, restored.text
    data = reading()
    assert data["debt"]["cards"][0]["limit"] == "1000.00" and data["debt"]["cards"][0]["due_day"] == 9
    assert data["cash_ahead"]["next_paycheck"]["date"] == "2026-03-15"
    assert data["bills"]["items"][0]["pays_account_id"] == card and data["bills"]["items"][0]["payoff"] == "120.00"
    assert data["bills"]["destroyed"] == {"count": 1, "monthly_freed": "12.00"}


# ---------- Income that varies, cash, and two-week bills ----------


def test_income_that_varies_is_drawn_as_an_estimate_and_the_forecast_says_when_it_leans_on_it(owner):
    checking = new_account(owner, amount="300")
    bill(owner, checking, "Rent", "400.00", "2026-03-20")
    tips = post(
        owner,
        "/income-schedules",
        {
            "account_id": checking,
            "name": "Tips",
            "amount": "150",
            "frequency": "weekly",
            "next_date": "2026-03-13",
            "varies": True,
        },
    )
    assert tips["varies"] is True
    ahead = reading()["cash_ahead"]
    paid = [e for e in ahead["events"] if e["kind"] == "paycheck"]
    assert [e["date"] for e in paid] == ["2026-03-13", "2026-03-20", "2026-03-27", "2026-04-03"]
    assert all(e["estimate"] for e in paid)
    assert ahead["next_paycheck"] == {"date": "2026-03-13", "name": "Tips", "amount": "150.00", "estimate": True}
    # With the tips the rent is covered; without them checking is $100 short on rent day.
    assert ahead["short"] is None
    assert ahead["leans_on_estimate"] == {"income": "600.00", "date": "2026-03-20", "amount": "100.00"}

    # A fixed paycheck is a promise, so the same forecast leans on nothing.
    owner.put(
        f"/api/income-schedules/{tips['id']}",
        json={
            "account_id": checking,
            "name": "Tips",
            "amount": "150",
            "frequency": "weekly",
            "next_date": "2026-03-13",
        },
        headers=owner.headers,
    ).raise_for_status()
    ahead = reading()["cash_ahead"]
    assert ahead["leans_on_estimate"] is None and ahead["next_paycheck"]["estimate"] is False


def test_a_shortfall_is_reported_as_a_shortfall_not_as_leaning_on_an_estimate(owner):
    checking = new_account(owner, amount="100")
    bill(owner, checking, "Rent", "400.00", "2026-03-12")
    post(
        owner,
        "/income-schedules",
        {
            "account_id": checking,
            "name": "Tips",
            "amount": "150",
            "frequency": "weekly",
            "next_date": "2026-03-13",
            "varies": True,
        },
    )
    ahead = reading()["cash_ahead"]
    assert ahead["short"] == {"date": "2026-03-12", "amount": "300.00"}
    assert ahead["leans_on_estimate"] is None


def test_a_cash_only_owner_gets_the_forecast_and_can_be_paid_in_cash(owner):
    wallet = new_account(owner, "Cash on hand", amount="200", kind="cash")
    bill(owner, wallet, "Childcare", "120.00", "2026-03-12", "biweekly")
    paycheck(owner, wallet, "90", "2026-03-14", "weekly", "Babysitting")
    data = reading()
    ahead = data["cash_ahead"]
    assert data["setup"]["has_account"] and ahead["status"] == "ready" and ahead["start"] == "200.00"
    assert [(e["kind"], e["date"]) for e in ahead["events"] if e["name"] == "Childcare"] == [
        ("bill", "2026-03-12"),
        ("bill", "2026-03-26"),
        ("bill", "2026-04-09"),
    ]
    childcare = data["bills"]["items"][0]
    # 26 payments a year, spread over 12 months.
    assert childcare["frequency"] == "biweekly" and childcare["monthly_amount"] == "260.00"


def test_a_two_week_bill_advances_fourteen_days_when_paid(owner):
    checking = new_account(owner, amount="500")
    made = bill(owner, checking, "Childcare", "120.00", "2026-03-06", "biweekly")
    post(
        owner,
        f"/recurring-bills/{made['id']}/record",
        {"due_date": "2026-03-06", "date": "2026-03-06", "amount": "120.00"},
    )
    with SessionLocal() as db:
        assert db.get(RecurringBill, made["id"]).next_due == "2026-03-20"
