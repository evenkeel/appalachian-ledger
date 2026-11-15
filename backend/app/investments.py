"""Share-based USD valuations. Quotes mark equity, never income or cash flow."""

import json
from types import SimpleNamespace
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN, localcontext

import httpx
from sqlalchemy import delete, select

from . import accounting as ledger
from .models import Account, Holding, Portfolio, StockQuote
from .money import checked, decimal, original, to_minor
from .prices import parse_time, utcnow


def market_minor(shares, price):
    with localcontext() as ctx:
        ctx.prec = 60
        return checked(int((decimal(shares) * decimal(price) * 100).quantize(Decimal(1), rounding=ROUND_HALF_EVEN)))


def fetch_quote(symbol):
    try:
        response = httpx.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"interval": "1d", "range": "1d"},
            headers={"User-Agent": "Mozilla/5.0 AppalachianBitcoin/0.1"},
            timeout=8,
        )
        response.raise_for_status()
        meta = json.loads(response.text, parse_float=Decimal)["chart"]["result"][0]["meta"]
        if meta["currency"] != "USD" or meta["symbol"].upper() != symbol:
            raise ValueError("Only matching USD securities are supported")
        price = decimal(str(meta["regularMarketPrice"]))
        previous = decimal(str(meta["chartPreviousClose"]))
        observed = datetime.fromtimestamp(int(meta["regularMarketTime"]), timezone.utc)
        if price <= 0 or previous <= 0 or (observed - utcnow()).total_seconds() > 300:
            raise ValueError("Invalid market quote")
        return {"price": str(price), "previous_close": str(previous), "observed_at": observed.isoformat()}
    except (httpx.HTTPError, KeyError, TypeError, IndexError, ValueError, OverflowError):
        raise ValueError(f"Quote unavailable for {symbol}. Check the ticker or try again later.") from None


def quote_for(db, symbol):
    quote = db.get(StockQuote, symbol)
    if quote and (utcnow() - parse_time(quote.fetched_at)).total_seconds() < 60:
        return quote
    data = fetch_quote(symbol)
    if not quote:
        quote = StockQuote(symbol=symbol)
        db.add(quote)
    for key, value in data.items():
        setattr(quote, key, value)
    quote.fetched_at = utcnow().isoformat()
    db.flush()
    return quote


def quote_snapshot(quote):
    return json.dumps({key: getattr(quote, key) for key in ("price", "previous_close", "observed_at", "fetched_at")})


def mark(db, acc, holdings, quotes):
    delta = 0
    for row in holdings:
        value = market_minor(row.shares, quotes[row.symbol].price)
        delta += value - row.marked_minor
        row.marked_minor = value
        row.quote_snapshot = quote_snapshot(quotes[row.symbol])
    if delta:
        ledger.adjustment(db, acc, checked(delta), date.today(), "Market quote update", "valuation")


def save_portfolio(db, account_id, data):
    acc = ledger.account(db, account_id)
    if acc.currency != "USD" or acc.kind not in {"brokerage", "stock", "etf"}:
        raise ValueError("Share tracking requires a USD brokerage, stock, or ETF account")
    portfolio = db.get(Portfolio, account_id)
    existing = list(db.scalars(select(Holding).where(Holding.account_id == account_id)))
    symbols = {h.symbol for h in data.holdings}
    if len(symbols) != len(data.holdings):
        raise ValueError("Enter each ticker once per account")
    cash = to_minor(data.cash, "USD")
    if cash < 0:
        raise ValueError("Cash cannot be negative")
    # Fetch and validate every quote before mutating any holdings or journal entries.
    quotes = {symbol: quote_for(db, symbol) for symbol in symbols}
    if existing:
        mark(db, acc, [h for h in existing if h.symbol in quotes], quotes)
    total = checked(cash + sum(market_minor(h.shares, quotes[h.symbol].price) for h in data.holdings))
    delta = checked(total - ledger.balance(db, acc.id))
    if delta:
        ledger.adjustment(
            db,
            acc,
            delta,
            date.today(),
            "Holdings and cash reconciliation" if portfolio else "Initial share-based valuation",
            "adjustment" if portfolio else "valuation",
        )
    if not portfolio:
        portfolio = Portfolio(account_id=account_id, started_on=str(date.today()))
        db.add(portfolio)
        db.flush()
    db.execute(delete(Holding).where(Holding.account_id == account_id))
    for h in data.holdings:
        cost = to_minor(h.cost_basis, "USD") if h.cost_basis is not None else None
        if cost is not None and cost < 0:
            raise ValueError("Cost basis cannot be negative")
        db.add(
            Holding(
                account_id=account_id,
                symbol=h.symbol,
                shares=h.shares,
                cost_minor=cost,
                marked_minor=market_minor(h.shares, quotes[h.symbol].price),
                quote_snapshot=quote_snapshot(quotes[h.symbol]),
            )
        )
    portfolio.error = None
    portfolio.attempted_at = utcnow().isoformat()
    ledger.audit(db, "holdings.save", acc.id, data.model_dump())
    db.flush()
    return portfolio_report(db, account_id)


def refresh_portfolios(db):
    changed = False
    for portfolio in db.scalars(select(Portfolio).join(Account).where(Account.archived.is_(False))):
        if portfolio.attempted_at and (utcnow() - parse_time(portfolio.attempted_at)).total_seconds() < 60:
            continue
        portfolio.attempted_at = utcnow().isoformat()
        try:
            with db.begin_nested():
                holdings = list(db.scalars(select(Holding).where(Holding.account_id == portfolio.account_id)))
                quotes = {h.symbol: quote_for(db, h.symbol) for h in holdings}
                mark(db, db.get(Account, portfolio.account_id), holdings, quotes)
            portfolio.error = None
        except ValueError as exc:
            portfolio.error = str(exc)
        changed = True
    return {"changed": changed}


def portfolio_report(db, account_id):
    portfolio = db.get(Portfolio, account_id)
    if not portfolio:
        return None
    holdings = []
    marked = 0
    for row in db.scalars(select(Holding).where(Holding.account_id == account_id).order_by(Holding.symbol)):
        snapshot = json.loads(row.quote_snapshot)
        quote = SimpleNamespace(**snapshot) if snapshot else None
        gain = row.marked_minor - row.cost_minor if row.cost_minor is not None else None
        marked += row.marked_minor
        holdings.append(
            {
                "symbol": row.symbol,
                "shares": row.shares,
                "cost_basis": original(row.cost_minor, "USD") if row.cost_minor is not None else None,
                "value": original(row.marked_minor, "USD"),
                "gain": original(gain, "USD") if gain is not None else None,
                "gain_percent": str((Decimal(gain) * 100 / row.cost_minor).quantize(Decimal(".01")))
                if row.cost_minor and gain is not None
                else None,
                "price": quote.price if quote else None,
                "day_change": original(
                    market_minor(row.shares, quote.price) - market_minor(row.shares, quote.previous_close), "USD"
                )
                if quote
                else None,
                "observed_at": quote.observed_at if quote else None,
                "fetched_at": quote.fetched_at if quote else None,
                "stale": bool(portfolio.error)
                or not quote
                or (utcnow() - parse_time(quote.fetched_at)).total_seconds() > 180,
            }
        )
    return {
        "holdings": holdings,
        "cash": original(ledger.balance(db, account_id) - marked, "USD"),
        "started_on": portfolio.started_on,
        "error": portfolio.error,
        "source": "Yahoo Finance",
    }
