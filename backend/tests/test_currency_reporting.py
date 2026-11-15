from conftest import new_account, transaction, post, category


def report(owner, month="2026-01", unit="USD", months=2):
    response = owner.get(f"/api/reports?month={month}&denomination={unit}&months={months}")
    assert response.status_code == 200, response.text
    return response.json()


def test_ownership_is_not_an_exchange_rate_estimate(owner):
    new_account(owner, "House", amount="1000000", kind="real_estate")
    new_account(owner, "Dollar cash", amount="2000")
    new_account(owner, "Bitcoin wallet", "BITCOIN", "2500000", "bitcoin_wallet")
    new_account(owner, "Bitcoin-priced property", "BITCOIN", "80000000", "other_asset")
    post(owner, "/rates", {"day": "2026-01-31", "usd_per_btc": "100000"})
    usd = report(owner)
    assert usd["ownership"] == {
        "equivalents": {
            "bitcoin": {"USD": "2500.00", "BITCOIN": "2500000"},
            "dollars": {"USD": "2000.00", "BITCOIN": "2000000"},
            "valued_asset": {"USD": "1080000.00", "BITCOIN": "1080000000"},
            "debt": {"USD": "0", "BITCOIN": "0"},
        },
        "bitcoin_held": "2500000",
        "usd_held": "2000.00",
        "native_other_assets": {"USD": "1000000.00", "BITCOIN": "80000000"},
        "native_liabilities": {"USD": "0", "BITCOIN": "0"},
        "valued_assets_usd": "1080000.00",
        "liabilities_usd": "0",
        "allocation": {
            "bitcoin_usd": "2500.00",
            "dollars_usd": "2000.00",
            "other_assets_usd": "1080000.00",
            "liabilities_usd": "0",
            "assets_usd": "1084500.00",
            "net_worth_usd": "1084500.00",
            "asset_percentages": {"bitcoin": "0.2", "dollars": "0.2", "valued_asset": "99.6"},
            "status": "ready",
            "bitcoin_dominance": "0.2",
        },
    }
    assert usd["net_worth"] == "1084500.00"
    bitcoin = report(owner, unit="BITCOIN")
    assert bitcoin["ownership"] == usd["ownership"]
    assert bitcoin["net_worth"] == "1084500000"
    post(owner, "/rates", {"day": "2026-01-31", "usd_per_btc": "200000"})
    changed = report(owner, unit="BITCOIN")
    assert changed["ownership"]["bitcoin_held"] == "2500000"
    assert changed["ownership"]["usd_held"] == "2000.00"
    assert changed["net_worth"] != bitcoin["net_worth"]
    assert changed["ownership"]["equivalents"]["bitcoin"] == {"USD": "5000.00", "BITCOIN": "2500000"}
    assert changed["ownership"]["equivalents"]["dollars"] == {"USD": "2000.00", "BITCOIN": "1000000"}


def test_manual_asset_never_becomes_held_bitcoin(owner):
    account = new_account(owner, "Valued holding", "BITCOIN", "1000", "savings")
    post(owner, "/assets", {"account_id": account, "quantity": "1"})
    result = report(owner, unit="BITCOIN")
    assert result["ownership"]["bitcoin_held"] == "0"
    assert result["accounts"][0]["holding_type"] == "valued_asset"


def test_dollar_history_works_without_prices_and_native_flows_are_separate(owner):
    cash = new_account(owner)
    wallet = new_account(owner, "Wallet", "BITCOIN", "50000", "bitcoin_wallet")
    transaction(owner, cash, "expense", "100")
    transaction(owner, wallet, "expense", "5000")
    transaction(owner, cash, "income", "500")
    usd = report(owner)
    assert usd["native_flows"]["USD"]["expenses"] == "100.00"
    assert usd["native_flows"]["BITCOIN"]["expenses"] == "5000"
    assert usd["flows"]["USD"]["savings_rate"] == "80.0"
    assert usd["expenses"] is None  # Never omit missing bitcoin-to-dollar conversions.
    assert usd["history"][-1]["accounts"][0]["value"] == "1400.00"
    assert usd["history"][-1]["flows"]["USD"]["expenses"] == "100.00"


def test_actual_exchange_receipt_not_estimated_purchase(owner):
    cash = new_account(owner)
    wallet = new_account(owner, "Wallet", "BITCOIN", "0", "bitcoin_wallet")
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    tx = transaction(owner, cash, "transfer", "100", destination_id=wallet, destination_amount="95000")
    assert tx["bitcoin"] == "100000"
    assert tx["destination_amount"] == "95000"
    assert tx["destination_currency"] == "BITCOIN"
    result = report(owner)
    assert result["ownership"]["bitcoin_held"] == "95000"
    assert result["expenses"] == "0"


