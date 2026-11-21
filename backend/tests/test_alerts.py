"""Alert lights: each trigger at its edge, acknowledgement, and no false alarms."""

import copy
from datetime import date, timedelta

import pytest

from app.alerts import Thresholds, evaluate
from app.db import SessionLocal
from app import alerts
from conftest import category, new_account, post, transaction

TODAY = "2026-11-19"


def reading(**changes):
    """A calm fictional dashboard reading; tests change one thing at a time."""
    base = {
        "today": TODAY,
        "days_of_history": 172,
        "cash_ahead": {
            "horizon_days": 30,
            "start": "2412.40",
            "events": [
                {
                    "kind": "bill",
                    "date": "2026-11-21",
                    "name": "Mortgage",
                    "amount": "1400.00",
                    "balance_after": "1012.40",
                },
                {
                    "kind": "paycheck",
                    "date": "2026-12-01",
                    "name": "Salary",
                    "amount": "3100.00",
                    "balance_after": "4112.40",
                },
                {"kind": "bill", "date": "2026-12-05", "name": "Phone", "amount": "65.00", "balance_after": "4047.40"},
            ],
            "next_paycheck": {"date": "2026-12-01", "name": "Salary", "amount": "3100.00"},
            "due_before_paycheck": "1400.00",
            "low": {"date": "2026-11-21", "balance": "1012.40"},
            "short": None,
        },
        "bills": {"items": []},
        "stack": {"status": "ready", "buys": {"count": 2}, "stack_rate": "11.3"},
        "pace": {
            "day": 19,
            "days_in_month": 30,
            "current": {"USD": ["100.00"] * 19},
            "previous": {"USD": ["100.00"] * 31},
        },
        "debt": {"cards": []},
        "budgets": {"items": []},
        "setup": {"has_price_source": True},
    }
    for path, value in changes.items():
        target = base
        *parents, leaf = path.split("__")
        for key in parents:
            target = target[key]
        target[leaf] = value
    base["pace"]["current"]["USD"] = ["100.00"] * base["pace"]["day"]
    return base


CALM = {"backup_days": 1, "price": {"automatic": False}, "missing": [], "pace_rows": []}


def lit(data, facts=None, thresholds=None):
    return {item["id"]: item for item in evaluate(data, {**CALM, **(facts or {})}, thresholds)}


def bill(days_until, name="Car registration", amount="86.00", id=7):
    due = date.fromisoformat(TODAY) + timedelta(days=days_until)
    return {
        "id": id,
        "name": name,
        "amount": amount,
        "currency": "USD",
        "due_date": str(due),
        "days_until": days_until,
        "overdue": days_until < 0,
    }


def card(balance="1284.36", limit="6000.00", utilization="21.4", next_due="2026-11-28"):
    return {
        "name": "Ridgeline Visa",
        "balance": balance,
        "limit": limit,
        "utilization": utilization,
        "next_due": next_due,
    }


def test_a_calm_ledger_lights_nothing():
    assert lit(reading()) == {}


def test_bill_overdue_is_a_caution_first_then_a_warning():
    assert "overdue" not in lit(reading(bills__items=[bill(0)]))  # due today is not overdue
    one = lit(reading(bills__items=[bill(-1)]))["overdue"]
    assert one["level"] == "caution" and one["title"] == "Car registration was due Nov 18"
    assert one["action"] == {"label": "Pay it now", "bill_id": 7} and one["panel"] == "bills"
    assert lit(reading(bills__items=[bill(-2)]))["overdue"]["level"] == "caution"
    assert lit(reading(bills__items=[bill(-3)]))["overdue"]["level"] == "warning"
    two = lit(reading(bills__items=[bill(-1), bill(-5, "Water", "40.00", 8)]))["overdue"]
    assert two["title"] == "2 bills are overdue" and two["magnitude"] == "2" and two["level"] == "warning"
    assert two["action"]["bill_id"] == 8  # the most overdue one
    assert [row["name"] for row in two["rows"]] == ["Water", "Car registration"]


