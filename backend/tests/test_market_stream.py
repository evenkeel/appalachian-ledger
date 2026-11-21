"""The live bitcoin stream: Coinbase's feed is never opened here; its messages are handed in directly."""

import asyncio
import json
import signal

import pytest

from app import market, market_stream
from app.market_stream import relay


@pytest.fixture(autouse=True)
def fresh():
    def clear():
        market.reset()
        relay.listeners.clear()
        relay.last, relay.fresh, relay.closing, relay.task = None, True, False, None

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
        return [chunk async for chunk in market_stream.events(queue, 0.2)], queue

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

    monkeypatch.setattr(market_stream.Relay, "run", no_feed)
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
