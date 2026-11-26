"""Income over time: sources, history in dollars and bitcoin, raises, and pay that did not come."""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from conftest import category, new_account, post, transaction

TODAY = date.today()


def pay(client, account, day, amount, description="Acme payroll", **kw):
    return transaction(client, account, kind="income", amount=amount, date=str(day), description=description, **kw)


def income(client):
    reply = client.get("/api/income")
    assert reply.status_code == 200, reply.text
    return reply.json()


def source(client, name):
    return next(row for row in income(client)["sources"] if row["name"] == name)


def test_one_paycheck_is_enough_for_the_screen_to_make_sense(owner):
    assert income(owner)["status"] == "needs_income"
    checking = new_account(owner)
    pay(owner, checking, TODAY, "1500.00")
    data = income(owner)
    assert data["status"] == "ready" and data["months_of_history"] == 1
    assert [row["name"] for row in data["sources"]] == ["Acme payroll"]
    assert data["months"][-1]["usd"] == "1500.00" and data["months"][-1]["paychecks"] == 1
    assert data["changes"] == [] and data["problems"] == []
    assert data["sources"][0]["typical"] is None  # one check is not a pattern yet


def test_each_paycheck_is_converted_at_its_own_saved_price_and_a_missing_one_is_said(owner):
    checking = new_account(owner)
    first, second = TODAY.replace(day=1) - timedelta(days=40), TODAY.replace(day=1) - timedelta(days=38)
    post(owner, "/rates", {"day": str(first), "usd_per_btc": "50000"})
    pay(owner, checking, first, "1000.00")
    post(owner, "/rates", {"day": str(second), "usd_per_btc": "100000"})
    pay(owner, checking, second, "1000.00")
    month = next(row for row in income(owner)["months"] if row["month"] == str(first)[:7])
    # 1,000 dollars at 50,000 is 2,000,000; at 100,000 it is 1,000,000.
    assert (month["usd"], month["bitcoin"], month["missing_bitcoin"]) == ("2000.00", "3000000", 0)
    # A later price for the same day, and today's price, change nothing already recorded.
    post(owner, "/rates", {"day": str(first), "usd_per_btc": "1"})
    post(owner, "/rates", {"day": str(TODAY), "usd_per_btc": "250000"})
    assert next(row for row in income(owner)["months"] if row["month"] == str(first)[:7])["bitcoin"] == "3000000"
    # A paycheck on a day with no price has no bitcoin figure, and the month says how many.
    unpriced = first - timedelta(days=62)
    pay(owner, checking, unpriced, "700.00")
    gap = next(row for row in income(owner)["months"] if row["month"] == str(unpriced)[:7])
    assert (gap["usd"], gap["bitcoin"], gap["missing_bitcoin"]) == ("700.00", None, 1)