def test_cash_short_warns_inside_a_week_and_cautions_beyond_it():
    def short(day):
        return reading(cash_ahead__short={"date": day, "amount": "757.46"})

    near = lit(short("2026-11-26"))["cash"]  # 7 days out
    assert near["level"] == "warning" and near["magnitude"] == "757.46" and near["panel"] == "cash"
    assert near["advice"] == {
        "text": "Get at least {value} more into checking before Nov 26.",
        "value": "757.46",
        "unit": "USD",
    }
    assert [row["name"] for row in near["rows"]] == ["Mortgage"]  # only bills up to payday
    assert lit(short("2026-11-27"))["cash"]["level"] == "caution"  # 8 days out
    assert "cash" not in lit(reading())


def test_card_due_reminds_then_cautions_and_ignores_a_paid_card():
    def due(days):
        return reading(debt__cards=[card(next_due=str(date.fromisoformat(TODAY) + timedelta(days=days)))])

    assert "card" not in lit(due(8))
    assert lit(due(7))["card"]["level"] == "advisory"
    assert lit(due(3))["card"]["level"] == "advisory"
    assert lit(due(2))["card"]["level"] == "caution"
    assert lit(due(0))["card"]["title"] == "Ridgeline Visa payment is due today"
    assert "card" not in lit(reading(debt__cards=[card(balance="0.00", utilization="0.0", next_due="2026-11-20")]))
    assert "card" not in lit(reading(debt__cards=[card(next_due=None)]))


def test_spend_pace_needs_both_twenty_percent_and_150_dollars():
    def pace(now, before, day=19):
        data = reading(pace__day=day)
        data["pace"]["current"]["USD"] = [now] * day
        data["pace"]["previous"]["USD"] = [before] * 31
        return data

    assert "pace" not in lit(pace("1199.99", "1000.00"))  # 19.999% over
    hit = lit(pace("1200.00", "1000.00"))["pace"]  # exactly 20% and $200 over
    assert hit["level"] == "caution" and hit["magnitude"] == "20.0" and hit["panel"] == "pace"
    assert [fact["value"] for fact in hit["facts"]] == ["1200.00", "1000.00", "200.00"]
    assert "pace" not in lit(pace("649.99", "500.00"))  # 30% over but only $149.99
    assert "pace" in lit(pace("650.00", "500.00"))  # 30% over and exactly $150
    assert "pace" not in lit(pace("1200.00", "1000.00", day=4))  # too early in the month
    assert "pace" in lit(pace("1200.00", "1000.00", day=5))
    assert "pace" not in lit(pace("500.00", "0.00"))  # nothing to compare against
    first_month = pace("1200.00", "1000.00")
    first_month["pace"]["previous"] = None
    assert "pace" not in lit(first_month)
    partial = pace("1200.00", "1000.00")
    partial["pace"]["current"]["USD"][18] = None
    assert "pace" not in lit(partial)  # a missing total is never treated as zero


def test_spend_pace_compares_against_the_last_day_of_a_shorter_month():
    data = reading(pace__day=31, pace__days_in_month=31)
    data["pace"]["current"]["USD"] = ["2000.00"] * 31
    data["pace"]["previous"]["USD"] = ["1000.00"] * 30
    assert lit(data)["pace"]["facts"][1]["value"] == "1000.00"


def test_credit_use_lines_and_the_exact_amount_to_get_back_under():
    assert "util" not in lit(reading(debt__cards=[card(balance="1799.99", utilization="29.9", next_due=None)]))
    at = lit(reading(debt__cards=[card(balance="1800.00", utilization="30.0", next_due=None)]))["util"]
    assert at["level"] == "caution" and at["advice"]["value"] == "0.00"
    high = lit(reading(debt__cards=[card(balance="4128.00", utilization="68.8", next_due=None)]))["util"]
    assert high["title"] == "Ridgeline Visa is at 69% of its limit" and high["panel"] == "debt"
    assert high["advice"] == {"text": "Pay {value} to get back under your 30% line.", "value": "2328.00", "unit": "USD"}
    assert (
        lit(reading(debt__cards=[card(balance="5400.00", utilization="90.0", next_due=None)]))["util"]["level"]
        == "warning"
    )
    assert "util" not in lit(reading(debt__cards=[card(limit=None, utilization=None, next_due=None)]))


