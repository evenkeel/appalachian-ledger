"""Bitcoin trades and the order book as they happen, relayed from Coinbase's public feed.

The browser only ever talks to this server, so the server keeps the connections to Coinbase and
passes what arrives on as server-sent events: every trade, and a picture of the order book a few
times a second. A connection exists only while a Markets screen is listening, nothing is saved,
and nothing about the ledger is sent: the one message to Coinbase names the BTC-USD ticker.
"""

import asyncio
import heapq
import json
import math
import signal
import time

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from . import market
from .auth import authenticate
from .prices import parse_time

router = APIRouter(prefix="/api/market", dependencies=[Depends(authenticate)])

FEED = "wss://ws-feed.exchange.coinbase.com"
#: Seconds a stream runs before the browser is asked to reconnect, which checks the sign-in again.
LIFETIME = 600
#: Seconds without news before a comment line keeps the connection from being timed out.
HEARTBEAT = 15
#: Seconds a feed stays connected after its last listener leaves, in case one comes straight back.
LINGER = 20
#: Trades held for a listener that has fallen behind; older ones are dropped first.
BACKLOG = 2000

_stopping = False


class OutOfStep(Exception):
    """The order book held no longer makes sense, so it is read again from the start."""


class Feed:
    """One connection to Coinbase for one channel, shared by every listening browser."""

    channel = ""
    backlog = BACKLOG
    #: Whether a listener only ever needs the newest message, as with a picture of the order book.
    newest_only = False

    def __init__(self):
        self.listeners = set()
        self.task = None
        self.last = None

    @property
    def closing(self):
        return _stopping

    @closing.setter
    def closing(self, value):
        global _stopping
        _stopping = value

    def join(self):
        queue = asyncio.Queue(maxsize=self.backlog)
        self.listeners.add(queue)
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.run())
        return queue

    def leave(self, queue):
        self.listeners.discard(queue)

    def publish(self, payload):
        for queue in self.listeners:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(payload)

    def opening(self):
        """What a new listener is sent first, so the screen is right at once."""
        return self.last

    def connected(self):
        """Called each time the connection to Coinbase is made or remade."""

    def handle(self, raw):
        raise NotImplementedError

    async def run(self):
        """Stay connected while anyone listens, reconnecting with a growing pause after a failure."""
        subscribe = json.dumps({"type": "subscribe", "product_ids": [market.BITCOIN], "channels": [self.channel]})
        pause = 1
        while True:
            failed = False
            try:
                async with connect(FEED, open_timeout=10, max_size=2**24) as feed:
                    await feed.send(subscribe)
                    self.connected()
                    idle = None
                    while not self.closing:
                        if self.listeners:
                            idle = None
                        elif idle is None:
                            idle = time.monotonic()
                        elif time.monotonic() - idle > LINGER:
                            break
                        try:
                            raw = await asyncio.wait_for(feed.recv(), 5)
                        except TimeoutError:
                            continue
                        if self.handle(raw):
                            pause = 1
            except (OSError, WebSocketException, TimeoutError, OutOfStep):
                failed = True
            # Nothing is awaited between this check and returning, so a listener that joins always has a feed.
            if self.closing or not self.listeners:
                return
            if failed:
                await asyncio.sleep(pause)
                pause = min(pause * 2, 30)


class Relay(Feed):
    """Every BTC-USD trade."""

    channel = "ticker"

    def __init__(self):
        super().__init__()
        self.fresh = True

    def connected(self):
        self.fresh = True

    def opening(self):
        # The last trade again, for its price only: its size is already in the bars.
        return json.dumps({**self.last, "s": 0.0}) if self.last else None

    def handle(self, raw):
        """One message from Coinbase. Returns the trade passed on, or None for anything else."""
        try:
            message = json.loads(raw)
            if message.get("type") != "ticker" or message.get("product_id") != market.BITCOIN:
                return None
            price = market.number(message["price"])
            stamp = parse_time(message["time"]).timestamp()
            size = market.number(message.get("last_size") or 0)
            if price <= 0 or size < 0:
                return None
        except (KeyError, TypeError, ValueError, AttributeError):
            return None
        # The first message after connecting repeats the last trade, which the bars already count.
        trade = {"p": price, "s": 0.0 if self.fresh else size, "t": int(stamp * 1000)}
        self.fresh = False
        self.last = trade
        market.note_trade(price, stamp)
        self.publish(json.dumps(trade))
        return trade


#: Seconds between pictures of the order book sent to the browser.
BOOK_EVERY = 0.25
#: Price levels sent exactly as the exchange holds them, nearest the spread, for each side.
BOOK_TOP = 60
#: How far from the middle price the two grouped views reach, as a share of the price.
BOOK_NEAR = 0.0025
BOOK_WIDE = 0.025


def nice_step(value):
    """The 1, 2 or 5 times a power of ten at or below a value, for price groups people read easily."""
    exponent = math.floor(math.log10(value))
    lead = value / 10**exponent
    return (5 if lead >= 5 else 2 if lead >= 2 else 1) * 10**exponent


