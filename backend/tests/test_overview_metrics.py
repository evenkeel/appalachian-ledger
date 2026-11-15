from decimal import Decimal
from sqlalchemy import select
from app.db import SessionLocal
from app.models import User
from app.overview_metrics import debt_gauge
from conftest import new_account, post, transaction


def test_daily_dominance_uses_exact_date_balances_and_rates(owner):
    new_account(owner, "Wallet", "BITCOIN", "100000000", "bitcoin_wallet")
    cash = new_account(owner, "Cash", amount="100000")
    post(owner, "/rates", {"day": "2026-01-25", "usd_per_btc": "100000"})
    post(owner, "/rates", {"day": "2026-01-27", "usd_per_btc": "200000"})
    transaction(owner, cash, kind="expense", amount="50000", date="2026-01-27")
    response = owner.get("/api/dominance?month=2026-01&period=1w")
    assert response.status_code == 200
    result = response.json()
    assert result["resolution"] == "daily" and len(result["points"]) == 7
    points = {point["date"]: point["bitcoin_dominance"] for point in result["points"]}
    assert points["2026-01-25"] == "50.0"
    assert points["2026-01-26"] is None
    assert points["2026-01-27"] == "80.0"
    month = owner.get("/api/dominance?month=2026-01&period=1m").json()
    assert month["start"] == "2026-01-01" and len(month["points"]) == 31


def test_max_covers_ledger_lifetime_and_all_periods_end_on_report_date(owner):
    post(
        owner,
        "/accounts",
        {"name": "Old savings", "kind": "savings", "currency": "USD", "opening_balance": "100", "date": "2010-01-01"},
    )
    result = owner.get("/api/dominance?month=2026-01&period=max").json()
    assert result["start"] == "2010-01-01" and len(result["points"]) > 190
    for period in ("1w", "1m", "6m", "1y", "5y", "max"):
        response = owner.get(f"/api/dominance?month=2026-01&period={period}")
        assert response.status_code == 200
        assert response.json()["points"][-1] == {"date": "2026-01-31", "bitcoin_dominance": "0.0"}
    assert owner.get("/api/dominance?period=bogus").status_code == 422


def test_empty_history_and_missing_conversion_are_explicit(owner):
    assert owner.get("/api/dominance?month=2026-01&period=max").json()["points"] == []
    new_account(owner, "Wallet", "BITCOIN", "100000000", "bitcoin_wallet")
    result = owner.get("/api/dominance?month=2026-01&period=1w").json()
    assert all(point["bitcoin_dominance"] is None for point in result["points"])


def test_debt_thresholds_validate_order_and_preserve_other_preferences(owner):
    for payload in (
        {"low": "100", "medium": "50", "high": "1000"},
        {"low": "0", "medium": "0", "high": "100"},
        {"low": "-1", "medium": "100", "high": "1000"},
        {"low": "0.001", "medium": "100", "high": "1000"},
    ):
        assert owner.put("/api/debt-limits", json=payload).status_code == 422
    assert owner.put("/api/debt-limits", json={"low": "0", "medium": "500", "high": "1000"}).status_code == 200
    assert owner.put("/api/settings", json={"theme": "light"}).status_code == 200
    prefs = owner.get("/api/settings").json()["preferences"]
    assert prefs["debt_limits"] == {"low": "0.00", "medium": "500.00", "high": "1000.00"}
    assert prefs["theme"] == "light"
    assert owner.put("/api/settings", json={"theme": "dark", "debt_limits": None}).status_code == 200
    assert owner.get("/api/settings").json()["preferences"]["debt_limits"] == prefs["debt_limits"]


def test_credit_spending_raises_gauge_repayment_lowers_it_and_cash_spending_does_not(owner):
    cash = new_account(owner, "Cash", amount="5000")
    card = new_account(owner, "Credit", amount="100", kind="credit_card")
    assert owner.put("/api/debt-limits", json={"low": "200", "medium": "500", "high": "1000"}).status_code == 200

    def gauge():
        return owner.get("/api/reports?month=2026-01").json()["debt_gauge"]

    assert gauge()["level"] == "low"
    transaction(owner, card, kind="expense", amount="600")
    assert gauge()["level"] == "high" and Decimal(gauge()["debt_usd"]) == Decimal("700")
    transaction(owner, card, kind="expense", amount="400")
    assert gauge()["level"] == "dangerous"
    transaction(owner, cash, kind="transfer", amount="1000", destination_id=card)
    assert gauge()["level"] == "low"
    before = gauge()
    transaction(owner, cash, kind="expense", amount="100")
    assert gauge() == before


def test_debt_band_boundaries_missing_prices_and_unconfigured_state(owner):
    with SessionLocal() as db:
        assert debt_gauge(db, "0")["level"] is None
        user = db.scalar(select(User))
        user.preferences = '{"debt_limits":{"low":"0","medium":"500","high":"1000"}}'
        db.flush()
        assert debt_gauge(db, None)["level"] is None
        assert debt_gauge(db, "0")["level"] == "low"
        assert debt_gauge(db, "500")["level"] == "medium"
        assert debt_gauge(db, "1000")["level"] == "high"
        assert debt_gauge(db, "1000.01")["level"] == "dangerous"
        assert debt_gauge(db, "100000000")["position"] == "100.0"


def test_consumer_debt_gauge_excludes_mortgages(owner):
    new_account(owner, "Mortgage", amount="200000", kind="mortgage")
    new_account(owner, "Credit card", amount="300", kind="credit_card")
    new_account(owner, "Personal loan", amount="500", kind="loan")
    report = owner.get("/api/reports?month=2026-01").json()
    assert Decimal(report["debt_gauge"]["debt_usd"]) == Decimal("800")
    assert Decimal(report["dual"]["USD"]["liabilities"]) == Decimal("200800")