def test_allowance_is_advisory_when_nearly_used_and_a_caution_when_over():
    def budget(percent, day=19):
        return reading(
            pace__day=day,
            budgets__items=[{"category": "Dining", "planned_usd": "400.00", "spent_usd": "360.00", "percent": percent}],
        )

    assert "allow" not in lit(budget("89.9"))
    assert lit(budget("90.0"))["allow"]["level"] == "advisory"
    assert "allow" not in lit(budget("95.0", day=23))  # 7 days left: nearly used is expected by now
    assert lit(budget("100.0", day=23)).get("allow") is None
    over = lit(budget("100.1", day=29))["allow"]
    assert over["level"] == "caution" and over["title"] == "Dining is over its allowance" and over["panel"] == "budgets"
    assert "allow" not in lit(
        reading(budgets__items=[{"category": "Dining", "planned_usd": "400.00", "spent_usd": None, "percent": None}])
    )


def test_price_feed_never_lights_in_manual_mode():
    assert "price" not in lit(
        reading(), {"price": {"automatic": False, "quote_age_minutes": 9999, "failing_minutes": 9999}}
    )
    fresh = {"price": {"automatic": True, "quote_age_minutes": 9, "failing_minutes": None}}
    assert "price" not in lit(reading(), fresh)
    stale = lit(reading(), {"price": {"automatic": True, "quote_age_minutes": 10, "failing_minutes": None}})["price"]
    assert stale["level"] == "advisory"
    assert (
        lit(reading(), {"price": {"automatic": True, "quote_age_minutes": None, "failing_minutes": None}})["price"][
            "level"
        ]
        == "advisory"
    )
    assert (
        lit(reading(), {"price": {"automatic": True, "quote_age_minutes": 40, "failing_minutes": 29}})["price"]["level"]
        == "advisory"
    )
    assert (
        lit(reading(), {"price": {"automatic": True, "quote_age_minutes": 40, "failing_minutes": 30}})["price"]["level"]
        == "caution"
    )


def test_missing_price_escalates_by_count_or_age():
    def missing(count, day="2026-11-18"):
        return {
            "missing": [
                {"date": day, "name": f"Expense {n}", "amount": "5.00", "currency": "USD"} for n in range(count)
            ]
        }

    one = lit(reading(), missing(1))["conv"]
    assert one["level"] == "advisory" and one["title"] == "1 expense has no purchase-date bitcoin price"
    assert lit(reading(), missing(9))["conv"]["level"] == "advisory"
    ten = lit(reading(), missing(10))["conv"]
    assert ten["level"] == "caution" and ten["magnitude"] == "10" and len(ten["rows"]) == 5
    assert lit(reading(), missing(1, "2026-11-06"))["conv"]["level"] == "advisory"  # 13 days old
    assert lit(reading(), missing(1, "2026-11-05"))["conv"]["level"] == "caution"  # 14 days old


def test_backup_reminders_and_the_grace_period_for_a_new_ledger():
    assert "backup" not in lit(reading(), {"backup_days": 13})
    assert lit(reading(), {"backup_days": 14})["backup"]["level"] == "advisory"
    assert lit(reading(), {"backup_days": 29})["backup"]["level"] == "advisory"
    late = lit(reading(), {"backup_days": 30})["backup"]
    assert late["level"] == "caution" and late["title"] == "Last encrypted backup was 30 days ago"
    assert "backup" not in lit(reading(days_of_history=6), {"backup_days": None})
    never = lit(reading(days_of_history=7), {"backup_days": None})["backup"]
    assert never["level"] == "caution" and never["title"] == "This ledger has never been backed up"
    assert "backup" not in lit(reading(days_of_history=0), {"backup_days": None})


