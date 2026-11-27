"""Live market prices: provider replies are replaced, so nothing here touches the network."""

import time

import pytest

from app import market

HOUR = 3600
DAY = 86400
# Monday 2026-11-16 00:00 UTC.
MONDAY = 1794787200


@pytest.fixture(autouse=True)
def fresh():
    market.reset()
    yield
    market.reset()


def coinbase_rows(start, step, closes):
    """Coinbase order: newest first, each row time, low, high, open, close, volume."""
    rows = [[start + i * step, close - 5, close + 5, close - 1, close, 2.0] for i, close in enumerate(closes)]
    return list(reversed(rows))


def yahoo_chart(symbol, stamps, closes, **meta):
    quote = {
        "open": [None if c is None else c - 1 for c in closes],
        "high": [None if c is None else c + 2 for c in closes],
        "low": [None if c is None else c - 2 for c in closes],
        "close": closes,
        "volume": [None if c is None else 100 for c in closes],
    }
    details = {
        "symbol": symbol,
        "currency": "USD",
        "instrumentType": "EQUITY",
        "longName": "Example Corp",
        "priceHint": 2,
    }
    details.update({"gmtoffset": -18000, "exchangeTimezoneName": "America/New_York", "fullExchangeName": "NasdaqGS"})
    details.update(meta)
    return {
        "chart": {"result": [{"meta": details, "timestamp": stamps, "indicators": {"quote": [quote]}}], "error": None}
    }


class Provider:
    """Stands in for both providers and records every request made."""

    def __init__(self):
        self.calls = []
        self.down = False
        self.ticker = {"price": "60100.5", "time": "2026-11-16T05:30:00Z"}
        self.candles = {}
        self.charts = {}
        self.spark = {}
        self.trades = {}

    def __call__(self, url, params=None):
        self.calls.append((url, dict(params or {})))
        if self.down:
            raise market.Unavailable("The price provider did not answer. Retrying.")
        if url.endswith("/ticker"):
            return self.ticker
        if url.endswith("/stats"):
            return {"open": "58000"}
        if url.endswith("/trades"):
            return self.trades.get(params.get("after"), [])
        if url.endswith("/candles"):
            if "end" in params:
                return []
            return self.candles.get(params["granularity"], [])
        if "/v8/finance/chart/" in url:
            symbol = url.rsplit("/", 1)[1].replace("%5E", "^").replace("%3D", "=")
            if symbol not in self.charts:
                raise market.NotFound("No such symbol")
            return self.charts[symbol]
        if url.endswith("/spark"):
            return {name: self.spark[name] for name in params["symbols"].split(",") if name in self.spark}
        if url.endswith("/search"):
            return {
                "quotes": [
                    {"symbol": "AAPL", "longname": "Apple Inc.", "typeDisp": "Equity", "exchDisp": "NASDAQ"},
                    {"symbol": "bad symbol!"},
                ]
            }
        raise AssertionError(url)


@pytest.fixture
def provider(monkeypatch):
    fake = Provider()
    monkeypatch.setattr(market, "fetch_json", fake)
    return fake


def test_market_prices_need_a_signed_in_owner(client, provider):
    assert client.get("/api/market/candles?symbol=BTC-USD").status_code == 401
    assert client.get("/api/market/quotes?symbols=BTC-USD").status_code == 401
    assert client.get("/api/market/search?q=apple").status_code == 401
    assert provider.calls == []


def test_only_ticker_symbols_and_known_bar_sizes_are_accepted(owner, provider):
    for bad in ("../etc/passwd", "AAPL/../x", "A B", "", "x" * 16):
        assert owner.get("/api/market/candles", params={"symbol": bad}).status_code == 422
    assert owner.get("/api/market/candles?symbol=AAPL&interval=2m").status_code == 422
    assert owner.get("/api/market/quotes?symbols=" + ",".join(f"S{i}" for i in range(41))).status_code == 422
    assert provider.calls == []


