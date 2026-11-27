"""The live bitcoin stream: Coinbase's feed is never opened here; its messages are handed in directly."""

import asyncio
import json
import signal

import pytest

from app import market, market_stream
from app.market_stream import book, relay


@pytest.fixture(autouse=True)
def fresh():
    def clear():
        market.reset()
        relay.listeners.clear()
        relay.last, relay.fresh, relay.closing, relay.task = None, True, False, None
        book.listeners.clear()
        book.bids, book.asks, book.ready, book.sent, book.last, book.task = {}, {}, False, 0.0, None, None

    clear()
    yield
    clear()


def ticker(price, size="0.01", time="2026-11-16T05:30:00.123456Z", **more):
    return json.dumps(
        {"type": "ticker", "product_id": "BTC-USD", "price": price, "last_size": size, "time": time, **more}
    )


def test_each_trade_is_passed_on_with_its_price_size_and_millisecond(monkeypatch):
    queue = asyncio.Queue()
    relay.listeners.add(queue)
    # The first message after connecting repeats the last trade, so its size is not counted again.
    assert relay.handle(ticker("60000.5", "0.2")) == {"p": 60000.5, "s": 0.0, "t": 1794807000123}
    assert relay.handle(ticker("60001.25", "0.03", "2026-11-16T05:30:01.5Z")) == {
        "p": 60001.25,
        "s": 0.03,
        "t": 1794807001500,
    }
    assert [json.loads(queue.get_nowait()) for _ in range(2)] == [
        {"p": 60000.5, "s": 0.0, "t": 1794807000123},
        {"p": 60001.25, "s": 0.03, "t": 1794807001500},
    ]
    assert relay.last == {"p": 60001.25, "s": 0.03, "t": 1794807001500}
    # The bars use the streamed trade instead of asking Coinbase again.
    monkeypatch.setattr(market, "fetch_json", lambda *args, **kwargs: pytest.fail("no request expected"))
    assert market.coinbase_ticker() == {"price": 60001.25, "at": 1794807001}


def test_anything_that_is_not_a_bitcoin_trade_is_ignored():
    queue = asyncio.Queue()
    relay.listeners.add(queue)
    for raw in (
        "not json",
        json.dumps({"type": "subscriptions", "channels": []}),
        json.dumps({"type": "ticker", "product_id": "ETH-USD", "price": "3000", "time": "2026-11-16T05:30:00Z"}),
        ticker("NaN"),
        ticker("-5"),
        ticker("60000", time="yesterday"),
        ticker("60000", size="-1"),
        json.dumps(["ticker"]),
    ):
        assert relay.handle(raw) is None
    assert queue.empty() and relay.last is None


def test_a_listener_that_falls_behind_loses_the_oldest_trades_not_the_newest():
    queue = asyncio.Queue(maxsize=3)
    relay.listeners.add(queue)
    for price in range(60000, 60006):
        relay.handle(ticker(str(price)))
    assert [json.loads(queue.get_nowait())["p"] for _ in range(3)] == [60003, 60004, 60005]


def test_a_stream_starts_from_the_last_trade_sends_bursts_together_and_ends_at_its_lifetime():
    async def collect():
        relay.last = {"p": 60000.0, "s": 0.4, "t": 1}
        queue = asyncio.Queue()
        relay.listeners.add(queue)
        queue.put_nowait('{"p": 60001.0, "s": 0.1, "t": 2}')
        queue.put_nowait('{"p": 60002.0, "s": 0.2, "t": 3}')
        return [chunk async for chunk in market_stream.events(relay, queue, 0.2)], queue

    chunks, queue = asyncio.run(collect())
    assert chunks[0] == "retry: 1000\n\n"
    # The opening line repeats the last trade for its price only; its size was already counted.
    assert json.loads(chunks[1].removeprefix("data: ")) == {"p": 60000.0, "s": 0.0, "t": 1}
    assert chunks[2] == 'data: {"p": 60001.0, "s": 0.1, "t": 2}\n\ndata: {"p": 60002.0, "s": 0.2, "t": 3}\n\n'
    assert len(chunks) == 3
    assert queue not in relay.listeners


