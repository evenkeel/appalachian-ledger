from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from conftest import new_account, category


def bill_payload(owner, account, due="2026-01-31", **extra):
    return {
        "transaction": {
            "kind": "expense",
            "account_id": account,
            "category_id": category(owner, "expense"),
            "description": "Internet",
            "notes": "Monthly service",
            "amount": "60.00",
            "date": due,
        },
        "frequency": "monthly",
        "record_now": False,
        **extra,
    }


def create(owner, payload):
    result = owner.post("/api/recurring-bills", json=payload)
    assert result.status_code == 200, result.text
    return result.json()


def pay(owner, bill, amount="60.00", day="2026-02-01"):
    return owner.post(
        f"/api/recurring-bills/{bill['id']}/record",
        json={
            "due_date": bill["next_due"],
            "date": day,
            "amount": amount,
        },
    )


def test_bill_setup_does_not_post_and_payment_uses_actual_amount_and_saved_details(owner):
    account = new_account(owner)
    bill = create(owner, bill_payload(owner, account))
    assert owner.get("/api/transactions").json() == []
    assert pay(owner, bill, "63.17").status_code == 200
    tx = owner.get("/api/transactions").json()[0]
    assert (tx["description"], tx["account_id"], tx["category_id"], tx["notes"], tx["date"]) == (
        "Internet",
        account,
        bill["category_id"],
        "Monthly service",
        "2026-02-01",
    )
    assert Decimal(tx["amount"]) == Decimal("63.17")
    updated = owner.get("/api/recurring-bills").json()[0]
    assert updated["next_due"] == "2026-02-28"
    assert Decimal(updated["amount"]) == Decimal("60")
    assert pay(owner, updated, day="2026-02-28").status_code == 200
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == "2026-03-31"


def test_concurrent_retries_post_one_occurrence_and_stale_schedule_rejected(owner):
    bill = create(owner, bill_payload(owner, new_account(owner)))
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: pay(owner, bill), range(2)))
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()["entry_id"] for response in responses}) == 1
    assert len(owner.get("/api/transactions").json()) == 1
    bad = dict(bill, next_due="2026-02-14")
    assert pay(owner, bad).status_code == 409


def test_create_with_first_payment_is_atomic_and_advances_schedule(owner):
    account = new_account(owner)
    payload = bill_payload(owner, account, record_now=True)
    payload["transaction"]["amount"] = "-1"
    assert owner.post("/api/recurring-bills", json=payload).status_code == 422
    assert owner.get("/api/recurring-bills").json() == []
    assert owner.get("/api/transactions").json() == []
    payload["transaction"]["amount"] = "60"
    bill = create(owner, payload)
    assert bill["next_due"] == "2026-02-28"
    assert len(owner.get("/api/transactions").json()) == 1


def test_archived_accounts_invalid_categories_and_future_payments_do_not_advance(owner):
    account = new_account(owner)
    payload = bill_payload(owner, account)
    payload["transaction"]["category_id"] = category(owner, "income")
    assert owner.post("/api/recurring-bills", json=payload).status_code == 422
    bill = create(owner, bill_payload(owner, account))
    assert pay(owner, bill, day="2099-01-01").status_code == 422
    assert pay(owner, bill, amount="0").status_code == 422
    owner.patch(f"/api/accounts/{account}", json={"name": "Checking", "archived": True})
    assert pay(owner, bill).status_code == 422
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == bill["next_due"]


def test_edit_remove_and_weekly_yearly_anchors(owner):
    account = new_account(owner)
    payload = bill_payload(owner, account, frequency="yearly", due="2024-02-29")
    bill = create(owner, payload)
    assert pay(owner, bill).status_code == 200
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == "2025-02-28"
    payload = bill_payload(owner, account, frequency="weekly", due="2026-01-31")
    response = owner.put(f"/api/recurring-bills/{bill['id']}", json=payload)
    assert response.status_code == 200
    bill = response.json()
    assert pay(owner, bill).status_code == 200
    bill = owner.get("/api/recurring-bills").json()[0]
    assert bill["next_due"] == "2026-02-07"
    assert owner.delete(f"/api/recurring-bills/{bill['id']}").status_code == 200
    assert owner.get("/api/recurring-bills").json() == []
    assert len(owner.get("/api/transactions").json()) == 2


def test_endpoints_require_authentication_and_csrf(client, owner):
    owner.headers.pop("X-CSRF-Token")
    assert owner.post("/api/recurring-bills", json={}).status_code == 403
    owner.cookies.clear()
    assert owner.get("/api/recurring-bills").status_code == 401


def test_edit_cannot_reuse_paid_occurrence_and_future_bill_can_be_scheduled(owner):
    account = new_account(owner)
    bill = create(owner, bill_payload(owner, account))
    assert pay(owner, bill).status_code == 200
    assert owner.put(f"/api/recurring-bills/{bill['id']}", json=bill_payload(owner, account)).status_code == 422
    future = create(owner, bill_payload(owner, account, due="2099-01-31"))
    assert future["next_due"] == "2099-01-31"


