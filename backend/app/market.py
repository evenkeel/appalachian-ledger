"""Live market prices for the Markets screen.

Bitcoin comes from Coinbase and every other symbol from Yahoo Finance's public chart
endpoint, the same two sources the ledger already uses. Only ticker symbols leave the
machine. Nothing here is saved or posted: these are chart coordinates, so plain floats
are used, and a price the provider did not give is reported as unavailable or stale,
never filled in.

Each provider reply is remembered for a few seconds so that several panels showing the
same symbol share one outbound request.
"""

import re
import threading
import time
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import quote as urlquote
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .auth import authenticate
from .prices import parse_time

router = APIRouter(prefix="/api/market", dependencies=[Depends(authenticate)])

#: Seconds in each bar the screen can ask for.
INTERVALS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
    "1mo": 2629746,
    "3mo": 7889238,
    "1y": 31556952,
}
#: Bar sizes cut on the calendar, so their length in seconds above is only an average.
CALENDAR = {"1mo": 1, "3mo": 3, "1y": 12}
SYMBOL = re.compile(r"^[A-Z0-9^][A-Z0-9.\-^=]{0,14}$")
BITCOIN = "BTC-USD"
#: The most bars one reply carries.
MAX_BARS = 2400
MAX_SYMBOLS = 40
COINBASE = "https://api.exchange.coinbase.com"
YAHOO = "https://query1.finance.yahoo.com"


class Unavailable(Exception):
    """The provider could not be reached or sent something unusable."""


class NotFound(Unavailable):
    """The provider has no such symbol."""


_client = None
_client_guard = threading.Lock()


def fetch_json(url, params=None):
    """One GET, parsed. Every failure is an Unavailable; tests replace this function."""
    global _client
    with _client_guard:
        if _client is None:
            _client = httpx.Client(
                timeout=8, headers={"User-Agent": "Mozilla/5.0 AppalachianBitcoin/0.1"}, follow_redirects=False
            )
    try:
        response = _client.get(url, params=params)
        if response.status_code == 404:
            raise NotFound("No such symbol")
        if response.status_code == 429:
            raise Unavailable("The price provider is limiting requests. Prices resume shortly.")
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise Unavailable("The price provider did not answer. Retrying.") from exc


def check_symbol(value):
    symbol = (value or "").strip().upper()
    if not SYMBOL.match(symbol):
        raise ValueError("Enter a ticker symbol such as AAPL, GC=F or BTC-USD")
    return symbol


def bucket(stamp, interval):
    """The start of the bar a moment falls in, for bars cut on UTC boundaries.

    Weeks start on Monday; months, quarters and years on the first day of January, April, July and October.
    """
    if interval in CALENDAR:
        date = datetime.fromtimestamp(stamp, timezone.utc)
        months = CALENDAR[interval]
        month = (date.month - 1) // months * months + 1
        return int(datetime(date.year, month, 1, tzinfo=timezone.utc).timestamp())
    if interval == "1w":
        day = stamp // 86400
        return (day - (day + 3) % 7) * 86400
    step = INTERVALS[interval]
    return stamp // step * step


def number(value):
    result = float(value)
    if result != result or result in (float("inf"), float("-inf")):
        raise ValueError("Not a finite number")
    return result


class Series:
    """The bars held for one symbol and bar size, refreshed in place."""

    def __init__(self):
        self.lock = threading.Lock()
        self.rows = {}
        self.pages = 0
        self.at = 0.0
        self.wait = 0.0
        self.stale = False
        self.meta = {}


_series = {}
_series_guard = threading.Lock()


def series_for(key):
    with _series_guard:
        if key not in _series:
            # A single owner looks at a handful of symbols; this only stops unbounded growth.
            if len(_series) >= 400:
                _series.pop(min(_series, key=lambda name: _series[name].at))
            _series[key] = Series()
        return _series[key]


def reset():
    """Forget everything held. Used by tests."""
    with _series_guard:
        _series.clear()
    _replies.clear()
    _names.clear()
    globals()["_live"] = None