def test_the_stream_needs_a_signed_in_owner_and_is_served_as_events(client, owner, monkeypatch):
    async def no_feed(self):
        return None

    monkeypatch.setattr(market_stream.Feed, "run", no_feed)
    monkeypatch.setattr(market_stream, "LIFETIME", 0)
    reply = owner.get("/api/market/stream")
    assert reply.status_code == 200
    assert reply.headers["content-type"].startswith("text/event-stream")
    assert reply.headers["x-accel-buffering"] == "no"
    assert reply.text == "retry: 1000\n\n"
    assert relay.listeners == set()
    owner.cookies.clear()
    assert owner.get("/api/market/stream").status_code == 401


def test_streams_end_when_the_server_is_told_to_stop():
    seen = []
    before = signal.getsignal(signal.SIGTERM)
    interrupt = signal.getsignal(signal.SIGINT)
    try:
        signal.signal(signal.SIGTERM, lambda number, frame: seen.append(number))
        market_stream.end_streams_when_stopping()
        wrapped = signal.getsignal(signal.SIGTERM)
        market_stream.end_streams_when_stopping()
        assert signal.getsignal(signal.SIGTERM) is wrapped  # wrapped once, however often it is called
        wrapped(signal.SIGTERM, None)
        # The streams are told first, then the server's own handler runs as before.
        assert relay.closing is True and seen == [signal.SIGTERM]
    finally:
        signal.signal(signal.SIGTERM, before)
        signal.signal(signal.SIGINT, interrupt)


# ---------- Order book ----------


def snapshot(bids, asks):
    return json.dumps({"type": "snapshot", "product_id": "BTC-USD", "bids": bids, "asks": asks})


def update(*changes, time="2026-11-16T05:30:02.250Z"):
    return json.dumps({"type": "l2update", "product_id": "BTC-USD", "changes": list(changes), "time": time})


BIDS = [
    ["60000.50", "1.5"],
    ["60000.10", "0.5"],
    ["59999.90", "2"],
    ["59990.00", "4"],
    ["59000.00", "10"],
    ["100.00", "500"],
]
ASKS = [
    ["60000.60", "0.25"],
    ["60001.00", "0.75"],
    ["60001.20", "1"],
    ["60012.00", "3"],
    ["61000.00", "8"],
    ["900000.00", "1"],
]


def test_price_groups_are_round_numbers():
    assert [market_stream.nice_step(value) for value in (1.2, 2.4, 6, 12, 0.7, 49)] == [1, 2, 5, 10, 0.5, 20]


def test_the_order_book_is_sent_as_a_picture_nearest_levels_exact_and_the_rest_grouped():
    queue = asyncio.Queue()
    book.listeners.add(queue)
    picture = book.handle(snapshot(BIDS, ASKS))
    assert json.loads(queue.get_nowait()) == picture
    assert (picture["bid"], picture["ask"]) == (60000.5, 60000.6)
    # Nearest the spread, exactly as the exchange holds them: buyers from the highest, sellers from the lowest.
    assert picture["top"]["bids"][:3] == [[60000.5, 1.5], [60000.1, 0.5], [59999.9, 2.0]]
    assert picture["top"]["asks"][:3] == [[60000.6, 0.25], [60001.0, 0.75], [60001.2, 1.0]]
    # Grouped by the dollar: a group of bids is named by its lowest price, a group of asks by its highest.
    assert picture["near"] == {
        "step": 1,
        "bids": [[60000, 2.0], [59999, 2.0], [59990, 4.0]],
        "asks": [[60001, 1.0], [60002, 1.0], [60012, 3.0]],
    }
    # Grouped by five dollars and reaching 2.5% either way; orders further off are left out.
    assert picture["wide"] == {
        "step": 5,
        "bids": [[60000, 2.0], [59995, 2.0], [59990, 4.0], [59000, 10.0]],
        "asks": [[60005, 2.0], [60015, 3.0], [61000, 8.0]],
    }
    # Grouped by fifty dollars and reaching a quarter of the price either way, for the widest groups.
    assert picture["far"] == {
        "step": 50,
        "bids": [[60000, 2.0], [59950, 6.0], [59000, 10.0]],
        "asks": [[60050, 5.0], [61000, 8.0]],
    }


