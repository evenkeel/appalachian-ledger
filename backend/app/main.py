import csv
import io
import json
import os
from contextlib import asynccontextmanager
from datetime import date
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from . import accounting as ledger
from . import schemas as s
from .auth import authenticate, COOKIE, DUMMY_HASH, hasher, start_session, throttle, verify
from .db import get_db, SessionLocal, write_lock
from .models import (
    Account,
    RecurringBill,
    Asset,
    AssetPrice,
    AuditEvent,
    Budget,
    Category,
    ExchangeRate,
    JournalEntry,
    LoginAttempt,
    Session,
    User,
    WalletConnection,
    now,
)
from .money import original, to_minor
from .reports import (
    add_nullable,
    accounts_report,
    budgets_report,
    budget_overview,
    dashboard,
    month_days,
    month_sequence,
)
from .imports import import_csv
from .prices import fetch_daily, provider_for, utcnow
from .price_sync import PriceWorker, price_status, queue_history, sync_state
from . import conversions, insights, investments, recurring, costs
from .node import BitcoinCore
from .backup import snapshot, restore, MAX_BYTES
from .demo import seed_demo
from .tracking import tracking_report
from .overview_metrics import debt_gauge, dominance_history
from .account_activity import account_activity
from .startup import ensure_schema
from .planning import router as planning_router
from .spending_history import router as spending_history_router
from .dashboard import router as dashboard_router
from .alerts import router as alerts_router
from .market import router as market_router
from .market_stream import end_streams_when_stopping, router as market_stream_router


@asynccontextmanager
async def lifespan(app):
    ensure_schema()
    with write_lock, SessionLocal() as db:
        costs.capture(db)
        db.commit()
    worker = PriceWorker()
    worker.start()
    end_streams_when_stopping()
    yield
    worker.close()


app = FastAPI(
    lifespan=lifespan, title="Appalachian Bitcoin", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None
)
app.include_router(planning_router)
app.include_router(insights.router)
app.include_router(spending_history_router)
app.include_router(dashboard_router)
app.include_router(alerts_router)
app.include_router(market_router)
app.include_router(market_stream_router)

allowed_hosts = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)


@app.middleware("http")
async def security(request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        configured = os.getenv("APP_ORIGIN", "http://localhost:8080").split(",")
        if origin and origin not in configured:
            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > MAX_BYTES + 65536):
        return JSONResponse({"detail": "Request is too large"}, status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ValueError)