def test_bitcoin_bill_requires_whole_native_units(owner):
    account = new_account(owner, currency="BITCOIN", amount="100000", kind="bitcoin_wallet")
    payload = bill_payload(owner, account)
    payload["transaction"]["amount"] = "1.5"
    assert owner.post("/api/recurring-bills", json=payload).status_code == 422
    payload["transaction"]["amount"] = "1500"
    bill = create(owner, payload)
    assert pay(owner, bill, amount="1500").status_code == 200
    tx = owner.get("/api/transactions").json()[0]
    assert tx["currency"] == "BITCOIN" and tx["amount"] == "1500"


def test_bill_category_cannot_be_deleted(owner):
    bill = create(owner, bill_payload(owner, new_account(owner)))
    response = owner.delete(f"/api/categories/{bill['category_id']}")
    assert response.status_code == 409
    assert "recurring bills" in response.json()["detail"]


def test_one_time_expense_is_planned_then_recorded_once_and_removed_from_upcoming(owner):
    account = new_account(owner)
    bill = create(owner, bill_payload(owner, account, frequency="once"))
    assert len(owner.get("/api/recurring-bills").json()) == 1
    assert owner.get("/api/transactions").json() == []
    first = pay(owner, bill)
    retry = pay(owner, bill)
    assert first.status_code == retry.status_code == 200
    assert first.json()["entry_id"] == retry.json()["entry_id"]
    assert retry.json()["already_recorded"] is True
    assert owner.get("/api/recurring-bills").json() == []
    assert len(owner.get("/api/transactions").json()) == 1
    budgets = owner.get("/api/budget-overview?month=2026-02").json()
    expense = next(item for item in budgets if item["category_id"] == bill["category_id"])
    assert Decimal(expense["spent_usd"]) == Decimal("60")


def test_removed_one_time_expense_cannot_be_paid(owner):
    bill = create(owner, bill_payload(owner, new_account(owner), frequency="once"))
    assert owner.delete(f"/api/recurring-bills/{bill['id']}").status_code == 200
    assert pay(owner, bill).status_code == 404
    assert owner.get("/api/transactions").json() == []


def test_account_bills_follow_the_selected_payment_account(owner):
    prime = new_account(owner, "Prime Card", kind="credit_card")
    checking = new_account(owner, "Checking")
    spotify_payload = bill_payload(owner, prime)
    spotify_payload["transaction"]["description"] = "Spotify"
    spotify = create(owner, spotify_payload)
    internet = create(owner, bill_payload(owner, checking))
    assert [b["id"] for b in owner.get(f"/api/recurring-bills?account_id={prime}").json()] == [spotify["id"]]
    assert [b["id"] for b in owner.get(f"/api/recurring-bills?account_id={checking}").json()] == [internet["id"]]
    # Paying this month's bill keeps the next occurrence linked to the same card.
    assert pay(owner, spotify).status_code == 200
    assert owner.get(f"/api/recurring-bills?account_id={prime}").json()[0]["description"] == "Spotify"
    spotify_payload["transaction"]["account_id"] = checking
    spotify_payload["transaction"]["date"] = "2026-02-28"
    assert owner.put(f"/api/recurring-bills/{spotify['id']}", json=spotify_payload).status_code == 200
    assert owner.get(f"/api/recurring-bills?account_id={prime}").json() == []
    assert len(owner.get("/api/recurring-bills").json()) == 2


def test_quarterly_and_semiannual_schedules_preserve_month_end_and_year_boundaries(owner):
    account = new_account(owner)
    for frequency, due, expected in (
        ("quarterly", "2024-11-30", ["2025-02-28", "2025-05-30"]),
        ("quarterly", "2025-08-31", ["2025-11-30", "2026-02-28", "2026-05-31"]),
        ("semiannual", "2023-08-31", ["2024-02-29", "2024-08-31", "2025-02-28"]),
    ):
        bill = create(owner, bill_payload(owner, account, frequency=frequency, due=due))
        for next_due in expected:
            assert pay(owner, bill, day="2026-01-01").status_code == 200
            bill = next(item for item in owner.get("/api/recurring-bills").json() if item["id"] == bill["id"])
            assert bill["next_due"] == next_due
            assert bill["frequency"] == frequency


def test_new_intervals_record_first_payment_and_reject_unknown_frequency(owner):
    account = new_account(owner)
    for frequency, expected in (("quarterly", "2026-04-30"), ("semiannual", "2026-07-31")):
        bill = create(owner, bill_payload(owner, account, frequency=frequency, record_now=True))
        assert bill["next_due"] == expected
    assert len(owner.get("/api/transactions").json()) == 2
    result = owner.post("/api/recurring-bills", json=bill_payload(owner, account, frequency="sometimes"))
    assert result.status_code == 422


def test_editing_details_preserves_original_schedule_anchor_after_short_month(owner):
    account = new_account(owner)
    bill = create(owner, bill_payload(owner, account))
    assert pay(owner, bill).status_code == 200
    payload = bill_payload(owner, account, due="2026-02-28")
    payload["transaction"].update(description="Internet renamed", amount="70")
    updated = owner.put(f"/api/recurring-bills/{bill['id']}", json=payload)
    assert updated.status_code == 200
    assert pay(owner, updated.json(), day="2026-02-28").status_code == 200
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == "2026-03-31"

    # Explicitly moving the next due date establishes a new anchor.
    payload["transaction"]["date"] = "2026-03-15"
    updated = owner.put(f"/api/recurring-bills/{bill['id']}", json=payload)
    assert updated.status_code == 200
    assert pay(owner, updated.json(), day="2026-03-15").status_code == 200
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == "2026-04-15"