def test_updates_change_the_book_and_pictures_are_sent_a_few_times_a_second(monkeypatch):
    queue = asyncio.Queue()
    book.listeners.add(queue)
    assert book.handle(update(["buy", "60000.50", "9"])) is None  # nothing is known until the first full book
    book.handle(snapshot(BIDS, ASKS))
    queue.get_nowait()
    # An update straight after a picture is kept, not sent: the next picture carries it.
    assert book.handle(update(["buy", "60000.50", "0"], ["sell", "60000.60", "5"], ["buy", "60000.40", "7"])) is None
    assert queue.empty()
    monkeypatch.setattr(market_stream, "BOOK_EVERY", 0)
    picture = book.handle(update(["sell", "60001.00", "0.00000000"]))
    assert picture["t"] == 1794807002250
    # The best bid was taken away, a new one came in, the best ask grew and one level emptied.
    assert picture["top"]["bids"][:2] == [[60000.4, 7.0], [60000.1, 0.5]]
    assert picture["top"]["asks"][:2] == [[60000.6, 5.0], [60001.2, 1.0]]
    assert json.loads(queue.get_nowait())["bid"] == 60000.4


def test_a_book_that_stops_making_sense_is_read_again_from_the_start(monkeypatch):
    monkeypatch.setattr(market_stream, "BOOK_EVERY", 0)
    book.handle(snapshot(BIDS, ASKS))
    # A buyer above the lowest seller would have traded, so an update must have been missed.
    with pytest.raises(market_stream.OutOfStep):
        book.handle(update(["buy", "60005.00", "1"]))
    book.connected()
    assert (book.bids, book.asks, book.ready) == ({}, {}, False)
    book.handle(snapshot(BIDS, ASKS))
    with pytest.raises(market_stream.OutOfStep):
        book.handle(update(["buy", "sixty thousand", "1"]))
    # Messages about anything else are passed over without touching the book.
    for raw in (
        "not json",
        json.dumps(["l2update"]),
        json.dumps({"type": "subscriptions"}),
        update(["buy", "1", "1"]).replace("BTC-USD", "ETH-USD"),
    ):
        assert book.handle(raw) is None


def test_a_book_listener_is_sent_only_the_newest_picture():
    async def collect():
        book.last = '{"t":1}'
        queue = asyncio.Queue()
        book.listeners.add(queue)
        for payload in ('{"t":2}', '{"t":3}', '{"t":4}'):
            queue.put_nowait(payload)
        return [chunk async for chunk in market_stream.events(book, queue, 0.2)]

    assert asyncio.run(collect()) == ["retry: 1000\n\n", 'data: {"t":1}\n\n', 'data: {"t":4}\n\n']


def test_the_order_book_stream_needs_a_signed_in_owner(client, owner, monkeypatch):
    async def no_feed(self):
        return None

    monkeypatch.setattr(market_stream.Feed, "run", no_feed)
    monkeypatch.setattr(market_stream, "LIFETIME", 0)
    reply = owner.get("/api/market/book")
    assert reply.status_code == 200
    assert reply.headers["content-type"].startswith("text/event-stream")
    assert reply.text == "retry: 1000\n\n"
    assert book.listeners == set()
    owner.cookies.clear()
    assert owner.get("/api/market/book").status_code == 401