def test_currency_budgets_do_not_mix_actual_spending(owner):
    cash = new_account(owner)
    wallet = new_account(owner, "Wallet", "BITCOIN", "100000", "bitcoin_wallet")
    cat = category(owner, "expense")
    transaction(owner, cash, amount="50", category_id=cat)
    transaction(owner, wallet, amount="20000", category_id=cat)
    for currency, amount in [("USD", "100"), ("BITCOIN", "80000")]:
        post(owner, "/budgets", {"month": "2026-01", "category_id": cat, "currency": currency, "amount": amount})
    rows = {b["currency"]: b for b in owner.get("/api/budgets?month=2026-01").json()}
    assert (rows["USD"]["actual"], rows["USD"]["remaining"]) == ("50.00", "50.00")
    assert (rows["BITCOIN"]["actual"], rows["BITCOIN"]["percent"]) == ("20000", "25.0")
    assert rows["USD"]["scope"] == "native"
    assert (
        owner.post(
            "/api/budgets", json={"month": "2026-01", "category_id": cat, "amount": "1.001", "currency": "USD"}
        ).status_code
        == 422
    )


def test_investment_change_excludes_contributions_and_includes_fx(owner):
    cash = new_account(owner, amount="1000")
    investment = new_account(owner, "Portfolio", amount="1000", kind="brokerage")
    post(owner, "/rates", {"day": "2026-01-31", "usd_per_btc": "100000"})
    post(owner, "/rates", {"day": "2026-02-05", "usd_per_btc": "100000"})
    post(owner, "/rates", {"day": "2026-02-28", "usd_per_btc": "200000"})
    transaction(owner, cash, "transfer", "200", destination_id=investment, date="2026-02-05")
    asset = post(owner, "/assets", {"account_id": investment, "quantity": "1"})
    post(owner, f"/assets/{asset['id']}/valuations", {"date": "2026-02-28", "value": "1300"})
    usd = report(owner, "2026-02")
    perf = next(p for p in usd["performance"] if p["account_id"] == investment)
    assert (perf["start_value"], perf["end_value"], perf["net_additions"], perf["value_change"]) == (
        "1000.00",
        "1300.00",
        "200.00",
        "100.00",
    )
    bitcoin = report(owner, "2026-02", "BITCOIN")
    perf = next(p for p in bitcoin["performance"] if p["account_id"] == investment)
    assert (perf["start_value"], perf["end_value"], perf["net_additions"], perf["value_change"]) == (
        "1000000",
        "650000",
        "200000",
        "-550000",
    )
    assert usd["income"] == bitcoin["income"] == "0"


def test_missing_contribution_price_marks_performance_unavailable(owner):
    cash = new_account(owner)
    investment = new_account(owner, "Portfolio", amount="1000", kind="brokerage")
    for day in ["2026-01-31", "2026-02-28"]:
        post(owner, "/rates", {"day": day, "usd_per_btc": "100000"})
    transaction(owner, cash, "transfer", "200", destination_id=investment, date="2026-02-05")
    perf = next(p for p in report(owner, "2026-02", "BITCOIN")["performance"] if p["account_id"] == investment)
    assert perf["end_value"] == "1200000"
    assert perf["net_additions"] is None and perf["value_change"] is None


def test_reversed_contributions_are_removed_from_performance(owner):
    cash = new_account(owner)
    investment = new_account(owner, "Portfolio", amount="1000", kind="brokerage")
    tx = transaction(owner, cash, "transfer", "200", destination_id=investment, date="2026-02-05")
    assert owner.delete(f"/api/transactions/{tx['id']}").status_code == 200
    perf = next(p for p in report(owner, "2026-02")["performance"] if p["account_id"] == investment)
    assert perf["net_additions"] == "0" and perf["value_change"] == "0.00"


def test_migration_preserves_legacy_budget_semantics(tmp_path):
    import os
    import sqlite3
    import subprocess
    import sys
    from conftest import ROOT

    path = tmp_path / "legacy.db"
    env = dict(os.environ, DATABASE_URL="sqlite:///" + str(path), PYTHONPATH=str(ROOT / "backend"))
    command = [sys.executable, "-m", "alembic", "-c", str(ROOT / "database/alembic.ini"), "upgrade"]
    subprocess.run(command + ["0002"], env=env, check=True, capture_output=True)
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO categories(id,name,kind) VALUES(1,'Food','expense')")
        db.execute("INSERT INTO budgets(id,month,category_id,bitcoin) VALUES(1,'2026-01',1,200000)")
        db.execute(
            "INSERT INTO exchange_rates(id,day,usd_per_btc,source,fetched_at) VALUES(1,'2026-01-05','123456.789','Fictional demo rate','2026-01-05T00:00:00+00:00')"
        )
    subprocess.run(command + ["head"], env=env, check=True, capture_output=True)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT amount_minor,currency,scope FROM budgets").fetchone() == (200000, "BITCOIN", "all")
        assert db.execute(
            "SELECT day,usd_per_btc,source,fetched_at,observed_at,method FROM exchange_rates WHERE id=1"
        ).fetchone() == ("2026-01-05", "123456.789", "Fictional demo rate", "2026-01-05T00:00:00+00:00", None, "legacy")
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    subprocess.run(command[:-1] + ["check"], env=env, check=True, capture_output=True)