_replies = {}
_replies_guard = threading.Lock()


def remembered(key, seconds, load):
    """A small reply (ticker, statistics, search) kept for a few seconds."""
    now = time.monotonic()
    with _replies_guard:
        hit = _replies.get(key)
        if hit and now - hit[0] < seconds:
            return hit[1]
    value = load()
    with _replies_guard:
        if len(_replies) >= 400:
            _replies.pop(min(_replies, key=lambda name: _replies[name][0]))
        _replies[key] = (now, value)
    return value


def trim(rows, keep):
    for stamp in sorted(rows)[:-keep]:
        del rows[stamp]


# ---------- Bitcoin: Coinbase ----------

#: Bar size -> (Coinbase granularity, pages of 300 bars loaded the first time).
COINBASE_BARS = {"1m": (60, 3), "5m": (300, 3), "15m": (900, 3), "1h": (3600, 8), "1d": (86400, 5)}
#: Bar sizes Coinbase does not serve, built from a smaller one.
COINBASE_BUILT = {"4h": "1h", "1w": "1d", "1mo": "1d", "3mo": "1d", "1y": "1d"}
#: Pages of daily bars that reach back past Coinbase's first bitcoin trade in 2015, for the longest bars.
ALL_DAYS = 16


_coinbase_gate = threading.Lock()
_coinbase_last = 0.0


def coinbase_pause():
    """Long histories are read page after page; stay well inside Coinbase's public request limit."""
    global _coinbase_last
    with _coinbase_gate:
        pause = _coinbase_last + 0.12 - time.monotonic()
        if pause > 0:
            time.sleep(pause)
        _coinbase_last = time.monotonic()


def coinbase_page(granularity, end=None):
    params = {"granularity": granularity}
    if end is not None:
        iso = lambda stamp: datetime.fromtimestamp(stamp, timezone.utc).isoformat()  # noqa: E731
        params.update(start=iso(end - 299 * granularity), end=iso(end))
    coinbase_pause()
    data = fetch_json(f"{COINBASE}/products/{BITCOIN}/candles", params)
    if not isinstance(data, list):
        raise Unavailable("Coinbase sent an unreadable reply. Retrying.")
    rows = {}
    for row in data:
        try:
            stamp = int(row[0])
            low, high, opening, close, volume = (number(value) for value in row[1:6])
        except (TypeError, ValueError, IndexError):
            continue
        if stamp % granularity or not 0 < low <= min(opening, close) <= max(opening, close) <= high:
            continue
        rows[stamp] = [stamp, opening, high, low, close, volume]
    return rows


def coinbase_series(base, pages=None):
    granularity, depth = COINBASE_BARS[base]
    pages = pages or depth
    series = series_for(("coinbase", base))
    with series.lock:
        now = time.monotonic()
        try:
            if not series.rows or now - series.at >= series.wait:
                series.rows.update(coinbase_page(granularity))
                series.pages = max(series.pages, 1)
                series.at, series.wait, series.stale = now, 10, False
            while series.rows and series.pages < pages:
                older = coinbase_page(granularity, end=min(series.rows) - granularity)
                series.pages += 1
                if not older:
                    series.pages = pages
                series.rows.update(older)
        except Unavailable:
            if not series.rows:
                raise
            series.at, series.wait, series.stale = now, 5, True
        if not series.rows:
            raise Unavailable("Coinbase returned no bitcoin prices. Retrying.")
        trim(series.rows, max(depth, series.pages) * 300)
        return [list(series.rows[stamp]) for stamp in sorted(series.rows)], series.stale


def combine(rows, interval):
    """Build larger bars from smaller ones: first open, highest high, lowest low, last close, summed volume."""
    built = {}
    for stamp, opening, high, low, close, volume in rows:
        start = bucket(stamp, interval)
        bar = built.get(start)
        if bar is None:
            built[start] = [start, opening, high, low, close, volume]
        else:
            bar[2], bar[3], bar[4], bar[5] = max(bar[2], high), min(bar[3], low), close, bar[5] + volume
    return [built[start] for start in sorted(built)]