def test_match_recorded_expenses_advances_without_posting_or_duplicates(owner):
    account = new_account(owner)
    payload = bill_payload(owner, account)
    payload["transaction"]["description"] = "Internet"
    bill = owner.post("/api/recurring-bills", json=payload).json()
    from conftest import transaction

    entry = transaction(owner, account, amount="60", date=bill["next_due"], description=" INTERNET  ")
    before = owner.get("/api/export/journal").json()
    result = owner.post("/api/recurring-bills/reconcile")
    assert result.status_code == 200, result.text
    assert result.json()["items"] == [{"bill_id": bill["id"], "entry_id": entry["id"], "due_date": bill["next_due"]}]
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == "2026-02-28"
    assert owner.post("/api/recurring-bills/reconcile").json()["matched"] == 0
    assert owner.get("/api/export/journal").json() == before


def test_bill_matching_requires_exact_amount_date_account_name_and_unique_candidates(owner):
    from conftest import transaction

    account = new_account(owner)
    other = new_account(owner, name="Other")
    payload = bill_payload(owner, account)
    bill = owner.post("/api/recurring-bills", json=payload).json()
    for changes in (
        {"amount": "61"},
        {"date": "2026-01-30"},
        {"description": "Different merchant"},
        {"account": other},
    ):
        args = {"amount": "60", "date": bill["next_due"], "description": bill["description"]}
        args.update(changes)
        selected_account = args.pop("account", account)
        transaction(owner, selected_account, **args)
    assert owner.post("/api/recurring-bills/reconcile").json()["matched"] == 0
    for _ in range(2):
        transaction(owner, account, amount="60", date=bill["next_due"], description=bill["description"])
    assert owner.post("/api/recurring-bills/reconcile").json()["matched"] == 0
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == bill["next_due"]


def test_duplicate_bill_schedules_do_not_claim_one_expense(owner):
    from conftest import transaction

    account = new_account(owner)
    first = owner.post("/api/recurring-bills", json=bill_payload(owner, account)).json()
    owner.post("/api/recurring-bills", json=bill_payload(owner, account))
    transaction(owner, account, amount="60", date=first["next_due"], description=first["description"])
    assert owner.post("/api/recurring-bills/reconcile").json()["matched"] == 0


def test_matching_catches_up_paid_months_and_ignores_reversed_payments(owner):
    from conftest import transaction

    account = new_account(owner)
    bill = owner.post("/api/recurring-bills", json=bill_payload(owner, account)).json()
    for day in ("2026-01-31", "2026-02-28", "2026-03-31"):
        entry = transaction(owner, account, amount="60", date=day, description=bill["description"])
    owner.delete(f"/api/transactions/{entry['id']}")
    assert owner.post("/api/recurring-bills/reconcile").json()["matched"] == 2
    assert owner.get("/api/recurring-bills").json()[0]["next_due"] == "2026-03-31"


def test_variable_amount_records_actual_payment_and_keeps_estimate(owner):
    account = new_account(owner)
    bill = owner.post("/api/recurring-bills", json=bill_payload(owner, account)).json()
    result = owner.post(
        f"/api/recurring-bills/{bill['id']}/record",
        json={"due_date": bill["next_due"], "date": bill["next_due"], "amount": "112.37"},
    )
    assert result.status_code == 200, result.text
    assert owner.get("/api/transactions").json()[0]["amount"] == "112.37"
    next_bill = owner.get("/api/recurring-bills").json()[0]
    assert next_bill["amount"] == bill["amount"]
    assert next_bill["next_due"] == "2026-02-28"


def test_bill_matching_requires_csrf_and_authentication(owner):
    del owner.headers["X-CSRF-Token"]
    assert owner.post("/api/recurring-bills/reconcile").status_code == 403
    owner.cookies.clear()
    assert owner.post("/api/recurring-bills/reconcile").status_code == 401


def test_confirming_variable_bill_matches_actual_expense_without_duplication(owner):
    from conftest import transaction

    account = new_account(owner)
    bill = owner.post("/api/recurring-bills", json=bill_payload(owner, account)).json()
    entry = transaction(owner, account, amount="112.37", date=bill["next_due"], description=bill["description"])
    assert owner.post("/api/recurring-bills/reconcile").json()["matched"] == 0
    before = owner.get("/api/export/journal").json()
    result = owner.post(
        f"/api/recurring-bills/{bill['id']}/record",
        json={"due_date": bill["next_due"], "date": bill["next_due"], "amount": "112.37"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["matched_existing"] is True
    assert result.json()["entry_id"] == entry["id"]
    assert owner.get("/api/export/journal").json() == before
    assert owner.get("/api/recurring-bills").json()[0]["amount"] == "60.00"