def test_sources_can_be_renamed_merged_and_ended_with_history_kept(owner):
    checking = new_account(owner)
    for week in range(4):
        pay(owner, checking, TODAY - timedelta(days=14 * week + 1), "1500.00", "ACME PAYROLL 0042")
    pay(owner, checking, TODAY - timedelta(days=5), "300.00", "Weekend wiring")
    pay(owner, checking, TODAY - timedelta(days=3), "1500.00", "Acme direct deposit")
    acme, other = source(owner, "ACME PAYROLL 0042"), source(owner, "Acme direct deposit")
    assert acme["paychecks"] == 4

    assert owner.put(f"/api/income/sources/{acme['id']}", json={"name": "Day job"}).status_code == 200
    assert owner.put(f"/api/income/sources/{other['id']}", json={"name": "day job"}).status_code == 422
    assert owner.post(f"/api/income/sources/{other['id']}/merge", json={"into": acme["id"]}).status_code == 200
    job = source(owner, "Day job")
    assert job["paychecks"] == 5 and job["all_time"]["usd"] == "7500.00"
    assert "Acme direct deposit" not in [row["name"] for row in income(owner)["sources"]]
    # The names it has gone by are remembered: the next paycheck lands in the same place.
    pay(owner, checking, TODAY, "1500.00", "acme  direct deposit")
    pay(owner, checking, TODAY, "1500.00", "ACME PAYROLL 0042")
    assert source(owner, "Day job")["paychecks"] == 7 and len(income(owner)["sources"]) == 2

    gig = source(owner, "Weekend wiring")
    ended = str(TODAY - timedelta(days=2))
    assert (
        owner.put(f"/api/income/sources/{gig['id']}", json={"name": "Weekend wiring", "ended_on": ended}).status_code
        == 200
    )
    gig = source(owner, "Weekend wiring")
    assert gig["ended_on"] == ended and gig["paychecks"] == 1 and gig["all_time"]["usd"] == "300.00"
    # One paycheck can be moved by hand, and a correction keeps its source.
    moved = income(owner)["recent"][0]
    assert owner.put(f"/api/income/paychecks/{moved['id']}/source", json={"source_id": gig["id"]}).status_code == 200
    assert source(owner, "Weekend wiring")["paychecks"] == 2
    fixed = owner.put(
        f"/api/transactions/{moved['id']}",
        json={
            "date": moved["date"],
            "kind": "income",
            "account_id": checking,
            "category_id": category(owner, "income"),
            "amount": "1510.00",
            "description": "Something else entirely",
        },
    )
    assert fixed.status_code == 200
    assert source(owner, "Weekend wiring")["paychecks"] == 2 and len(income(owner)["sources"]) == 2
    assert owner.post(f"/api/income/sources/{gig['id']}/merge", json={"into": gig["id"]}).status_code == 422
    assert owner.put("/api/income/sources/999", json={"name": "x"}).status_code == 404


def test_raises_and_cuts_are_named_in_plain_words_and_overtime_is_not_a_raise(owner):
    checking = new_account(owner)
    start = date(TODAY.year - 1, 1, 3)
    amounts = [
        "1000.00",
        "1000.00",
        "1180.00",
        "1000.00",
        "1080.00",
        "1080.00",
        "1080.00",
        "500.00",
        "1080.00",
        "972.00",
        "972.00",
    ]
    days = [start + timedelta(days=14 * n) for n in range(len(amounts))]
    for day, amount in zip(days, amounts):
        pay(owner, checking, day, amount)
    data = income(owner)
    changes = sorted(data["changes"], key=lambda change: change["date"])
    assert [(c["kind"], c["percent"], c["date"]) for c in changes] == [
        ("raise", "8", str(days[4])),
        ("cut", "10", str(days[9])),
    ]
    from app.income import MONTH_NAMES

    assert changes[0]["text"] == f"Pay went up 8% in {MONTH_NAMES[days[4].month - 1]} {days[4].year}."
    assert changes[1]["text"].startswith("Pay went down 10% in ")
    assert data["sources"][0]["typical"] == "972.00"