_live = None


def note_trade(price, stamp):
    """Record a trade from the live feed, so the bars use it instead of asking Coinbase again."""
    global _live
    _live = (price, stamp, time.monotonic())


def coinbase_ticker():
    live = _live
    if live and time.monotonic() - live[2] < 5:
        return {"price": live[0], "at": int(live[1])}

    def load():
        data = fetch_json(f"{COINBASE}/products/{BITCOIN}/ticker")
        try:
            return {"price": number(data["price"]), "at": int(parse_time(data["time"]).timestamp())}
        except (KeyError, TypeError, ValueError) as exc:
            raise Unavailable("Coinbase sent an unreadable price. Retrying.") from exc

    return remembered(("coinbase", "ticker"), 2, load)


def coinbase_day():
    def load():
        data = fetch_json(f"{COINBASE}/products/{BITCOIN}/stats")
        try:
            return number(data["open"])
        except (KeyError, TypeError, ValueError) as exc:
            raise Unavailable("Coinbase sent unreadable statistics. Retrying.") from exc

    return remembered(("coinbase", "stats"), 30, load)


def with_last_trade(rows, interval, ticker):
    """Fold the newest trade into the newest bar, or open the next bar with it."""
    start = bucket(ticker["at"], interval)
    price = ticker["price"]
    last = rows[-1]
    if start == last[0]:
        last[2], last[3], last[4] = max(last[2], price), min(last[3], price), price
    elif start > last[0]:
        rows.append([start, price, price, price, price, 0.0])
    return rows


def bitcoin_candles(interval):
    base = COINBASE_BUILT.get(interval, interval)
    rows, stale = coinbase_series(base, ALL_DAYS if interval in CALENDAR else None)
    if base != interval:
        rows = combine(rows, interval)
    try:
        rows = with_last_trade(rows, interval, coinbase_ticker())
    except Unavailable:
        stale = True
    return {
        "symbol": BITCOIN,
        "name": "Bitcoin",
        "digits": 2,
        "currency": "USD",
        "kind": "bitcoin",
        "exchange": "Coinbase",
        "source": "Coinbase",
        "session": "open",
        "stale": stale,
        "candles": rows,
    }


def bitcoin_quote():
    ticker = coinbase_ticker()
    rows, stale = coinbase_series("5m", pages=1)
    try:
        previous = coinbase_day()
    except Unavailable:
        previous = None
    closes = [row[4] for row in rows[-288:]]
    return {
        "symbol": BITCOIN,
        "name": "Bitcoin",
        "currency": "USD",
        "price": ticker["price"],
        "previous": previous,
        "basis": "24 hours",
        "observed_at": ticker["at"],
        "session": "open",
        "source": "Coinbase",
        "stale": stale,
        "spark": closes[::3] + [ticker["price"]],
    }


#: Pages of 1,000 recent trades read for a tick chart, and how long one reading is shared.
TRADE_PAGES = 10
TRADE_REUSE = 5


def coinbase_trades():
    """Bitcoin's most recent trades on Coinbase, oldest first, as {"p": price, "s": size in BTC, "t": milliseconds}."""

    def load():
        found = {}
        cursor = None
        for _ in range(TRADE_PAGES):
            params = {"limit": 1000, **({"after": cursor} if cursor is not None else {})}
            coinbase_pause()
            try:
                data = fetch_json(f"{COINBASE}/products/{BITCOIN}/trades", params)
            except Unavailable:
                if found:
                    break  # The newest pages are enough to draw from.
                raise
            if not isinstance(data, list) or not data:
                break
            for item in data:
                try:
                    trade = int(item["trade_id"])
                    found[trade] = {
                        "p": number(item["price"]),
                        "s": number(item["size"]),
                        "t": int(parse_time(item["time"]).timestamp() * 1000),
                    }
                except (KeyError, TypeError, ValueError):
                    continue
            if not found:
                break
            cursor = min(found)  # Coinbase pages back from the oldest trade id seen so far.
        if not found:
            raise Unavailable("Coinbase returned no recent trades. Retrying.")
        return [found[key] for key in sorted(found)]

    return remembered(("coinbase", "trades"), TRADE_REUSE, load)