class Book(Feed):
    """The BTC-USD order book: every resting buy and sell order, kept current from Coinbase's updates.

    The whole book is tens of thousands of price levels, so the browser is sent a picture instead: the
    levels nearest the spread exactly as they are, and two grouped views for a wider look.
    """

    channel = "level2_batch"
    backlog = 4
    newest_only = True

    def __init__(self):
        super().__init__()
        self.bids = {}
        self.asks = {}
        self.ready = False
        self.sent = 0.0

    def connected(self):
        self.bids.clear()
        self.asks.clear()
        self.ready = False

    def handle(self, raw):
        """One message from Coinbase. Returns the picture sent on, or None when it was not yet time for one."""
        try:
            message = json.loads(raw)
        except ValueError:
            return None
        if not isinstance(message, dict) or message.get("product_id") != market.BITCOIN:
            return None
        kind = message.get("type")
        try:
            if kind == "snapshot":
                self.bids = {market.number(price): market.number(size) for price, size in message["bids"]}
                self.asks = {market.number(price): market.number(size) for price, size in message["asks"]}
                self.ready = True
                stamp = time.time()
            elif kind == "l2update" and self.ready:
                for side, price, size in message["changes"]:
                    book = self.bids if side == "buy" else self.asks
                    price, size = market.number(price), market.number(size)
                    if size > 0:
                        book[price] = size
                    else:
                        book.pop(price, None)
                stamp = parse_time(message["time"]).timestamp()
            else:
                return None
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            # Half an update may have been applied, so the book is read again from the start.
            raise OutOfStep("An order book message could not be read") from exc
        now = time.monotonic()
        if now - self.sent < BOOK_EVERY and kind != "snapshot":
            return None
        picture = self.picture(stamp)
        if picture is None:
            return None
        self.sent = now
        self.last = json.dumps(picture, separators=(",", ":"))
        self.publish(self.last)
        return picture

    def picture(self, stamp):
        if not self.bids or not self.asks:
            return None
        bid, ask = max(self.bids), min(self.asks)
        if bid >= ask:
            # A buyer at or above the lowest seller would have traded: an update was missed.
            raise OutOfStep("The order book crossed")
        middle = (bid + ask) / 2

        def grouped(step, reach):
            low, high = middle * (1 - reach), middle * (1 + reach)
            buys, sells = {}, {}
            # A group of bids is named by its lowest price and a group of asks by its highest.
            for price, size in self.bids.items():
                if price >= low:
                    key = math.floor(price / step) * step
                    buys[key] = buys.get(key, 0.0) + size
            for price, size in self.asks.items():
                if price <= high:
                    key = math.ceil(price / step) * step
                    sells[key] = sells.get(key, 0.0) + size
            return {
                "step": step,
                "bids": [[round(price, 2), round(buys[price], 5)] for price in sorted(buys, reverse=True)],
                "asks": [[round(price, 2), round(sells[price], 5)] for price in sorted(sells)],
            }

        return {
            "t": int(stamp * 1000),
            "bid": bid,
            "ask": ask,
            "top": {
                "step": 0.01,
                "bids": [[price, round(size, 8)] for price, size in heapq.nlargest(BOOK_TOP, self.bids.items())],
                "asks": [[price, round(size, 8)] for price, size in heapq.nsmallest(BOOK_TOP, self.asks.items())],
            },
            "near": grouped(nice_step(middle * 0.00002), BOOK_NEAR),
            "wide": grouped(nice_step(middle * 0.0001), BOOK_WIDE),
        }


relay = Relay()
book = Book()


def end_streams_when_stopping():
    """Tell the streams when the server has been asked to stop.

    A server waits for open responses before it exits, and a stream is open for minutes. The server's own
    handlers for the stop signals are wrapped so the streams end first, then the server's handler runs as
    before. Called once the server is up, from the thread that owns signal handling.
    """
    for name in ("SIGINT", "SIGTERM"):
        number = getattr(signal, name, None)
        try:
            previous = signal.getsignal(number) if number is not None else None
            if not callable(previous) or getattr(previous, "ends_streams", False):
                continue  # No server handler to pass the signal on to, or already wrapped.

            def stop(received, frame, previous=previous):
                relay.closing = True
                return previous(received, frame)

            stop.ends_streams = True
            signal.signal(number, stop)
        except (ValueError, OSError):  # Not the main thread (tests): streams then end at their lifetime.
            return


async def events(feed, queue, lifetime):
    deadline = time.monotonic() + lifetime
    quiet = 0
    try:
        # Reconnect quickly, and start from what is already known so the screen is right at once.
        yield "retry: 1000\n\n"
        first = feed.opening()
        if first:
            yield f"data: {first}\n\n"
        while time.monotonic() < deadline and not feed.closing:
            try:
                first = await asyncio.wait_for(queue.get(), 1)
            except TimeoutError:
                quiet += 1
                if quiet >= HEARTBEAT:
                    quiet = 0
                    yield ": waiting\n\n"
                continue
            quiet = 0
            burst = [first]
            while not queue.empty() and len(burst) < 500:
                burst.append(queue.get_nowait())
            if feed.newest_only:
                burst = burst[-1:]
            yield "".join(f"data: {payload}\n\n" for payload in burst)
    finally:
        feed.leave(queue)


def served(feed):
    return StreamingResponse(
        events(feed, feed.join(), LIFETIME),
        media_type="text/event-stream",
        # nginx would otherwise hold the events back to send them in blocks.
        headers={"X-Accel-Buffering": "no"},
    )


@router.get("/stream")
async def stream():
    """Every BTC-USD trade as `{"p": price, "s": size, "t": milliseconds}` server-sent events."""
    return served(relay)


@router.get("/book")
async def order_book():
    """The BTC-USD order book, a fresh picture a few times a second, as server-sent events."""
    return served(book)