def test_late_short_and_missing_pay_is_caught_and_raises_a_dashboard_alert(owner):
    checking = new_account(owner)
    # Paid every second week; the last expected payday was three days ago and did not come.
    due = TODAY - timedelta(days=3)
    for back in (3, 2, 1):
        pay(owner, checking, due - timedelta(days=14 * back), "1500.00", "Paycheck")
    post(
        owner,
        "/income-schedules",
        {
            "account_id": checking,
            "name": "Paycheck",
            "amount": "1500.00",
            "frequency": "biweekly",
            "next_date": str(due + timedelta(days=14)),
        },
    )
    expected = source(owner, "Paycheck")["expected"][0]["paychecks"]
    assert [row["status"] for row in expected] == ["received", "received", "received", "late"]
    problem = income(owner)["problems"][0]
    assert (problem["status"], problem["days_late"], problem["date"]) == ("late", 3, str(due))
    alert = next(item for item in owner.get("/api/alerts").json()["active"] if item["id"] == "pay")
    assert alert["level"] == "caution" and "is late" in alert["title"] and alert["action"]["route"] == "income"

    # It arrives, but short.
    pay(owner, checking, TODAY, "1200.00", "Paycheck")
    problem = income(owner)["problems"][0]
    assert (problem["status"], problem["short_by"], problem["actual"]) == ("short", "300.00", "1200.00")
    alert = next(item for item in owner.get("/api/alerts").json()["active"] if item["id"] == "pay")
    assert "was short" in alert["title"]
    # Corrected to the full amount, the alert clears.
    last = income(owner)["recent"][0]
    owner.put(
        f"/api/transactions/{last['id']}",
        json={
            "date": str(TODAY),
            "kind": "income",
            "account_id": checking,
            "category_id": category(owner, "income"),
            "amount": "1500.00",
            "description": "Paycheck",
        },
    )
    assert income(owner)["problems"] == []
    assert not [item for item in owner.get("/api/alerts").json()["active"] if item["id"] == "pay"]


def test_pay_more_than_a_week_overdue_is_missing_and_a_new_schedule_never_cries_wolf(owner):
    checking = new_account(owner)
    post(
        owner,
        "/income-schedules",
        {
            "account_id": checking,
            "name": "Paycheck",
            "amount": "1500.00",
            "frequency": "monthly",
            "next_date": str(TODAY + timedelta(days=5)),
        },
    )
    # Nothing recorded yet: nothing was expected before the ledger began.
    assert income(owner)["problems"] == []
    assert source(owner, "Paycheck")["expected"][0]["paychecks"] == []
    due = TODAY - timedelta(days=9)
    owner.delete(f"/api/income-schedules/{owner.get('/api/income-schedules').json()[0]['id']}")
    pay(owner, checking, due - timedelta(days=28), "1500.00", "Paycheck")
    pay(owner, checking, due - timedelta(days=14), "1500.00", "Paycheck")
    post(
        owner,
        "/income-schedules",
        {
            "account_id": checking,
            "name": "Paycheck",
            "amount": "1500.00",
            "frequency": "biweekly",
            "next_date": str(due + timedelta(days=14)),
        },
    )
    problem = income(owner)["problems"][0]
    assert (problem["status"], problem["days_late"]) == ("missing", 9)
    alert = next(item for item in owner.get("/api/alerts").json()["active"] if item["id"] == "pay")
    assert alert["level"] == "warning" and "has not arrived" in alert["title"]
    # An ended source expects nothing more.
    job = source(owner, "Paycheck")
    owner.put(f"/api/income/sources/{job['id']}", json={"name": "Paycheck", "ended_on": str(TODAY)})
    assert income(owner)["problems"] == []


def test_the_share_saved_in_bitcoin_is_shown_for_each_month(owner):
    checking = new_account(owner, amount="5000")
    wallet = new_account(owner, name="Wallet", currency="BITCOIN", amount="0", kind="bitcoin_wallet")
    day = TODAY.replace(day=1)
    post(owner, "/rates", {"day": str(day), "usd_per_btc": "100000"})
    pay(owner, checking, day, "2000.00")
    transaction(
        owner,
        checking,
        kind="transfer",
        amount="500.00",
        date=str(day),
        destination_id=wallet,
        destination_amount="500000",
        description="Bought bitcoin",
    )
    month = income(owner)["months"][-1]
    assert (month["usd"], month["saved_usd"], month["saved_bitcoin"], month["stack_rate"]) == (
        "2000.00",
        "500.00",
        "500000",
        "25.0",
    )


