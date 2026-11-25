"""The retirement screen's API: what it reads from the ledger, and what it keeps."""

import json
from datetime import date
from app.db import SessionLocal
from app.models import AuditEvent, User
from app.retirement_plan import build
from app.schemas import RetirementSettings
from conftest import category, new_account, post, transaction

URL = "/api/planning/retirement"
TODAY = date(2026, 11, 24)


def settings(**changes):
    return {"birth_date": "1981-05-10", **changes}


def ledger(owner, years=3, monthly="3000.00"):
    """A bitcoin wallet, a checking account and one expense a month, with a fixed reference price."""
    post(owner, "/rates", {"day": "2023-01-01", "usd_per_btc": "100000"})
    checking = new_account(owner, amount="100000")
    wallet = new_account(owner, "Wallet", "BITCOIN", "500000000", "bitcoin_wallet")
    month = 2026 * 12 + 9
    for index in range(month - years * 12 + 1, month + 1):
        day = f"{index // 12}-{index % 12 + 1:02d}-02"
        post(owner, "/rates", {"day": day, "usd_per_btc": "100000"})
        transaction(owner, checking, amount=monthly, date=day, description="Living costs")
    return checking, wallet


def view(today=TODAY, trying=(), **changes):
    with SessionLocal() as db:
        return build(db, RetirementSettings(**settings(**changes)), trying, today)


def test_needs_each_thing_in_turn(owner):
    assert view()["status"] == "needs_price"
    post(owner, "/rates", {"day": "2026-01-01", "usd_per_btc": "100000"})
    assert view()["status"] == "needs_spending"
    assert view(monthly_spending_usd="3000", birth_date=None)["status"] == "needs_birth_date"
    assert view(monthly_spending_usd="3000", growth_pct=None)["status"] == "needs_growth"
    ready = view(monthly_spending_usd="3000")
    assert ready["status"] == "ready"
    assert ready["answer"]["first"] is None
    # What needs no forecast is there before a birth date is given.
    assert view(monthly_spending_usd="3000", birth_date=None)["today"]["year_usd"] == "36000.00"


def test_reads_twelve_full_months_and_steady_years(owner):
    ledger(owner)
    result = view()
    facts = result["ledger"]
    assert facts["spending_basis"] == "record" and facts["spending_months"] == 12
    assert facts["spending_usd"] == "3000.00"
    assert [row["usd"] for row in facts["years"]] == ["36000.00"] * 3
    assert [row["year"] for row in facts["years"]] == [2024, 2025, 2026]
    assert facts["years"][0]["start"] == "2023-11-01" and facts["years"][-1]["end"] == "2026-10-31"
    assert facts["years"][0]["bitcoin"] == "36000000"
    assert facts["trend"] == {"pct": "0.0", "years": 3, "from": 2024}
    assert result["today"]["covered_months"] == 166
    assert result["today"]["year_share_pct"] == "7.2"
    assert view(measure_from=2025)["ledger"]["trend"]["years"] == 2
    assert view(measure_from=2026)["ledger"]["trend"] is None


def test_a_proven_record_lowers_the_hurdle(owner):
    ledger(owner)
    options = {"tax_pct": "0"}
    own = float(view(**options)["today"]["hurdle_pct"])
    standard = float(view(use_record=False, **options)["today"]["hurdle_pct"])
    assert own < standard


def test_short_record_is_early_and_counts_a_yearly_bill_once(owner):
    checking, _ = ledger(owner, years=0)
    for month in (8, 9, 10):
        transaction(owner, checking, amount="2000.00", date=f"2026-{month:02d}-02", description="Living costs")
    assert view()["ledger"]["spending_basis"] == "early"
    assert view()["ledger"]["spending_months"] == 3
    assert view()["ledger"]["trend"] is None
    before = view()["ledger"]["spending_usd"]
    bill = {
        "transaction": {
            "date": "2027-01-15",
            "kind": "expense",
            "account_id": checking,
            "category_id": category(owner, "expense"),
            "amount": "1200.00",
            "description": "Yearly insurance",
        },
        "frequency": "yearly",
    }
    post(owner, "/recurring-bills", bill)
    assert float(view()["ledger"]["spending_usd"]) == float(before) + 100