# ---------- Everything else: Yahoo Finance ----------

#: Bar size -> (Yahoo's name for it, range loaded the first time, range re-read on each refresh).
YAHOO_BARS = {
    "1m": ("1m", "5d", "1d"),
    "5m": ("5m", "1mo", "1d"),
    "15m": ("15m", "1mo", "1d"),
    "1h": ("60m", "6mo", "5d"),
    "4h": ("4h", "1y", "5d"),
    "1d": ("1d", "5y", "1mo"),
    "1w": ("1wk", "10y", "3mo"),
    "1mo": ("1mo", "max", "1y"),
}
#: Bar sizes Yahoo does not serve dependably, built from its monthly bars.
YAHOO_BUILT = {"3mo": "1mo", "1y": "1mo"}
_names = {}


def trading(meta):
    """Whether the regular session is running right now, by the provider's own hours."""
    try:
        hours = meta["currentTradingPeriod"]["regular"]
        return int(hours["start"]) <= time.time() < int(hours["end"])
    except (KeyError, TypeError, ValueError):
        return False


def decimals(meta):
    """Decimal places the exchange quotes this symbol to."""
    try:
        return min(8, max(0, int(meta.get("priceHint", 2))))
    except (TypeError, ValueError):
        return 2


def local_day(stamp, meta):
    """Days since 1970 of the trading date a moment falls on, in the exchange's own time zone."""
    try:
        moment = datetime.fromtimestamp(stamp, ZoneInfo(meta["exchangeTimezoneName"]))
        return moment.toordinal() - 719163
    except Exception:  # noqa: BLE001  A missing or unknown zone falls back to the offset the provider sent.
        return (stamp + int(meta.get("gmtoffset") or 0) + 3600) // 86400


def yahoo_rows(result, interval):
    """Bars from one chart reply. Daily and weekly bars are stamped at midnight UTC of their trading date."""
    meta = result["meta"]
    stamps = result.get("timestamp") or []
    prices = result["indicators"]["quote"][0]
    step = INTERVALS[interval]
    rows = {}
    last = None
    for index, stamp in enumerate(stamps):
        try:
            stamp = int(stamp)
            opening, high, low, close = (number(prices[key][index]) for key in ("open", "high", "low", "close"))
            volume = number(prices["volume"][index] or 0)
        except (TypeError, ValueError, IndexError, KeyError):
            continue  # Yahoo leaves gaps as nulls where nothing traded.
        if interval in ("1d", "1w", "1mo"):
            day = local_day(stamp, meta)
            if interval == "1w":
                day -= (day + 3) % 7
            stamp = day * 86400
            if interval == "1mo":
                stamp = bucket(stamp, "1mo")
        elif last is not None and 0 < stamp - last < step:
            stamp = last  # The newest row carries the time of the last trade, not the start of its bar.
        bar = rows.get(stamp)
        if bar is None:
            rows[stamp] = [stamp, opening, high, low, close, volume]
        else:
            bar[2], bar[3], bar[4], bar[5] = max(bar[2], high), min(bar[3], low), close, max(bar[5], volume)
        last = stamp
    return rows


def yahoo_chart(symbol, code, span):
    try:
        data = fetch_json(
            f"{YAHOO}/v8/finance/chart/{urlquote(symbol, safe='')}",
            {
                "interval": code,
                "includePrePost": "false",
                # Asked for as a range, "max" comes back in coarser bars than asked; a span of dates does not.
                **({"period1": 0, "period2": int(time.time())} if span == "max" else {"range": span}),
            },
        )
    except NotFound:
        raise NotFound(f"No prices found for {symbol}. Check the symbol.") from None
    try:
        result = data["chart"]["result"][0]
        if result["meta"]["symbol"].upper() != symbol:
            raise ValueError("Different symbol")
        result["indicators"]["quote"][0]
        return result
    except (KeyError, TypeError, IndexError, ValueError, AttributeError):
        raise NotFound(f"No prices found for {symbol}. Check the symbol.") from None