def test_no_stack_yet_waits_for_day_twenty_and_for_income():
    quiet = reading(stack__buys={"count": 0}, stack__stack_rate="0.0")
    nudge = lit(quiet)
    assert "stack" not in nudge  # the 19th
    later = reading(today="2026-11-20", stack__buys={"count": 0}, stack__stack_rate="0.0")
    found = lit(later)["stack"]
    assert found["level"] == "advisory" and found["panel"] == "stack"
    assert "stack" not in lit(reading(today="2026-11-20", stack__buys={"count": 1}, stack__stack_rate="5.0"))
    assert "stack" not in lit(
        reading(today="2026-11-20", stack__buys={"count": 0}, stack__stack_rate=None)
    )  # no income yet
    assert "stack" not in lit(
        reading(today="2026-11-20", stack__status="needs_bitcoin", stack__buys={"count": 0}, stack__stack_rate="0.0")
    )


def test_every_light_can_be_switched_off_and_thresholds_move_the_edges():
    data = reading(
        bills__items=[bill(-9)], debt__cards=[card(balance="4128.00", utilization="68.8", next_due="2026-11-20")]
    )
    assert {"overdue", "util", "card"} <= set(lit(data))
    off = Thresholds(overdue={"on": False}, util={"on": False}, card={"on": False})
    assert lit(data, thresholds=off) == {}
    relaxed = Thresholds(util={"caution_percent": 70, "warning_percent": 95}, overdue={"warning_days": 10})
    found = lit(data, thresholds=relaxed)
    assert "util" not in found and found["overdue"]["level"] == "caution"
    with pytest.raises(ValueError):
        Thresholds(pace={"percent": 0})
    with pytest.raises(ValueError):
        Thresholds(pace={"surprise": 1})


def test_alerts_come_back_in_light_order():
    data = reading(bills__items=[bill(-4)], debt__cards=[card(balance="4128.00", utilization="68.8", next_due=None)])
    found = evaluate(data, {**CALM, "backup_days": 40}, None)
    assert [item["id"] for item in found] == ["overdue", "util", "backup"]


# ---------- Through the API ----------


def test_an_empty_ledger_is_all_dark(owner):
    result = owner.get("/api/alerts").json()
    assert [light["id"] for light in result["lights"]] == [
        "overdue",
        "cash",
        "card",
        "pace",
        "util",
        "allow",
        "price",
        "conv",
        "backup",
        "stack",
    ]
    assert result["active"] == []


def test_alerts_need_a_session(client):
    assert client.get("/api/alerts").status_code == 401
    assert client.post("/api/alerts/acknowledge-all").status_code == 401


def without_backup_light(owner):
    """A test ledger opened months ago has never been backed up; set that light aside."""
    settings = owner.get("/api/settings/alert-thresholds").json()
    settings["backup"]["on"] = False
    assert owner.put("/api/settings/alert-thresholds", json=settings).status_code == 200
    return settings


def overdue_bill(owner, account, amount="86.00", description="Car registration", days=5):
    return post(
        owner,
        "/recurring-bills",
        {
            "frequency": "monthly",
            "transaction": {
                "date": str(date.today() - timedelta(days=days)),
                "kind": "expense",
                "account_id": account,
                "category_id": category(owner, "expense"),
                "amount": amount,
                "description": description,
            },
        },
    )