def test_the_demo_person_has_five_years_of_pay_with_raises_and_a_job_change(owner):
    assert owner.post("/api/demo").status_code == 200
    data = income(owner)
    assert data["months_of_history"] >= 60 and data["problems"] == []
    names = {row["name"]: row for row in data["sources"]}
    assert set(names) == {"Carver & Sons Electrical", "Blue Ridge Home Electric", "Tax refund", "Other income"}
    assert names["Blue Ridge Home Electric"]["ended_on"] == "2023-03-10"
    assert names["Carver & Sons Electrical"]["expected"][0]["schedule"]["frequency"] == "biweekly"
    kinds = [change["kind"] for change in data["changes"]]
    assert kinds.count("job") == 1 and kinds.count("raise") >= 2 and "cut" not in kinds
    job = next(change for change in data["changes"] if change["kind"] == "job")
    assert job["text"] == "Changed jobs in March 2023: a typical paycheck went up 20%."
    assert all(month["usd"] is not None for month in data["months"])
    # Most months carry real prices, so most months have a bitcoin figure and a stack rate.
    assert sum(month["bitcoin"] is not None for month in data["months"]) >= 55
    assert sum(month["stack_rate"] is not None for month in data["months"]) >= 55
    assert names["Carver & Sons Electrical"]["expected"][0]["paychecks"][-1]["status"] in ("received", "due")


def test_one_persons_income_never_shows_for_another(client):
    def join(name):
        browser = TestClient(app)
        reply = browser.post("/api/auth/setup", json={"username": name, "password": f"{name}-long-password"})
        browser.headers["X-CSRF-Token"] = reply.json()["csrf"]
        return browser

    ann, ben = join("ann"), join("ben")
    assert ann.post("/api/demo?months=6").status_code == 200
    account = new_account(ben, name="Ben checking")
    pay(ben, account, TODAY, "4321.00", "Ben zebra wages")
    hers, his = ann.get("/api/income").text, ben.get("/api/income").text
    assert "Carver & Sons" in hers and "Ben zebra wages" not in hers and "4321.00" not in hers
    assert "Ben zebra wages" in his and "Carver" not in his and "Blue Ridge" not in his
    assert len(income(ben)["sources"]) == 1 and income(ben)["months_of_history"] == 1
    # Ben cannot rename, merge or move anything of Ann's: her ids mean nothing in his ledger.
    his_id = income(ben)["sources"][0]["id"]
    for id in [row["id"] for row in income(ann)["sources"] if row["id"] != his_id]:
        assert ben.put(f"/api/income/sources/{id}", json={"name": "Mine now"}).status_code == 404
        assert ben.post(f"/api/income/sources/{id}/merge", json={"into": 1}).status_code == 404
    assert ann.get("/api/income").text == hers
    assert not [item for item in ben.get("/api/alerts").json()["active"] if item["id"] == "pay"]


def test_a_hundred_years_of_income_is_all_there(owner):
    """No cap on years: a ledger kept for a century shows every month of it."""
    from app import income as income_module
    from app.db import SessionLocal

    checking = new_account(owner)
    pay(owner, checking, date(1971, 3, 5), "200.00", "First job")
    pay(owner, checking, TODAY, "1500.00")
    data = income(owner)
    span = (TODAY.year - 1971) * 12 + TODAY.month - 3 + 1
    assert data["months_of_history"] == span > 600
    assert (data["months"][0]["month"], data["months"][0]["usd"]) == ("1971-03", "200.00")
    # Read a hundred years from now, the same ledger answers with every month since the first.
    later = date(TODAY.year + 100, TODAY.month, 1)
    with SessionLocal() as db:
        far = income_module.report(db, later)
    assert far["months_of_history"] == span + 1200 and far["months"][-1]["month"] == later.strftime("%Y-%m")
    assert far["months"][0]["usd"] == "200.00" and far["problems"] == []
    # The longer views take as many years as are asked for.
    assert owner.get("/api/reports?months=1200").status_code == 200
    first, last = date(1971, 1, 1), TODAY
    assert owner.get(f"/api/spending-history?start={first}&end={last}&interval=year").status_code == 200