def yahoo_candles(symbol, interval, deep=False):
    """Bars from Yahoo. `deep` reads a symbol's daily bars back to its first trade, for the longest bars."""
    if interval in YAHOO_BUILT:
        reply = yahoo_candles(symbol, YAHOO_BUILT[interval])
        return {**reply, "candles": combine(reply["candles"], interval)}
    code, first, again = YAHOO_BARS[interval]
    series = series_for(("yahoo", symbol, interval))
    with series.lock:
        now = time.monotonic()
        widen = deep and not series.pages
        if not series.rows or widen or now - series.at >= series.wait:
            try:
                result = yahoo_chart(symbol, code, "max" if widen else again if series.rows else first)
                if widen:
                    series.pages = 1
                series.rows.update(yahoo_rows(result, interval))
                series.meta = result["meta"]
                # A closed market has nothing new; ask far less often.
                series.wait, series.stale = (15 if trading(series.meta) else 120), False
            except NotFound:
                raise
            except Unavailable:
                if not series.rows:
                    raise
                series.wait, series.stale = 30, True
            series.at = now
        if not series.rows:
            raise NotFound(f"Yahoo Finance has no {interval} prices for {symbol}.")
        trim(series.rows, 40000 if series.pages else MAX_BARS)
        meta = series.meta
        name = meta.get("longName") or meta.get("shortName") or symbol
        _names[symbol] = name
        digits = decimals(meta)
        return {
            "symbol": symbol,
            "name": name,
            "digits": digits,
            "currency": meta.get("currency") or "",
            "kind": str(meta.get("instrumentType") or "").lower(),
            "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
            "source": "Yahoo Finance",
            "session": "open" if trading(meta) else "closed",
            "stale": series.stale,
            # Yahoo sends single-precision values; show them at the precision the exchange quotes.
            "candles": [
                [stamp, *(round(value, digits) for value in series.rows[stamp][1:5]), series.rows[stamp][5]]
                for stamp in sorted(series.rows)
            ],
        }


def yahoo_quotes(symbols):
    """Today's price, the previous close and a short run of closes for several symbols, in few requests."""
    now = time.monotonic()
    found = {}
    wanted = []
    with _replies_guard:
        for symbol in symbols:
            hit = _replies.get(("spark", symbol))
            if hit and now - hit[0] < hit[1]["wait"]:
                found[symbol] = hit[1]
            else:
                wanted.append(symbol)
    for start in range(0, len(wanted), 20):
        group = wanted[start : start + 20]
        try:
            data = fetch_json(
                f"{YAHOO}/v8/finance/spark", {"symbols": ",".join(group), "range": "1d", "interval": "5m"}
            )
            if not isinstance(data, dict):
                raise Unavailable("Yahoo Finance sent an unreadable reply. Retrying.")
        except Unavailable as exc:
            with _replies_guard:
                for symbol in group:
                    hit = _replies.get(("spark", symbol))
                    found[symbol] = {**hit[1], "stale": True} if hit else {"symbol": symbol, "error": str(exc)}
            continue
        for symbol in group:
            entry = yahoo_quote(symbol, data.get(symbol))
            found[symbol] = entry
            with _replies_guard:
                _replies[("spark", symbol)] = (now, entry)
    return [{key: value for key, value in found[symbol].items() if key != "wait"} for symbol in symbols]