def test_encrypted_restore_preserves_both_budget_currencies(owner):
    cat = category(owner, "expense")
    for currency, amount in [("USD", "123.45"), ("BITCOIN", "12345")]:
        post(owner, "/budgets", {"month": "2026-01", "category_id": cat, "currency": currency, "amount": amount})
    from app.backup import snapshot, restore
    from app.db import SessionLocal

    passphrase = "local-test-backup-only"
    before = owner.get("/api/budgets?month=2026-01").json()
    with SessionLocal() as db:
        encrypted = snapshot(db, passphrase)
    post(owner, "/budgets", {"month": "2026-01", "category_id": cat, "currency": "USD", "amount": "999"})
    with SessionLocal() as db:
        restore(db, encrypted, passphrase)
    from app.reports import budgets_report

    with SessionLocal() as db:
        assert budgets_report(db, "2026-01") == before


def test_long_term_reports_keep_native_values_without_prices(owner):
    new_account(owner)
    result = report(owner, months=120)
    assert len(result["history"]) == 120
    assert result["history"][-1]["net_worth"] == "1000.00"
    assert owner.get("/api/reports?months=121").status_code == 422


def test_export_names_estimates_and_preserves_actual_exchange(owner):
    import csv
    import io

    cash = new_account(owner)
    wallet = new_account(owner, "Wallet", "BITCOIN", "0", "bitcoin_wallet")
    post(owner, "/rates", {"day": "2026-01-05", "usd_per_btc": "100000"})
    transaction(owner, cash, "transfer", "100", destination_id=wallet, destination_amount="95000")
    row = next(csv.DictReader(io.StringIO(owner.get("/api/export/csv").text)))
    assert row["amount"] == "100.00" and row["currency"] == "USD"
    assert row["historical_bitcoin_equivalent"] == "100000"
    assert row["destination_amount"] == "95000" and row["destination_currency"] == "BITCOIN"


def test_new_demo_includes_native_activity_and_budgets_in_both_currencies(owner):
    from datetime import date

    assert owner.post("/api/demo").status_code == 200
    month = date.today().strftime("%Y-%m")
    # A complete preceding month always contains both currencies, including early-month runs.
    result = report(owner, month, months=6)
    complete = result["history"][-2]
    assert complete["native_flows"]["BITCOIN"]["income"] == "100000"
    assert complete["native_flows"]["BITCOIN"]["expenses"] == "18000"
    budgets = owner.get(f"/api/budgets?month={month}").json()
    assert {b["currency"] for b in budgets} == {"USD", "BITCOIN"}
    assert all(b["scope"] == "native" for b in budgets)


def test_overview_totals_keep_original_asset_and_debt_currencies_without_prices(owner):
    new_account(owner, "Home", amount="1000000.01", kind="real_estate")
    new_account(owner, "Bitcoin-priced asset", "BITCOIN", "9000000000000001", "other_asset")
    new_account(owner, "Mortgage", amount="250000.99", kind="mortgage")
    new_account(owner, "Bitcoin debt", "BITCOIN", "1234567", "loan")
    for unit in ("USD", "BITCOIN"):
        own = report(owner, unit=unit)["ownership"]
        assert own["native_other_assets"] == {"USD": "1000000.01", "BITCOIN": "9000000000000001"}
        assert own["native_liabilities"] == {"USD": "250000.99", "BITCOIN": "1234567"}
        assert own["bitcoin_held"] == own["usd_held"] == "0"
        assert own["equivalents"]["valued_asset"] == {"USD": None, "BITCOIN": None}
        assert own["equivalents"]["debt"] == {"USD": None, "BITCOIN": None}


def test_same_dollar_expense_costs_less_bitcoin_when_recorded_rate_rises(owner):
    cash = new_account(owner)
    for day, price in [("2026-01-05", "100000"), ("2026-02-05", "200000")]:
        post(owner, "/rates", {"day": day, "usd_per_btc": price})
        transaction(owner, cash, amount="100", date=day)
    usd = report(owner, month="2026-02", unit="USD")
    bitcoin = report(owner, month="2026-02", unit="BITCOIN")
    assert [h["expenses"] for h in usd["history"]] == ["100.00", "100.00"]
    assert [h["expenses"] for h in bitcoin["history"]] == ["100000", "50000"]