def test_one_off_costs_and_category_shares(owner):
    checking, _ = ledger(owner)
    roof = transaction(owner, checking, amount="12000.00", date="2026-06-09", description="New roof")["id"]
    assert view()["ledger"]["spending_usd"] == "4000.00"
    assert view()["ledger"]["one_offs"][0]["description"] == "New roof"
    left = view(left_out_entries=[roof])
    assert left["ledger"]["spending_usd"] == "3000.00"
    assert left["ledger"]["years"][-1]["usd"] == "36000.00"
    assert left["ledger"]["one_offs"][0]["left_out"] is True
    half = view(left_out_entries=[roof], category_shares={category(owner, "expense"): 50})
    assert half["ledger"]["spending_usd"] == "1500.00"
    entered = view(monthly_spending_usd="2500")["ledger"]
    assert entered["spending_usd"] == "2500.00" and entered["recorded_spending_usd"] == "4000.00"


def test_this_months_partial_spending_is_left_out(owner):
    checking, _ = ledger(owner)
    transaction(owner, checking, amount="9000.00", date="2026-11-05")
    assert view()["ledger"]["spending_usd"] == "3000.00"


def test_bitcoin_buys_average_and_debts_are_counted_once(owner):
    checking, wallet = ledger(owner)
    for month in (3, 6):
        transaction(
            owner,
            checking,
            kind="transfer",
            amount="600.00",
            destination_id=wallet,
            destination_amount="600000",
            date=f"2026-{month:02d}-10",
        )
    assert view()["ledger"]["purchase_usd"] == "100.00"
    assert view(monthly_purchase_usd="450")["ledger"]["purchase_usd"] == "450.00"
    clear = int(view()["answer"]["chart"][0]["need"])
    new_account(owner, "Car loan", "USD", "5000", "loan")
    owed = view()
    assert owed["ledger"]["debts"] == [{"name": "Car loan", "owed_usd": "5000.00", "monthly_usd": "0.00"}]
    # $5,000 with 10% set aside for tax on the sale, at $100,000.
    assert 5_555_550 <= int(owed["answer"]["chart"][0]["need"]) - clear <= 5_555_560


def test_answer_hangs_together(owner):
    ledger(owner)
    answer = view(monthly_purchase_usd="300")["answer"]
    first, safe = answer["first"], answer["safe"]
    assert first["month"] <= safe["month"]
    assert int(first["bitcoin"]) >= int(first["need"])
    assert [row["month"] for row in answer["crashes"]] == [None, "2017-12", "2021-04", "2021-11", "2025-10"]
    assert any(row["out_age"] for row in answer["crashes"])
    assert answer["after"]["out_age"] is None and answer["after"]["points"][0]["bitcoin"] == first["bitcoin"]
    assert [row["year"] for row in answer["projected_years"]] == [2027, 2028, 2029]
    buy = next(row for row in answer["levers"] if row["id"] == "buy")
    assert buy["months_sooner"] >= 0 and buy["applied"] is False
    tried = view(monthly_purchase_usd="300", trying=["less"])["answer"]
    assert tried["first"]["month"] <= first["month"]
    assert next(row for row in tried["levers"] if row["id"] == "less")["applied"] is True
    # An unknown lever is ignored rather than failing.
    assert view(monthly_purchase_usd="300", trying=["nope"])["answer"]["first"] == first


def test_runway_needs_no_birth_date_and_leads_to_the_ages(owner):
    ledger(owner)
    simple = {"monthly_spending_usd": "20000", "tax_pct": "0", "use_record": False, "cost_rise_pct": "0"}
    young = view(birth_date=None, **simple)
    assert young["status"] == "needs_birth_date" and young["answer"] is None
    # Five bitcoin at $100,000 over $20,000 a month is 25 months at a price that never moves.
    assert young["runway"]["flat_months"] == 25
    assert young["runway"]["months"] > 25
    assert view(birth_date=None, growth_pct=None, **simple)["runway"] is None
    result = view(monthly_purchase_usd="3000", **simple)
    run = result["runway"]
    assert run["months"] == young["runway"]["months"] and run["points"][0]["months"] == run["months"]
    first = result["answer"]["first"]
    life = next(row for row in run["points"] if row["months"] is None)
    assert life["month"] == first["month"]
    assert [row["months"] for row in run["milestones"]] == [60, 120, 240]
    stops = [row["stop"]["month"] for row in run["milestones"]]
    assert stops == sorted(stops) and stops[-1] <= first["month"]
    less = next(row for row in result["answer"]["levers"] if row["id"] == "less")
    assert less["runway_days"] > 60 and not less["runway_for_life"]
    assert next(row for row in result["answer"]["levers"] if row["id"] == "buy")["runway_days"] == 0