def test_bitcoin_bars_come_from_coinbase_with_the_newest_trade_folded_in(owner, provider):
    provider.candles[3600] = coinbase_rows(MONDAY, HOUR, [60000, 60050, 59990, 60020, 60070, 60080])
    reply = owner.get("/api/market/candles?symbol=btc-usd&interval=1h").json()
    assert (reply["symbol"], reply["source"], reply["digits"], reply["full"], reply["stale"]) == (
        "BTC-USD",
        "Coinbase",
        2,
        True,
        False,
    )
    bars = reply["candles"]
    assert [bar[0] for bar in bars] == [MONDAY + i * HOUR for i in range(6)]
    # The 05:30 trade at 60,100.50 closes the 05:00 bar and lifts its high.
    assert bars[-1] == [MONDAY + 5 * HOUR, 60079, 60100.5, 60075, 60100.5, 2.0]
    assert bars[0] == [MONDAY, 59999, 60005, 59995, 60000, 2.0]


def test_four_hour_and_weekly_bitcoin_bars_are_built_from_smaller_ones(owner, provider):
    provider.candles[3600] = coinbase_rows(MONDAY, HOUR, [60000, 60050, 59990, 60020, 60070, 60080])
    provider.candles[86400] = coinbase_rows(MONDAY - 2 * DAY, DAY, [58000, 59000, 60000, 61000])
    four = owner.get("/api/market/candles?symbol=BTC-USD&interval=4h").json()["candles"]
    assert [bar[0] for bar in four] == [MONDAY, MONDAY + 4 * HOUR]
    # First open, highest high, lowest low, last close, summed volume.
    assert four[0] == [MONDAY, 59999, 60055, 59985, 60020, 8.0]
    week = owner.get("/api/market/candles?symbol=BTC-USD&interval=1w").json()["candles"]
    # Saturday and Sunday belong to the week that began the Monday before.
    assert [bar[0] for bar in week] == [MONDAY - 7 * DAY, MONDAY]
    assert week[0][1:5] == [57999, 59005, 57995, 59000]


def test_month_quarter_and_year_bars_are_built_from_days_on_the_calendar(owner, provider):
    # 2026-09-29 to 2026-10-02: the end of September, the start of October and of the fourth quarter.
    start = 1790640000
    provider.candles[86400] = coinbase_rows(start, DAY, [58000, 59000, 60000, 61000])
    month = owner.get("/api/market/candles?symbol=BTC-USD&interval=1mo").json()["candles"]
    # 1 September and 1 October 2026, then November opened by the newest trade.
    assert [bar[0] for bar in month] == [1788220800, 1790812800, 1793491200]
    assert month[0][1:5] == [57999, 59005, 57995, 59000]
    quarter = owner.get("/api/market/candles?symbol=BTC-USD&interval=3mo").json()["candles"]
    assert [bar[0] for bar in quarter] == [1782864000, 1790812800]  # 1 July and 1 October 2026
    year = owner.get("/api/market/candles?symbol=BTC-USD&interval=1y").json()["candles"]
    assert [bar[0] for bar in year] == [1767225600]  # 1 January 2026
    assert year[0][1:6] == [57999, 61005, 57995, 60100.5, 8.0]
    # Daily bars are read page after page until Coinbase has none older, since a year bar needs them all.
    assert (
        sum(1 for url, params in provider.calls if url.endswith("/candles") and params.get("granularity") == 86400) == 2
    )


def test_a_tick_chart_starts_from_bitcoins_recent_trades_oldest_first(owner, provider):
    trade = lambda number, price, second: {  # noqa: E731
        "trade_id": number,
        "price": str(price),
        "size": "0.5",
        "time": f"2026-11-16T05:30:{second:02d}.250Z",
    }
    provider.trades[None] = [trade(12, 60010, 9), trade(11, 60000, 8), {"trade_id": "x"}]
    provider.trades[11] = [trade(10, 59990, 7)]
    trades = owner.get("/api/market/trades").json()["trades"]
    assert trades == [
        {"p": 59990.0, "s": 0.5, "t": 1794807007250},
        {"p": 60000.0, "s": 0.5, "t": 1794807008250},
        {"p": 60010.0, "s": 0.5, "t": 1794807009250},
    ]
    # Older pages are read back from the oldest trade seen, until Coinbase has no more.
    assert [params.get("after") for url, params in provider.calls if url.endswith("/trades")] == [None, 11, 10]