def test_acknowledging_keeps_the_light_on_until_it_gets_worse_or_clears(owner):
    without_backup_light(owner)
    account = new_account(owner, amount="5000")
    first = overdue_bill(owner, account)
    active = owner.get("/api/alerts").json()["active"]
    assert [(a["id"], a["level"], a["acknowledged"]) for a in active] == [("overdue", "warning", False)]

    assert owner.post("/api/alerts/overdue/acknowledge").json() == {"acknowledged": ["overdue"]}
    assert owner.get("/api/alerts").json()["active"][0]["acknowledged"] is True  # still lit, now acknowledged

    overdue_bill(owner, account, "40.00", "Water")  # worse: a second bill is overdue
    again = owner.get("/api/alerts").json()["active"][0]
    assert again["magnitude"] == "2" and again["acknowledged"] is False

    assert owner.post("/api/alerts/acknowledge-all").json() == {"acknowledged": ["overdue"]}
    assert owner.get("/api/alerts").json()["active"][0]["acknowledged"] is True

    # Paying both clears the light; a new overdue bill later starts unacknowledged.
    for bill_row in owner.get("/api/recurring-bills").json():
        post(
            owner,
            f"/recurring-bills/{bill_row['id']}/record",
            {"due_date": bill_row["next_due"], "date": str(date.today()), "amount": bill_row["amount"]},
        )
    assert owner.get("/api/alerts").json()["active"] == []
    overdue_bill(owner, account, "12.00", "Parking permit")
    assert owner.get("/api/alerts").json()["active"][0]["acknowledged"] is False
    assert first["id"]


def test_acknowledging_an_inactive_alert_is_refused(owner):
    assert owner.post("/api/alerts/overdue/acknowledge").status_code == 404
    assert owner.post("/api/alerts/nonsense/acknowledge").status_code == 404


def test_acknowledging_never_touches_the_journal(owner):
    account = new_account(owner, amount="5000")
    overdue_bill(owner, account)
    before = owner.get("/api/export/journal").text
    owner.post("/api/alerts/acknowledge-all")
    owner.get("/api/alerts")
    assert owner.get("/api/export/journal").text == before


def test_thresholds_are_saved_validated_and_applied(owner):
    defaults = owner.get("/api/settings/alert-thresholds").json()
    assert defaults["pace"] == {"on": True, "percent": 20, "dollars": 150, "from_day": 5}
    assert defaults["util"]["caution_percent"] == 30 and defaults["backup"]["caution_days"] == 30
    defaults = without_backup_light(owner)

    account = new_account(owner, amount="5000")
    overdue_bill(owner, account, days=1)
    assert owner.get("/api/alerts").json()["active"][0]["level"] == "caution"
    changed = copy.deepcopy(defaults)
    changed["overdue"]["warning_days"] = 1
    assert owner.put("/api/settings/alert-thresholds", json=changed).status_code == 200
    assert owner.get("/api/alerts").json()["active"][0]["level"] == "warning"
    changed["overdue"]["on"] = False
    owner.put("/api/settings/alert-thresholds", json=changed)
    assert owner.get("/api/alerts").json()["active"] == []

    bad = copy.deepcopy(defaults)
    bad["pace"]["percent"] = 0
    assert owner.put("/api/settings/alert-thresholds", json=bad).status_code == 422
    assert owner.get("/api/settings/alert-thresholds").json() == changed  # a refused save changes nothing


def test_missing_prices_are_reported_only_once_a_price_source_exists(owner):
    without_backup_light(owner)
    account = new_account(owner, amount="500")
    transaction(owner, account, amount="7.00", date="2026-01-05", description="Before any price")
    assert owner.get("/api/alerts").json()["active"] == []  # no price source: nothing to be missing from
    post(owner, "/rates", {"day": str(date.today()), "usd_per_btc": "100000"})
    found = {a["id"]: a for a in owner.get("/api/alerts").json()["active"]}
    assert found["conv"]["rows"][0]["name"] == "Before any price"
    assert found["conv"]["level"] == "caution"  # far older than 14 days


def test_a_ledger_that_was_never_backed_up_says_so(owner):
    new_account(owner, amount="500")  # opened months ago in the fixture
    found = {a["id"]: a for a in owner.get("/api/alerts").json()["active"]}
    assert found["backup"]["level"] == "caution"
    assert found["backup"]["title"] == "This ledger has never been backed up"


def test_the_fictional_demo_raises_no_money_alarm(owner):
    assert owner.post("/api/demo").status_code == 200
    with SessionLocal() as db:
        ids = {item["id"]: item["level"] for item in alerts.read(db)["active"]}
    assert not {"overdue", "cash", "util", "pace"} & set(ids), ids
    assert all(level != "warning" for level in ids.values())