def test_runway_a_year_ago_uses_what_was_true_then(owner):
    checking, _ = ledger(owner)
    # The wallet was opened in January 2026, so there was no stack to measure a year ago.
    assert view(tax_pct="0")["runway"]["before"] is None
    opened = {"name": "Older wallet", "currency": "BITCOIN", "opening_balance": "100000000", "kind": "bitcoin_wallet"}
    post(owner, "/accounts", opened | {"date": "2025-01-01"})
    before = view(tax_pct="0")["runway"]["before"]
    assert before["date"] == "2025-11-24" and before["price_usd"]
    assert view(monthly_spending_usd="3000")["runway"]["before"] is None
    for index in range(2025 * 12 + 10, 2026 * 12 + 10):
        day = f"{index // 12}-{index % 12 + 1:02d}-03"
        transaction(owner, checking, amount="6000.00", date=day, description="Second home")
    changed = view(tax_pct="0", use_record=False)["runway"]
    # One bitcoin at $100,000 against $3,000 a month then; six against $9,000 a month now.
    assert 33 < changed["before"]["months"] < changed["months"]


def test_later_birthday_and_rate_move_the_answer(owner):
    ledger(owner)
    base = {"monthly_spending_usd": "6000"}
    slow, fast = (view(growth_pct=rate, **base)["answer"]["first"]["month"] for rate in ("12", "20"))
    assert slow > fast
    assert view(birth_date="1981-11-24", **base)["answer"]["age_today"] == 45
    assert view(birth_date="1981-11-25", **base)["answer"]["age_today"] == 44


def test_saved_choices_survive_other_settings_and_stay_out_of_the_audit_trail(owner):
    ledger(owner)
    before = owner.get("/api/export/journal").json()
    saved = owner.put(URL, json=settings(growth_pct="12.5", monthly_spending_usd="2750.00"))
    assert saved.status_code == 200, saved.text
    assert owner.get(URL).json()["settings"]["growth_pct"] == "12.5"
    preferences = owner.get("/api/settings").json()["preferences"]
    preferences["theme"] = "light"
    preferences["retirement"] = None
    assert owner.put("/api/settings", json=preferences).status_code == 200
    assert owner.get(URL).json()["settings"]["birth_date"] == "1981-05-10"
    # A draft is worked out but not kept.
    draft = owner.post(URL + "/draft", json={"settings": settings(growth_pct="30"), "trying": ["buy"]})
    assert draft.status_code == 200
    assert owner.get(URL).json()["settings"]["growth_pct"] == "12.5"
    assert owner.get("/api/export/journal").json() == before
    with SessionLocal() as db:
        trail = " ".join(str(event.detail) for event in db.query(AuditEvent))
        assert "1981" not in trail and "2750" not in trail
        assert json.loads(db.query(User).one().preferences)["retirement"]["growth_pct"] == "12.5"


def test_bad_choices_are_refused_and_sign_in_is_required(owner):
    for bad in (
        {"growth_pct": "101"},
        {"growth_pct": "abc"},
        {"tax_pct": "61"},
        {"last_age": 40},
        {"birth_date": "2090-01-01"},
        {"birth_date": "1930-01-01"},
        {"monthly_spending_usd": "-1"},
        {"category_shares": {"1": 400}},
        {"unknown": 1},
    ):
        assert owner.put(URL, json=settings(**bad)).status_code == 422, bad
    token = owner.headers.pop("X-CSRF-Token")
    assert owner.put(URL, json=settings()).status_code == 403
    owner.headers["X-CSRF-Token"] = token
    owner.post("/api/auth/logout")
    assert owner.get(URL).status_code == 401