async def invalid_input(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    return JSONResponse(
        {"detail": "This record conflicts with existing data or violates an accounting constraint."}, status_code=409
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/auth/status")
def auth_status(db=Depends(get_db, scope="function")):
    return {
        "initialized": db.scalar(select(User.id).limit(1)) is not None,
        "demo_enabled": os.getenv("DEMO_ENABLED", "false").lower() == "true",
    }


@app.post("/api/auth/setup")
def setup(data: s.Credentials, request: Request, response: Response, db=Depends(get_db, scope="function")):
    if db.scalar(select(User.id).limit(1)):
        raise HTTPException(409, "A local owner already exists")
    if len(data.password) < 12:
        raise ValueError("Choose a password of at least 12 characters")
    user = User(username=data.username, password_hash=hasher.hash(data.password))
    db.add(user)
    db.flush()
    for name, kind in [
        ("Salary", "income"),
        ("Freelance", "income"),
        ("Other income", "income"),
        ("Groceries", "expense"),
        ("Housing", "expense"),
        ("Utilities", "expense"),
        ("Transport", "expense"),
        ("Dining", "expense"),
        ("Health", "expense"),
        ("Shopping", "expense"),
        ("Other expense", "expense"),
    ]:
        db.add(Category(name=name, kind=kind))
    ledger.audit(db, "auth.setup", user.id, {})
    return start_session(db, user, response)


@app.post("/api/auth/login")
def login(data: s.Credentials, request: Request, response: Response, db=Depends(get_db, scope="function")):
    throttle(db, request)
    user = db.scalar(select(User).where(User.username == data.username))
    valid = verify(data.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, "Invalid username or password")
    # Only failed attempts count toward the throttle.
    client = request.client.host if request.client else "local"
    db.execute(delete(LoginAttempt).where(LoginAttempt.client == client))
    ledger.audit(db, "auth.login", user.id, {})
    return start_session(db, user, response)


@app.get("/api/auth/me")
def me(request: Request, user=Depends(authenticate)):
    return {
        "username": user.username,
        "csrf": request.state.session.csrf,
        "preferences": json.loads(user.preferences),
        "demo": user.demo,
    }


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    db.delete(request.state.session)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.post("/api/auth/password")
def change_password(
    data: s.PasswordInput, response: Response, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    if not verify(data.current_password, user.password_hash):
        raise HTTPException(403, "Current password is incorrect")
    user.password_hash = hasher.hash(data.new_password)
    db.execute(delete(Session))
    ledger.audit(db, "auth.password_changed", user.id, {})
    return start_session(db, user, response)


@app.get("/api/accounts")
def accounts(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return accounts_report(db)


@app.get("/api/accounts/{id}/activity")
def read_account_activity(id: int, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return account_activity(db, id)


@app.put("/api/accounts/{id}/holdings")
def save_holdings(id: int, data: s.PortfolioInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return investments.save_portfolio(db, id, data)


@app.post("/api/investments/refresh")
def refresh_investments(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return investments.refresh_portfolios(db)


@app.post("/api/accounts")
def add_account(data: s.AccountInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    obj = ledger.create_account(db, data)
    return {"id": obj.id}


@app.patch("/api/accounts/{id}")
def update_account(id: int, data: s.AccountUpdate, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    obj = ledger.account(db, id, active=False)
    if data.name.startswith("__") or not data.name.strip():
        raise ValueError("Invalid account name")
    if data.exclude_from_consumer_debt and obj.role != "liability":
        raise ValueError("Only debt accounts can be excluded from consumer debt")
    if data.exclude_from_liquid_usd and (obj.kind != "checking" or obj.currency != "USD" or obj.role != "asset"):
        raise ValueError("Only USD checking accounts can be excluded from Everyday Cash")
    before = {
        "name": obj.name,
        "archived": obj.archived,
        "exclude_from_consumer_debt": obj.exclude_from_consumer_debt,
        "exclude_from_liquid_usd": obj.exclude_from_liquid_usd,
    }
    excluded = (
        obj.exclude_from_consumer_debt if data.exclude_from_consumer_debt is None else data.exclude_from_consumer_debt
    )
    liquid_excluded = (
        obj.exclude_from_liquid_usd if data.exclude_from_liquid_usd is None else data.exclude_from_liquid_usd
    )
    after = {
        "name": data.name.strip(),
        "archived": data.archived,
        "exclude_from_consumer_debt": excluded,
        "exclude_from_liquid_usd": liquid_excluded,
    }
    ledger.audit(db, "account.update", id, {"before": before, "after": after})
    obj.name, obj.archived = data.name.strip(), data.archived
    obj.exclude_from_consumer_debt = excluded
    obj.exclude_from_liquid_usd = liquid_excluded
    return {"ok": True}


@app.post("/api/accounts/{id}/adjustments")
def adjust_account(id: int, data: s.AdjustmentInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    acc = ledger.account(db, id)
    amount = to_minor(data.amount, acc.currency)
    if not amount:
        raise ValueError("Adjustment cannot be zero")
    return {"id": ledger.adjustment(db, acc, amount, data.date, data.description).id}


@app.get("/api/categories")
def categories(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return [
        {"id": c.id, "name": c.name, "kind": c.kind, "spending_type": c.spending_type}
        for c in db.scalars(select(Category).order_by(Category.kind, Category.name))
    ]


@app.post("/api/categories")
def add_category(data: s.CategoryInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    obj = Category(**data.model_dump())
    db.add(obj)
    db.flush()
    ledger.audit(db, "category.create", obj.id, data.model_dump())
    return {"id": obj.id}


@app.put("/api/categories/{id}/spending-type")
def classify_category(
    id: int, data: s.SpendingTypeInput, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    obj = db.get(Category, id)
    if obj is None:
        raise HTTPException(404, "Category not found")
    if obj.kind != "expense":
        raise HTTPException(400, "Only expense categories have a spending type.")
    obj.spending_type = data.spending_type
    ledger.audit(db, "category.classify", id, data.model_dump())
    return {"ok": True}


@app.delete("/api/categories/{id}")
def delete_category(id: int, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    obj = db.get(Category, id)
    if obj is None:
        raise HTTPException(404, "Category not found")
    if db.scalar(select(JournalEntry.id).where(JournalEntry.category_id == id).limit(1)) is not None:
        raise HTTPException(409, "This category is used by transactions and cannot be deleted.")
    if db.scalar(select(Budget.id).where(Budget.category_id == id).limit(1)) is not None:
        raise HTTPException(409, "This category is used by budgets. Remove those budgets before deleting it.")
    if db.scalar(select(RecurringBill.id).where(RecurringBill.category_id == id).limit(1)) is not None:
        raise HTTPException(409, "This category is used by saved recurring bills and cannot be deleted.")
    # A default payment method for a category that no longer exists would block later saves.
    prefs = json.loads(user.preferences)
    removed = prefs.get("category_payment_defaults", {}).pop(str(id), None) is not None
    rules = [rule for rule in prefs.get("payee_rules", []) if rule["category_id"] != id]
    if removed or len(rules) != len(prefs.get("payee_rules", [])):
        prefs["payee_rules"] = rules
        user.preferences = json.dumps(prefs)
    ledger.audit(db, "category.delete", id, {"name": obj.name, "kind": obj.kind})
    db.delete(obj)
    return {"ok": True}


@app.get("/api/transactions")
def transactions(
    q: str = "",
    kind: str = "",
    account_id: int | None = None,
    start: date | None = None,
    end: date | None = None,
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    rows = ledger.active_transactions(db, start, end)
    reviewed = insights.reviewed_ids(db)
    return [
        ledger.transaction_dict(db, e, reporting=True) | {"review_reasons": insights.review_reasons(db, e, reviewed)}
        for e in rows
        if (not q or q.casefold() in (e.description + " " + e.notes).casefold())
        and (not kind or e.kind == kind)
        and (not account_id or account_id in (e.account_id, e.destination_id))
    ]


@app.post("/api/transactions")
def add_transaction(data: s.TransactionInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return ledger.transaction_dict(db, ledger.create_transaction(db, data))


@app.put("/api/transactions/{id}")
def edit_transaction(
    id: int, data: s.TransactionInput, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    affected = ledger.reverse(db, id, validate_cash=False)
    row = ledger.create_transaction(db, data, replaces_id=id)
    ledger.validate_portfolio_cash(db, affected)
    ledger.audit(db, "transaction.replace", id, {"replacement": row.id})
    return ledger.transaction_dict(db, row)


@app.delete("/api/transactions/{id}")
def delete_transaction(id: int, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    ledger.reverse(db, id)
    return {"ok": True}


@app.get("/api/reports")
def reports(
    month: str | None = None,
    months: int = Query(6, ge=1, le=120),
    denomination: str = "BITCOIN",
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    if denomination not in ("BITCOIN", "BTC", "USD"):
        raise ValueError("Unsupported denomination")
    month = month or date.today().strftime("%Y-%m")
    month_days(month)
    if month > date.today().strftime("%Y-%m"):
        raise ValueError("Choose the current month or an earlier month")
    result = dashboard(db, month, months, denomination)
    consumer_debt = add_nullable(
        account["usd"]
        for account in result["accounts"]
        if account["role"] == "liability"
        and account["kind"] != "mortgage"
        and not account["exclude_from_consumer_debt"]
    )
    result["debt_gauge"] = debt_gauge(db, consumer_debt)
    # Upcoming bills only exist for the present, so past months carry no reading.
    result["safe_to_spend"] = insights.safe_to_spend(db) if month == date.today().strftime("%Y-%m") else None
    return result


@app.get("/api/dominance")
def dominance(
    month: str | None = None,
    period: str = Query("6m", pattern="^(1w|1m|6m|1y|5y|max)$"),
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    month = month or date.today().strftime("%Y-%m")
    start, _ = month_days(month)
    if start.year < 1970 or start > date.today():
        raise ValueError("Choose the current month or an earlier month")
    return dominance_history(db, month, period)


@app.put("/api/debt-limits")
def save_debt_limits(data: s.DebtLimits, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    prefs = json.loads(user.preferences)
    prefs["debt_limits"] = data.model_dump()
    user.preferences = json.dumps(prefs)
    ledger.audit(db, "debt_limits.save", user.id, data.model_dump())
    return {"ok": True}


@app.get("/api/budgets")
def budgets(month: str, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    month_days(month)
    return budgets_report(db, month)


@app.get("/api/tracking")
def tracking(
    month: str,
    months: int = Query(6, ge=1, le=24),
    account_id: int | None = None,
    category_id: int | None = None,
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    return tracking_report(db, month, months, account_id, category_id)


@app.post("/api/budgets/copy-previous")
def copy_budgets(data: s.BudgetCopyInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    start, _ = month_days(data.month)
    if start == date(1970, 1, 1):
        raise ValueError("No previous month available")
    previous = month_sequence(start, 2)[0]
    existing = set(db.scalars(select(Budget.category_id).where(Budget.month == data.month, Budget.currency == "USD")))
    copied = 0
    for budget in db.scalars(select(Budget).where(Budget.month == previous, Budget.currency == "USD")):
        if budget.category_id in existing:
            continue
        db.add(
            Budget(
                month=data.month,
                category_id=budget.category_id,
                amount_minor=budget.amount_minor,
                currency="USD",
                scope=budget.scope,
            )
        )
        copied += 1
    ledger.audit(db, "budget.copy_previous", data.month, {"from": previous, "copied": copied})
    return {"copied": copied, "from": previous}


@app.get("/api/budget-overview")
def category_budgets(month: str, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    month_days(month)
    return budget_overview(db, month)


@app.post("/api/budgets")
def add_budget(data: s.BudgetInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    month_days(data.month)
    cat = db.get(Category, data.category_id)
    if not cat or cat.kind != "expense":
        raise ValueError("Budget category must be an expense")
    if (data.amount is None) == (data.bitcoin is None):
        raise ValueError("Provide exactly one budget amount")
    if data.bitcoin is not None and {"currency", "scope"} & data.model_fields_set:
        raise ValueError("Use amount with currency and scope; bitcoin is a legacy field")
    currency = "BITCOIN" if data.bitcoin is not None else data.currency
    scope = "all" if data.bitcoin is not None else data.scope
    value = to_minor(data.bitcoin if data.bitcoin is not None else data.amount, currency)
    if value <= 0:
        raise ValueError("Budget must be positive")
    obj = db.scalar(
        select(Budget).where(
            Budget.month == data.month, Budget.category_id == data.category_id, Budget.currency == currency
        )
    )
    if obj:
        obj.amount_minor = value
        obj.scope = scope
    else:
        obj = Budget(month=data.month, category_id=data.category_id, amount_minor=value, currency=currency, scope=scope)
        db.add(obj)
    db.flush()
    ledger.audit(db, "budget.save", obj.id, data.model_dump())
    return {"id": obj.id}


@app.delete("/api/budgets/{id}")
def delete_budget(id: int, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    obj = db.get(Budget, id)
    if not obj:
        raise HTTPException(404, "Budget not found")
    ledger.audit(
        db,
        "budget.delete",
        id,
        {"month": obj.month, "amount_minor": str(obj.amount_minor), "currency": obj.currency, "scope": obj.scope},
    )
    db.delete(obj)
    return {"ok": True}


@app.get("/api/assets")
def assets(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    result = []
    accounts = {a["id"]: a for a in accounts_report(db)}
    for a in db.scalars(select(Asset)):
        history = [
            {"date": p.date, "value": original(p.value_minor, accounts[a.account_id]["currency"])}
            for p in db.scalars(select(AssetPrice).where(AssetPrice.asset_id == a.id).order_by(AssetPrice.date))
        ]
        result.append(
            {
                "id": a.id,
                "account_id": a.account_id,
                "name": accounts[a.account_id]["name"],
                "kind": a.kind,
                "quantity": a.quantity,
                "history": history,
                **{"account": accounts[a.account_id]},
            }
        )
    return result


@app.post("/api/assets")
def add_asset(data: s.AssetInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    acc = ledger.account(db, data.account_id)
    obj = Asset(account_id=acc.id, name=acc.name, kind=acc.kind, quantity=data.quantity)
    db.add(obj)
    db.flush()
    ledger.audit(db, "asset.create", obj.id, data.model_dump())
    return {"id": obj.id}


@app.post("/api/assets/{id}/valuations")
def asset_valuation(id: int, data: s.ValuationInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    obj = db.get(Asset, id)
    if not obj:
        raise HTTPException(404, "Asset not found")
    acc = ledger.account(db, obj.account_id)
    if investments.portfolio_report(db, acc.id):
        raise ValueError("This account is valued from shares. Edit holdings and cash in Accounts.")
    # Require chronological valuations so later recorded absolute values retain their meaning.
    last = db.scalar(select(AssetPrice).where(AssetPrice.asset_id == id).order_by(AssetPrice.date.desc()))
    if last and str(data.date) <= last.date:
        raise ValueError("Add valuations after the most recent valuation date")
    value = to_minor(data.value, acc.currency)
    if value < 0 or data.date > date.today():
        raise ValueError("Valuation must be nonnegative and dated today or earlier")
    raw = ledger.balance(db, acc.id, data.date)
    previous = -raw if acc.role == "liability" else raw
    entry = ledger.adjustment(db, acc, value - previous, data.date, "Manual asset valuation", "valuation")
    db.add(AssetPrice(asset_id=id, date=str(data.date), value_minor=value, entry_id=entry.id))
    return {"id": entry.id}


@app.get("/api/rates")
def rates(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return [
        {
            "id": r.id,
            "day": r.day,
            "usd_per_btc": r.usd_per_btc,
            "source": r.source,
            "fetched_at": r.fetched_at,
            "observed_at": r.observed_at,
            "method": r.method,
        }
        for r in db.scalars(select(ExchangeRate).order_by(ExchangeRate.day.desc(), ExchangeRate.id.desc()).limit(400))
    ]


@app.post("/api/rates")
def add_rate(data: s.RateInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    if data.day > date.today():
        raise ValueError("Cannot record future prices")
    row = ExchangeRate(day=str(data.day), usd_per_btc=data.usd_per_btc, source="Manual", method="manual")
    db.add(row)
    db.flush()
    costs.capture(db, data.day)
    ledger.audit(db, "rate.add", row.id, data.model_dump(mode="json"))
    return {"id": row.id}


@app.post("/api/rates/fetch")
def fetch_rate(day: date, refresh: bool = False, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    provider = provider_for(json.loads(user.preferences).get("rate_source", "manual"))
    row = fetch_daily(db, day, provider=provider, refresh=refresh)
    ledger.audit(db, "rate.fetch", row.id, {"source": row.source, "day": row.day})
    return {"id": row.id, "usd_per_btc": row.usd_per_btc, "day": row.day, "source": row.source}


@app.get("/api/prices/status")
def prices_status(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return price_status(db)


@app.post("/api/prices/refresh")
def refresh_price(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    source = json.loads(user.preferences).get("rate_source", "manual")
    provider_for(source)
    sync_state(db, source).quote_requested = True
    ledger.audit(db, "prices.quote_queued", source, {})
    return {"queued": True}


@app.post("/api/prices/history")
def sync_history(data: s.HistorySyncInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    source = json.loads(user.preferences).get("rate_source", "manual")
    provider_for(source)
    if data.start and (data.start < date(2009, 1, 1) or data.start >= utcnow().date()):
        raise ValueError("Choose a date from 2009 through yesterday (UTC)")
    queue_history(db, source, data.start)
    return {"queued": True}


@app.get("/api/prices/conversions")
def missing_conversions(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return conversions.preview(db)


@app.post("/api/prices/conversions")
def complete_conversions(data: s.ConversionInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return conversions.apply(db, data.items)


@app.get("/api/settings")
def settings(user=Depends(authenticate)):
    return {
        "preferences": s.Preferences(**json.loads(user.preferences)).model_dump(),
        "node_configured": bool(os.getenv("BITCOIN_RPC_HOST")),
        "demo": user.demo,
    }


@app.put("/api/settings")
def save_settings(data: s.Preferences, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    old_preferences = json.loads(user.preferences)
    old_source = old_preferences.get("rate_source", "manual")
    if old_source != "manual" and (
        old_source != data.rate_source or (old_preferences.get("automatic_prices") and not data.automatic_prices)
    ):
        state = sync_state(db, old_source)
        state.status, state.quote_requested = "idle", False
        state.generation += 1
    prefs = data.model_dump()
    # Calibration has its own endpoint; stale display/price forms must not reset it.
    prefs["debt_limits"] = old_preferences.get("debt_limits")
    prefs["card_orders"] = old_preferences.get("card_orders", {})
    prefs["category_payment_defaults"] = old_preferences.get("category_payment_defaults", {})
    prefs["payee_rules"] = old_preferences.get("payee_rules", [])
    user.preferences = json.dumps(prefs)
    ledger.audit(db, "settings.save", user.id, data.model_dump())
    return {"ok": True}


@app.put("/api/settings/payment-defaults")
def save_payment_defaults(
    data: s.PaymentDefaultsInput, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    for category_id, account_id in data.category_payment_defaults.items():
        category = db.get(Category, category_id)
        account = db.get(Account, account_id)
        if not category or category.kind != "expense":
            raise HTTPException(422, "Choose an expense category")
        if (
            not account
            or account.archived
            or account.internal
            or account.kind not in {"credit_card", "checking", "savings", "cash", "bitcoin_wallet"}
        ):
            raise HTTPException(422, "Choose an active payment account")
    prefs = json.loads(user.preferences)
    prefs["category_payment_defaults"] = data.model_dump(mode="json")["category_payment_defaults"]
    user.preferences = json.dumps(prefs)
    ledger.audit(db, "settings.payment_defaults", user.id, data.model_dump(mode="json"))
    return {"ok": True}


@app.put("/api/settings/monetary-lens")
def save_monetary_lens(data: s.MonetaryLensInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    # A workspace toggle must never resubmit stale pricing or display settings.
    prefs = json.loads(user.preferences)
    prefs["denomination"] = data.denomination
    user.preferences = json.dumps(prefs)
    ledger.audit(db, "settings.monetary_lens", user.id, data.model_dump())
    return data.model_dump()


@app.post("/api/import/csv")
def csv_import(
    account_id: int = Form(...),
    file: UploadFile = File(...),
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    content = file.file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise ValueError("CSV is limited to 5 MB")
    return import_csv(db, account_id, content, file.filename or "import.csv")


def safe_cell(value):
    text = str(value or "")
    return "'" + text if text.startswith(("=", "+", "-", "@", "\t", "\r")) else text


@app.get("/api/export/csv")
def csv_export(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    output = io.StringIO()
    writer = csv.writer(output)
    fields = [
        ("id", "id"),
        ("date", "date"),
        ("kind", "kind"),
        ("account", "account"),
        ("currency", "currency"),
        ("amount", "amount"),
        ("destination_id", "destination_id"),
        ("destination_account", "destination_account"),
        ("destination_currency", "destination_currency"),
        ("destination_amount", "destination_amount"),
        ("category", "category"),
        ("description", "description"),
        ("notes", "notes"),
        ("historical_bitcoin_equivalent", "bitcoin"),
        ("historical_usd_equivalent", "usd"),
        ("usd_per_legacy_btc_snapshot", "rate_snapshot"),
        ("purchase_date_rate", "purchase_date_rate"),
        ("purchase_date_source", "purchase_date_source"),
        ("purchase_date_method", "purchase_date_method"),
        ("purchase_date_quote_at", "purchase_date_quote_at"),
    ]
    writer.writerow([label for label, _ in fields])
    for entry in ledger.active_transactions(db):
        row = ledger.transaction_dict(db, entry)
        if entry.kind == "expense":
            cost = row["purchase_cost"]
            if cost:
                row.update(
                    bitcoin=cost["bitcoin"],
                    usd=cost["usd"],
                    purchase_date_rate=cost["usd_per_btc"],
                    purchase_date_source=cost["source"],
                    purchase_date_method=cost["method"],
                    purchase_date_quote_at=cost["observed_at"],
                )
        writer.writerow([safe_cell(row.get(key)) for _, key in fields])
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="appalachian-bitcoin.csv"'},
    )


@app.get("/api/export/journal")
def journal_export(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    from .models import JournalEntry, Posting

    rows = []
    for e in db.scalars(select(JournalEntry).order_by(JournalEntry.id)):
        for p in db.scalars(select(Posting).where(Posting.entry_id == e.id)):
            acc = db.get(Account, p.account_id)
            rows.append(
                {
                    "entry_id": e.id,
                    "date": e.date,
                    "kind": e.kind,
                    "description": e.description,
                    "account": acc.name,
                    "currency": acc.currency,
                    "amount_minor": str(p.amount_minor),
                    "rate_snapshot": e.rate_snapshot,
                    "effective_rate": ledger.entry_rate(db, e),
                    "purchase_cost": costs.snapshot_dict(db, e.id),
                    "reverses_id": e.reverses_id,
                    "created_at": e.created_at,
                }
            )
    return Response(
        json.dumps(rows),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="ledger-journal.json"'},
    )


@app.post("/api/backup")
def backup(data: s.BackupInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    ledger.audit(db, "backup.export", user.id, {})
    content = snapshot(db, data.passphrase)
    return Response(
        content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="ledger.albackup"'},
    )


@app.post("/api/restore")
def restore_backup(
    response: Response,
    passphrase: str = Form(..., min_length=12, max_length=200),
    file: UploadFile = File(...),
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    content = file.file.read(MAX_BYTES + 1)
    restore(db, content, passphrase)
    ledger.audit(db, "backup.restore", "database", {"verified": True})
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True, "message": "Restored and verified. Sign in with the restored owner credentials."}


@app.get("/api/audit")
def audit_events(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return [
        {"id": e.id, "action": e.action, "entity": e.entity, "detail": json.loads(e.detail), "created_at": e.created_at}
        for e in db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(250))
    ]


@app.post("/api/demo")
def demo(
    months: int | None = Query(None, ge=1, le=120),
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    if os.getenv("DEMO_ENABLED", "false").lower() != "true":
        raise HTTPException(403, "Demo is disabled; set DEMO_ENABLED=true")
    life = seed_demo(db, user, months=months)
    # The person is made up. The bitcoin prices are real Coinbase daily closes.
    return {
        "ok": True,
        "fictional": True,
        "prices": "Coinbase daily close",
        "from": str(life.start),
        "entries": len(life.events),
    }


@app.get("/api/node/status")
def node_status(user=Depends(authenticate)):
    if not os.getenv("BITCOIN_RPC_HOST"):
        return {"connected": False, "message": "No node configured. Your ledger works offline."}
    try:
        return BitcoinCore().status()
    except ValueError as exc:
        return {"connected": False, "message": str(exc)}


@app.get("/api/node/wallets")
def wallets(user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return [
        {"id": w.id, "account_id": w.account_id, "wallet": w.wallet, "last_checked": w.last_checked}
        for w in db.scalars(select(WalletConnection))
    ]


@app.post("/api/node/wallets")
def add_wallet(data: s.WalletInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    acc = ledger.account(db, data.account_id)
    if acc.currency != "BITCOIN" or acc.role != "asset":
        raise ValueError("Connect a bitcoin asset account")
    BitcoinCore(data.wallet).wallet_data()  # Refuse wallets with private keys enabled.
    row = WalletConnection(account_id=acc.id, wallet=data.wallet)
    db.add(row)
    db.flush()
    ledger.audit(db, "wallet.connect", row.id, {"wallet": data.wallet})
    return {"id": row.id}


@app.get("/api/node/wallets/{id}/reconcile")
def reconcile(id: int, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    from .models import JournalEntry

    row = db.get(WalletConnection, id)
    if not row:
        raise HTTPException(404, "Wallet not found")
    data = BitcoinCore(row.wallet).wallet_data()
    recorded = {e for e in db.scalars(select(JournalEntry.import_key).where(JournalEntry.import_key.is_not(None)))}
    for tx in data["transactions"]:
        tx["already_recorded"] = tx["key"] in recorded
    ledger_balance = ledger.balance(db, row.account_id)
    row.last_checked = now()
    return {
        **data,
        "ledger_balance": str(ledger_balance),
        "difference": str(int(data["balance_bitcoin"]) - ledger_balance),
        "checked_at": row.last_checked,
    }


@app.get("/api/recurring-bills")
def recurring_bills(account_id: int | None = None, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    statement = select(RecurringBill).where(RecurringBill.archived.is_(False))
    if account_id is not None:
        ledger.account(db, account_id, active=False)
        statement = statement.where(RecurringBill.account_id == account_id)
    return [
        recurring.bill_dict(db, bill)
        for bill in db.scalars(statement.order_by(RecurringBill.next_due, RecurringBill.id))
    ]


@app.post("/api/recurring-bills/reconcile")
def reconcile_recurring_bills(
    account_id: int | None = None, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    if account_id is not None:
        ledger.account(db, account_id, active=False)
    return recurring.reconcile(db, account_id)


@app.post("/api/recurring-bills")
def create_recurring_bill(data: s.RecurringBillInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    return recurring.save(db, data)


@app.put("/api/recurring-bills/{id}")
def update_recurring_bill(
    id: int, data: s.RecurringBillInput, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    return recurring.save(db, data, recurring.get_bill(db, id))


@app.delete("/api/recurring-bills/{id}")
def archive_recurring_bill(id: int, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    recurring.get_bill(db, id).archived = True
    ledger.audit(db, "recurring_bill.archive", id, {})
    return {"ok": True}


@app.post("/api/recurring-bills/{id}/record")
def record_recurring_bill(
    id: int, data: s.BillPaymentInput, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    return recurring.record(db, recurring.get_bill(db, id, include_archived=True), data)


@app.post("/api/accounts/{id}/payments")
def record_debt_payment(
    id: int, data: s.PaymentInput, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    debt = ledger.account(db, id)
    source = ledger.account(db, data.account_id)
    if debt.role != "liability" or source.role != "asset" or source.id == debt.id:
        raise ValueError("Choose a debt and a separate paying account")
    if source.kind not in {"bitcoin_wallet", "checking", "savings", "cash", "brokerage", "stock", "etf"}:
        raise ValueError("Choose a wallet or cash account to pay from")
    if source.kind in {"brokerage", "stock", "etf"} and investments.portfolio_report(db, source.id) is None:
        raise ValueError("Set up holdings and cash before paying from this account")
    if source.currency != debt.currency:
        raise ValueError("The paying account and debt must use the same currency")
    total = to_minor(data.amount, source.currency)
    interest = to_minor(data.interest, source.currency)
    if total <= 0 or interest < 0 or interest > total:
        raise ValueError("Payment must be positive, with interest and fees between zero and the payment amount")
    principal = total - interest
    ids = []
    if principal:
        entry = ledger.create_transaction(
            db,
            s.TransactionInput(
                date=data.date,
                kind="transfer",
                account_id=source.id,
                destination_id=debt.id,
                amount=original(principal, source.currency),
                description=f"Payment: {source.name} → {debt.name}",
                notes=data.notes,
            ),
        )
        ids.append(entry.id)
    if interest:
        entry = ledger.create_transaction(
            db,
            s.TransactionInput(
                date=data.date,
                kind="expense",
                account_id=source.id,
                category_id=data.category_id,
                amount=original(interest, source.currency),
                description=f"Interest & fees: {debt.name}",
                notes=data.notes,
            ),
        )
        ids.append(entry.id)
    ledger.audit(db, "debt.payment", debt.id, {"entry_ids": ids, "account_id": source.id})
    return {"entry_ids": ids}


@app.post("/api/accounts/{id}/valuations")
def value_non_cash_asset(
    id: int, data: s.ValuationInput, user=Depends(authenticate), db=Depends(get_db, scope="function")
):
    acc = ledger.account(db, id)
    if acc.role != "asset" or acc.kind not in {"real_estate", "vehicle", "other_asset"}:
        raise ValueError("Use Update value for property, vehicles, or other valued assets")
    obj = db.scalar(select(Asset).where(Asset.account_id == id))
    if obj is None:
        obj = Asset(account_id=acc.id, name=acc.name, kind=acc.kind, quantity="1")
        db.add(obj)
        db.flush()
        ledger.audit(db, "asset.create", obj.id, {"account_id": id, "quantity": "1"})
    return asset_valuation(obj.id, data, user, db)


@app.put("/api/card-order")
def save_card_order(data: s.CardOrderInput, user=Depends(authenticate), db=Depends(get_db, scope="function")):
    if data.scope == "overview-balances":
        valid = {"bitcoin", "dollars", "valued_asset", "debt"}
    elif data.scope == "bills":
        valid = {str(id) for id in db.scalars(select(RecurringBill.id))}
    else:
        valid = {str(id) for id in db.scalars(select(Account.id).where(Account.internal.is_(False)))}
    if not set(data.ids) <= valid:
        raise ValueError("One or more cards no longer exist. Refresh before arranging them.")
    prefs = json.loads(user.preferences)
    orders = prefs.setdefault("card_orders", {})
    orders[data.scope] = data.ids
    user.preferences = json.dumps(prefs)
    return {"card_orders": orders}


@app.get("/api/expense-costs")
def expense_cost_history(
    bill_id: int | None = None,
    category_id: int | None = None,
    search: str = "",
    user=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    return costs.history(db, bill_id, category_id, search)