def test_a_refresh_sends_only_the_bars_from_the_one_held(owner, provider):
    provider.candles[3600] = coinbase_rows(MONDAY, HOUR, [60000, 60050, 59990])
    provider.ticker = {"price": "59991", "time": "2026-11-16T02:10:00Z"}
    held = owner.get("/api/market/candles?symbol=BTC-USD&interval=1h").json()["candles"]
    again = owner.get(f"/api/market/candles?symbol=BTC-USD&interval=1h&after={held[-1][0]}").json()
    assert again["full"] is False
    assert [bar[0] for bar in again["candles"]] == [MONDAY + 2 * HOUR]
    # A time the server no longer holds gets the whole run again.
    assert owner.get("/api/market/candles?symbol=BTC-USD&interval=1h&after=5").json()["full"] is True


def test_several_panels_share_one_request_and_an_outage_keeps_the_last_bars_marked_stale(owner, provider):
    provider.candles[3600] = coinbase_rows(MONDAY, HOUR, [60000, 60050])
    first = owner.get("/api/market/candles?symbol=BTC-USD&interval=1h").json()
    asked = len(provider.calls)
    owner.get("/api/market/candles?symbol=BTC-USD&interval=1h")
    assert len(provider.calls) == asked
    market.series_for(("coinbase", "1h")).at -= 60
    market._replies.clear()
    provider.down = True
    later = owner.get("/api/market/candles?symbol=BTC-USD&interval=1h").json()
    assert later["stale"] is True
    # The bars already received stay; the bar the last trade had opened is not made up again.
    assert later["candles"] == first["candles"][:2]
    assert len(first["candles"]) == 3


def test_no_bars_at_all_is_an_error_not_an_empty_chart(owner, provider):
    provider.down = True
    reply = owner.get("/api/market/candles?symbol=BTC-USD&interval=1h")
    assert reply.status_code == 502
    assert "did not answer" in reply.json()["detail"]


def test_stock_bars_skip_gaps_and_fold_the_last_trade_into_its_bar(owner, provider):
    opening = MONDAY + 14 * HOUR + 1800  # 09:30 in New York
    stamps = [opening, opening + HOUR, opening + 2 * HOUR, opening + 2 * HOUR + 1500]
    provider.charts["AAPL"] = yahoo_chart("AAPL", stamps, [340.004, None, 342.0, 343.5])
    reply = owner.get("/api/market/candles?symbol=aapl&interval=1h").json()
    assert (reply["name"], reply["source"], reply["exchange"], reply["currency"]) == (
        "Example Corp",
        "Yahoo Finance",
        "NasdaqGS",
        "USD",
    )
    bars = reply["candles"]
    # The hour with no trades is left out, and the 12:55 row closes the 11:30 bar instead of adding one.
    assert [bar[0] for bar in bars] == [opening, opening + 2 * HOUR]
    assert bars[0][1:5] == [339.0, 342.0, 338.0, 340.0]
    assert bars[1][1:5] == [341.0, 345.5, 340.0, 343.5]
    assert provider.calls[0][1] == {"interval": "60m", "range": "6mo", "includePrePost": "false"}