def yahoo_quote(symbol, item):
    missing = {"symbol": symbol, "error": f"No price found for {symbol}.", "wait": 120}
    try:
        pairs = [
            (int(stamp), number(close))
            for stamp, close in zip(item["timestamp"], item["close"], strict=False)
            if close is not None
        ]
        previous = item.get("previousClose") or item.get("chartPreviousClose")
        previous = number(previous) if previous is not None else None
        end = int(item.get("end") or 0)
    except (KeyError, TypeError, ValueError):
        return missing
    if not pairs:
        return missing
    closes = [close for _, close in pairs]
    stride = max(1, len(closes) // 96)
    is_open = time.time() < end
    return {
        "symbol": symbol,
        "name": _names.get(symbol),
        "price": closes[-1],
        "previous": previous,
        "basis": "previous close",
        "observed_at": pairs[-1][0],
        "session": "open" if is_open else "closed",
        "source": "Yahoo Finance",
        "stale": False,
        "spark": closes[::stride] if (len(closes) - 1) % stride == 0 else closes[::stride] + [closes[-1]],
        "wait": 15 if is_open else 120,
    }


def yahoo_search(text):
    def load():
        data = fetch_json(
            f"{YAHOO}/v1/finance/search",
            {"q": text, "quotesCount": 10, "newsCount": 0, "listsCount": 0, "enableFuzzyQuery": "false"},
        )
        results = []
        for item in data.get("quotes", []) if isinstance(data, dict) else []:
            symbol = str(item.get("symbol", "")).upper()
            if not SYMBOL.match(symbol):
                continue
            name = item.get("longname") or item.get("shortname") or symbol
            _names.setdefault(symbol, name)
            results.append(
                {
                    "symbol": symbol,
                    "name": "Bitcoin" if symbol == BITCOIN else name,
                    "kind": item.get("typeDisp") or "",
                    "exchange": "Coinbase" if symbol == BITCOIN else item.get("exchDisp") or "",
                }
            )
        return results

    return remembered(("search", text.lower()), 300, load)


# ---------- Priced in bitcoin ----------

#: Whole bitcoin in one BTC.
UNITS = 100_000_000
#: Dollar-quoted symbols whose figure is a yield, not a price.
YIELDS = {"^TNX", "^IRX", "^FVX", "^TYX"}
#: Bar size -> the bitcoin bars that price it, finest first, as (bar size, pages of 300 to hold).
PRICED_WITH = {
    "1m": [("1m", 10)],
    "5m": [("5m", 10)],
    "15m": [("15m", 10)],
    "1h": [("1h", 15)],
    "4h": [("1h", 15)],
    "1d": [("1h", 15), ("1d", 7)],
    # Months, quarters and years are built from days priced back to Coinbase's first bitcoin bar.
    "all": [("1h", 15), ("1d", ALL_DAYS)],
}
#: How long the last trade stands as the price when a stretch has no bitcoin bars.
QUIET = 3600


class Tape:
    """Bitcoin's dollar price at a moment, read from the bars held, finest first.

    On the edge of a bar the price is that bar's open. Inside a bar it is taken on a straight line
    from the open to the close, which is the one estimate made here. A moment no bar covers has no price.
    """

    def __init__(self, layers, now, price):
        self.layers = [(step, [row[0] for row in rows], rows) for step, rows in layers if rows]
        self.now = now
        self.price = price

    def at(self, moment):
        if moment >= self.now:
            return self.price
        for step, starts, rows in self.layers:
            index = bisect_right(starts, moment) - 1
            if index < 0:
                continue
            start, opening, close = rows[index][0], rows[index][1], rows[index][4]
            # The newest bar is still forming: its close is the price now, not at the bar's end.
            end = min(start + step, self.now) if index == len(rows) - 1 else start + step
            if moment < end:
                return opening + (close - opening) * (moment - start) / (end - start)
            if moment - end <= QUIET:
                return close
        return None


def bitcoin_tape(interval):
    layers = []
    stale = False
    for order, (base, pages) in enumerate(PRICED_WITH[interval]):
        try:
            rows, old = coinbase_series(base, pages)
        except Unavailable:
            # Without the finest bars nothing can be priced; without the older ones only older bars go unpriced.
            if order == 0:
                raise
            rows, old = [], True
        layers.append((COINBASE_BARS[base][0], rows))
        stale = stale or old
    try:
        ticker = coinbase_ticker()
        return Tape(layers, ticker["at"], ticker["price"]), stale
    except Unavailable:
        return Tape(layers, time.time(), layers[0][1][-1][4]), True


def session_clock(meta):
    """The exchange's time zone and its regular opening and closing times, in seconds after local midnight."""
    try:
        zone = ZoneInfo(meta["exchangeTimezoneName"])
        hours = meta["currentTradingPeriod"]["regular"]
        opens, closes = (datetime.fromtimestamp(int(hours[key]), zone) for key in ("start", "end"))
        after_midnight = lambda moment: moment.hour * 3600 + moment.minute * 60 + moment.second  # noqa: E731
        opens, closes = after_midnight(opens), after_midnight(closes)
        return (zone, opens, closes) if closes > opens else None
    except Exception:  # noqa: BLE001  Without known hours a bar is priced over its own full span.
        return None


def local_midnight(day, zone):
    date = datetime.fromtimestamp(day * 86400, timezone.utc)
    return datetime(date.year, date.month, date.day, tzinfo=zone)


#: Hours after New York midnight at which a futures contract's daily closing (settlement) price is set.
#: Approximate, and only for the common contracts; any other is taken at the 17:00 close.
SETTLES = {
    **dict.fromkeys(("GC", "SI", "HG", "PL", "PA"), 13.5),
    **dict.fromkeys(("CL", "BZ", "NG", "RB", "HO"), 14.5),
    **dict.fromkeys(("ES", "NQ", "YM", "RTY"), 16),
    **dict.fromkeys(("ZB", "ZN", "ZF", "ZT"), 15),
    **dict.fromkeys(("ZC", "ZS", "ZW"), 14.25),
}


def day_span(stamp, symbol, meta, clock):
    """When a daily bar opened and closed, as moments.

    Stocks and indexes keep their exchange's regular hours. A futures day opens at 18:00 New York time
    the evening before and its close is the settlement price set the next afternoon.
    """
    day = stamp // 86400
    try:
        if str(meta.get("instrumentType", "")).upper() == "FUTURE":
            midnight = local_midnight(day, ZoneInfo("America/New_York"))
            settles = SETTLES.get(symbol.split("=")[0], 17)
            return (midnight - timedelta(hours=6)).timestamp(), (midnight + timedelta(hours=settles)).timestamp()
        if clock:
            midnight = local_midnight(day, clock[0])
            return tuple((midnight + timedelta(seconds=clock[which])).timestamp() for which in (1, 2))
    except Exception:  # noqa: BLE001  An unknown time zone falls back to the plain UTC day.
        pass
    return stamp, stamp + 86400


def in_bitcoin(rows, interval, symbol, meta, tape):
    """Dollar bars restated in whole bitcoin.

    A bar's open is priced at bitcoin's price when the bar opened and its close at bitcoin's price when
    it closed. What the bar reached in between is not known in bitcoin, so its high and low are the
    higher and lower of those two. A bar bitcoin's bars do not cover is left out.
    """
    step = INTERVALS[interval]
    clock = session_clock(meta)
    future = str(meta.get("instrumentType", "")).upper() == "FUTURE"
    priced = []
    for index, (stamp, opening, _high, _low, close, volume) in enumerate(rows):
        if interval == "1d":
            start, end = day_span(stamp, symbol, meta, clock)
        else:
            start, end = stamp, stamp + step
            if clock:
                shut = (local_midnight(local_day(stamp, meta), clock[0]) + timedelta(seconds=clock[2])).timestamp()
                # A session's last bar ends when trading does; a closing print after that is priced where it stands.
                end = min(end, shut) if stamp < shut else stamp
        if index == len(rows) - 1:
            # The newest bar's close is the last trade so far, so it is priced no later than that trade.
            try:
                if abs(close - float(meta["regularMarketPrice"])) <= 10 ** -decimals(meta) / 2:
                    traded = int(meta["regularMarketTime"])
                    end = traded if future and interval == "1d" else max(start, min(end, traded))
            except (KeyError, TypeError, ValueError):
                pass
        first, last = tape.at(start), tape.at(end)
        if not first or not last:
            continue
        opened, closed = opening / first * UNITS, close / last * UNITS
        priced.append([stamp, opened, max(opened, closed), min(opened, closed), closed, volume])
    return priced


def bitcoin_priced(symbol, interval):
    """Bars for a dollar-quoted symbol in whole bitcoin. Anything else comes back in its own unit."""
    # Weeks and longer are built from their days, so a holiday Monday or Friday is priced on the days that traded.
    long = interval in CALENDAR
    base = "1d" if interval == "1w" or long else interval
    reply = yahoo_candles(symbol, base, deep=long)
    if reply["currency"] != "USD" or symbol in YIELDS:
        return reply if base == interval else yahoo_candles(symbol, interval)
    tape, stale = bitcoin_tape("all" if long else base)
    # Days from before bitcoin's first bar can never be priced, so they are not looked at.
    earliest = min((starts[0] for _, starts, _ in tape.layers), default=0) - 86400
    rows = in_bitcoin(
        [row for row in reply["candles"] if row[0] >= earliest],
        base,
        symbol,
        series_for(("yahoo", symbol, base)).meta,
        tape,
    )
    if base != interval:
        rows = combine(rows, interval)
    if not rows:
        raise Unavailable("Bitcoin's prices for this stretch have not arrived yet. Retrying.")
    digits = 0 if rows[-1][4] >= 100 else 2
    return {
        **reply,
        "unit": "BITCOIN",
        "digits": digits,
        "source": f"{reply['source']}, priced with Coinbase",
        "stale": reply["stale"] or stale,
        "candles": [[row[0], *(round(value, digits) for value in row[1:5]), row[5]] for row in rows],
    }


# ---------- Endpoints ----------


def answer(work):
    try:
        return work()
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from None
    except Unavailable as exc:
        raise HTTPException(502, str(exc)) from None


@router.get("/candles")
def candles(
    symbol: str,
    interval: str = "1h",
    unit: Literal["native", "bitcoin"] = "native",
    after: int | None = Query(None, ge=0),
):
    """Bars for one symbol. With `after`, only the bars from that time on, to refresh a drawn chart.

    `unit=bitcoin` restates a dollar-quoted symbol in whole bitcoin; the reply's `unit` says what it holds.
    """
    symbol = check_symbol(symbol)
    if interval not in INTERVALS:
        raise ValueError("Choose one of: " + ", ".join(INTERVALS))
    if symbol == BITCOIN:
        reply = answer(lambda: bitcoin_candles(interval))
    elif unit == "bitcoin":
        reply = answer(lambda: bitcoin_priced(symbol, interval))
    else:
        reply = answer(lambda: yahoo_candles(symbol, interval))
    rows = reply["candles"][-MAX_BARS:]
    full = after is None or not rows or after < rows[0][0] or after > rows[-1][0]
    reply["candles"] = rows if full else [row for row in rows if row[0] >= after]
    return {"unit": reply["currency"], **reply, "interval": interval, "full": full}


@router.get("/trades")
def trades():
    """Bitcoin's most recent trades, oldest first, to start a tick chart before the live stream adds to it."""
    return {"trades": answer(coinbase_trades)}


@router.get("/quotes")
def quotes(symbols: str):
    """The latest price of each symbol with its change and a short run of today's closes."""
    names = list(dict.fromkeys(check_symbol(part) for part in symbols.split(",") if part.strip()))
    if not names or len(names) > MAX_SYMBOLS:
        raise ValueError(f"Ask for 1 to {MAX_SYMBOLS} symbols")
    found = {}
    if BITCOIN in names:
        try:
            found[BITCOIN] = bitcoin_quote()
        except Unavailable as exc:
            found[BITCOIN] = {"symbol": BITCOIN, "name": "Bitcoin", "error": str(exc)}
    others = [name for name in names if name != BITCOIN]
    if others:
        for entry in yahoo_quotes(others):
            found[entry["symbol"]] = entry
    return {"quotes": [found[name] for name in names]}


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=40)):
    """Symbols matching a name or ticker."""
    return {"results": answer(lambda: yahoo_search(q.strip()))}