def test_daily_and_weekly_bars_sit_on_their_trading_date(owner, provider):
    # 09:30 New York in summer (13:30 UTC) and winter (14:30 UTC), then the live row stamped at the close.
    summer = 1782826200  # Tuesday 2026-06-30 13:30 UTC
    stamps = [summer, MONDAY + 14 * HOUR + 1800, MONDAY + 21 * HOUR + 2]
    provider.charts["AAPL"] = yahoo_chart("AAPL", stamps, [300.0, 340.0, 341.0])
    daily = owner.get("/api/market/candles?symbol=AAPL&interval=1d").json()["candles"]
    assert [bar[0] for bar in daily] == [summer // DAY * DAY, MONDAY]
    assert daily[1][1:5] == [339.0, 343.0, 338.0, 341.0]
    weekly = owner.get("/api/market/candles?symbol=AAPL&interval=1w").json()["candles"]
    assert [bar[0] for bar in weekly] == [1782691200, MONDAY]  # Monday 2026-06-29 and Monday 2026-11-16


def test_an_unknown_symbol_is_not_found(owner, provider):
    reply = owner.get("/api/market/candles?symbol=NOPE&interval=1d")
    assert reply.status_code == 404
    assert reply.json()["detail"] == "No prices found for NOPE. Check the symbol."
    # A reply about a different symbol is refused too.
    provider.charts["XYZ"] = yahoo_chart("OTHER", [MONDAY], [1.0])
    assert owner.get("/api/market/candles?symbol=XYZ&interval=1d").status_code == 404


def test_quotes_read_every_symbol_together_and_name_the_ones_with_no_price(owner, provider):
    provider.candles[300] = coinbase_rows(MONDAY, 300, [60000, 60050, 59990])
    now = int(time.time())
    provider.spark["GC=F"] = {
        "timestamp": [now - 600, now - 300, now],
        "close": [3500.0, None, 3515.4],
        "previousClose": 3685.5,
        "end": now + 3600,
    }
    provider.spark["AAPL"] = {
        "timestamp": [now - 9000],
        "close": [342.56],
        "chartPreviousClose": 349.21,
        "end": now - 8000,
    }
    quotes = owner.get("/api/market/quotes?symbols=BTC-USD,GC=F,aapl,NOPE,GC=F").json()["quotes"]
    assert [quote["symbol"] for quote in quotes] == ["BTC-USD", "GC=F", "AAPL", "NOPE"]
    bitcoin, gold, apple, missing = quotes
    assert (bitcoin["price"], bitcoin["previous"], bitcoin["basis"], bitcoin["source"]) == (
        60100.5,
        58000.0,
        "24 hours",
        "Coinbase",
    )
    assert bitcoin["spark"][-1] == 60100.5
    assert (gold["price"], gold["previous"], gold["basis"], gold["session"]) == (
        3515.4,
        3685.5,
        "previous close",
        "open",
    )
    assert gold["spark"] == [3500.0, 3515.4]
    assert (apple["price"], apple["previous"], apple["session"]) == (342.56, 349.21, "closed")
    assert missing == {"symbol": "NOPE", "error": "No price found for NOPE."}
    # One request covers every Yahoo symbol, and a second read within seconds makes none.
    sparks = [call for call in provider.calls if call[0].endswith("/spark")]
    assert len(sparks) == 1 and sparks[0][1]["symbols"] == "GC=F,AAPL,NOPE"
    owner.get("/api/market/quotes?symbols=GC=F,AAPL")
    assert len([call for call in provider.calls if call[0].endswith("/spark")]) == 1


def test_search_returns_only_usable_symbols(owner, provider):
    results = owner.get("/api/market/search?q=apple").json()["results"]
    assert results == [{"symbol": "AAPL", "name": "Apple Inc.", "kind": "Equity", "exchange": "NASDAQ"}]
    assert owner.get("/api/market/search?q=").status_code == 422
    provider.down = True
    assert owner.get("/api/market/search?q=gold").status_code == 502


def test_reading_prices_writes_nothing_to_the_ledger(owner, provider):
    provider.candles[3600] = coinbase_rows(MONDAY, HOUR, [60000])
    before = owner.get("/api/audit").json()
    owner.get("/api/market/candles?symbol=BTC-USD&interval=1h")
    assert owner.get("/api/audit").json() == before
    assert owner.get("/api/rates").json() == []


# ---------- Priced in bitcoin ----------


def rising_bitcoin(hours=60):
    """Hourly bitcoin bars from Monday 00:00 UTC rising 100 dollars an hour, so the price at any moment is known."""
    rows = []
    for k in range(hours):
        opening, close = 60000 + 100 * k, 60000 + 100 * (k + 1)
        rows.append([MONDAY + k * HOUR, opening, close, opening, close, 1.0])
    return list(reversed(rows))


def new_york(provider, symbol, stamps, closes, **meta):
    """A New York stock: 09:30 to 16:00, which in November is 14:30 to 21:00 UTC."""
    hours = {"regular": {"start": MONDAY + 14 * HOUR + 1800, "end": MONDAY + 21 * HOUR}}
    provider.charts[symbol] = yahoo_chart(symbol, stamps, closes, currentTradingPeriod=hours, **meta)


def test_bitcoin_price_at_a_moment_comes_from_the_bars_held():
    hourly = [
        [MONDAY, 60000, 0, 0, 60600, 1],
        [MONDAY + HOUR, 60600, 0, 0, 61200, 1],
        [MONDAY + 5 * HOUR, 62000, 0, 0, 62400, 1],
    ]
    daily = [[MONDAY - DAY, 58000, 0, 0, 59000, 1]]
    tape = market.Tape([(HOUR, hourly), (DAY, daily)], MONDAY + 5 * HOUR + 1800, 62400)
    assert tape.at(MONDAY) == 60000  # on a bar's edge: its open
    assert tape.at(MONDAY + 1800) == 60300  # inside a bar: on the line from open to close
    assert tape.at(MONDAY + 2 * HOUR + 600) == 61200  # a quiet stretch: the last trade stands for an hour
    assert tape.at(MONDAY + 3 * HOUR + 1) is None  # longer than that has no price
    assert tape.at(MONDAY - 12 * HOUR) == 58500  # older than the hourly bars: the daily bar
    assert tape.at(MONDAY - 2 * DAY) is None  # older than every bar held
    assert tape.at(MONDAY + 5 * HOUR + 900) == 62200  # the forming bar ends now, not at the top of the hour
    assert tape.at(MONDAY + 9 * HOUR) == 62400  # now or later: the latest trade


def test_a_stock_day_is_priced_at_bitcoin_when_it_opened_and_when_it_closed(owner, provider):
    provider.candles[3600] = rising_bitcoin()
    provider.ticker = {"price": "66000", "time": "2026-11-18T12:00:00Z"}
    friday, monday, tuesday = (MONDAY + days * DAY + 14 * HOUR + 1800 for days in (-3, 0, 1))
    new_york(
        provider,
        "AAPL",
        [friday, monday, tuesday],
        [330.0, 340.0, 350.0],
        regularMarketPrice=999,
        regularMarketTime=tuesday,
    )
    reply = owner.get("/api/market/candles?symbol=AAPL&interval=1d&unit=bitcoin").json()
    assert (reply["unit"], reply["digits"], reply["currency"]) == ("BITCOIN", 0, "USD")
    assert reply["source"] == "Yahoo Finance, priced with Coinbase"
    # Friday is older than any bitcoin bar held, so it is left out rather than priced on a guess.
    assert [bar[0] for bar in reply["candles"]] == [MONDAY, MONDAY + DAY]
    # Monday: $339 at the 09:30 open, when bitcoin was $61,450; $340 at the 16:00 close, when it was $62,100.
    opened, closed = round(339 / 61450 * 1e8), round(340 / 62100 * 1e8)
    assert reply["candles"][0] == [MONDAY, opened, opened, closed, closed, 100.0]
    assert (opened, closed) == (551668, 547504)
    # The same bars in dollars are untouched, and say so.
    dollars = owner.get("/api/market/candles?symbol=AAPL&interval=1d").json()
    assert (dollars["unit"], dollars["candles"][1][1:5]) == ("USD", [339.0, 342.0, 338.0, 340.0])


def test_the_newest_bar_is_priced_no_later_than_its_last_trade(owner, provider):
    provider.candles[3600] = rising_bitcoin()
    provider.ticker = {"price": "66000", "time": "2026-11-18T12:00:00Z"}
    monday = MONDAY + 14 * HOUR + 1800
    # The day's bar still shows the live price of a trade at 15:00 New York time (20:00 UTC).
    new_york(provider, "AAPL", [monday], [340.0], regularMarketPrice=340.0, regularMarketTime=MONDAY + 20 * HOUR)
    bar = owner.get("/api/market/candles?symbol=AAPL&interval=1d&unit=bitcoin").json()["candles"][0]
    assert bar[4] == round(340 / 62000 * 1e8)


def test_a_sessions_last_bar_ends_when_trading_does(owner, provider):
    provider.candles[3600] = rising_bitcoin()
    provider.ticker = {"price": "66000", "time": "2026-11-18T12:00:00Z"}
    half_past = MONDAY + 19 * HOUR + 1800
    new_york(
        provider, "AAPL", [half_past, half_past + HOUR], [340.0, 341.0], regularMarketPrice=999, regularMarketTime=0
    )
    bars = owner.get("/api/market/candles?symbol=AAPL&interval=1h&unit=bitcoin").json()["candles"]
    # 14:30 to 15:30 New York, then 15:30 to the 16:00 close rather than to 16:30.
    assert bars[0][1:5:3] == [round(339 / 61950 * 1e8), round(340 / 62050 * 1e8)]
    assert bars[1][1:5:3] == [round(340 / 62050 * 1e8), round(341 / 62100 * 1e8)]
    # What a bar reached in between is not known in bitcoin: its high and low are its open and close.
    assert all(bar[2] == max(bar[1], bar[4]) and bar[3] == min(bar[1], bar[4]) for bar in bars)


def test_a_week_in_bitcoin_is_built_from_its_days(owner, provider):
    provider.candles[3600] = rising_bitcoin()
    provider.ticker = {"price": "66000", "time": "2026-11-18T12:00:00Z"}
    monday, tuesday = (MONDAY + days * DAY + 14 * HOUR + 1800 for days in (0, 1))
    new_york(provider, "AAPL", [monday, tuesday], [340.0, 350.0], regularMarketPrice=999, regularMarketTime=0)
    week = owner.get("/api/market/candles?symbol=AAPL&interval=1w&unit=bitcoin").json()["candles"]
    days = owner.get("/api/market/candles?symbol=AAPL&interval=1d&unit=bitcoin").json()["candles"]
    assert len(week) == 1 and len(days) == 2
    assert week[0] == [MONDAY, days[0][1], max(days[0][2], days[1][2]), min(days[0][3], days[1][3]), days[1][4], 200.0]


def test_a_futures_day_runs_from_the_evening_before_to_the_settlement(provider):
    tuesday = MONDAY + DAY
    future = {"instrumentType": "FUTURE"}
    # Gold: 18:00 Monday in New York (23:00 UTC) to the 13:30 settlement on Tuesday (18:30 UTC).
    assert market.day_span(tuesday, "GC=F", future, None) == (MONDAY + 23 * HOUR, tuesday + 18 * HOUR + 1800)
    # A contract not listed is taken at the 17:00 close.
    assert market.day_span(tuesday, "XX=F", future, None) == (MONDAY + 23 * HOUR, tuesday + 22 * HOUR)
    # With no hours known at all a day is its plain UTC day.
    assert market.day_span(tuesday, "AAPL", {}, None) == (tuesday, tuesday + DAY)


def test_bitcoin_yields_and_other_currencies_are_not_restated(owner, provider):
    provider.candles[3600] = rising_bitcoin()
    stamp = MONDAY + 14 * HOUR + 1800
    new_york(provider, "^TNX", [stamp], [4.9], instrumentType="INDEX")
    new_york(provider, "^N225", [stamp], [50000.0], currency="JPY", instrumentType="INDEX")
    for symbol, unit in (("^TNX", "USD"), ("^N225", "JPY")):
        reply = owner.get("/api/market/candles", params={"symbol": symbol, "interval": "1d", "unit": "bitcoin"}).json()
        native = owner.get("/api/market/candles", params={"symbol": symbol, "interval": "1d"}).json()
        assert reply["unit"] == unit and reply["candles"] == native["candles"]
    bitcoin = owner.get("/api/market/candles?symbol=BTC-USD&interval=1h&unit=bitcoin").json()
    assert (bitcoin["unit"], bitcoin["source"]) == ("USD", "Coinbase")
    assert owner.get("/api/market/candles?symbol=AAPL&unit=gold").status_code == 422


def test_without_bitcoin_prices_nothing_is_restated(owner, provider):
    stamp = MONDAY + 14 * HOUR + 1800
    new_york(provider, "AAPL", [stamp], [340.0])
    reply = owner.get("/api/market/candles?symbol=AAPL&interval=1d&unit=bitcoin")
    assert reply.status_code == 502
    assert "bitcoin" in reply.json()["detail"].lower()
