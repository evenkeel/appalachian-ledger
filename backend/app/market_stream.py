"""Bitcoin trades as they happen, relayed from Coinbase's public feed to the Markets screen.

The browser only ever talks to this server, so the server keeps one connection to Coinbase and
passes each trade on as a server-sent event. The connection exists only while a Markets screen is
listening, nothing is saved, and nothing about the ledger is sent: the one message to Coinbase
names the BTC-USD ticker.
"""

import asyncio
import json
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
SUBSCRIBE = json.dumps({"type": "subscribe", "product_ids": [market.BITCOIN], "channels": ["ticker"]})
#: Seconds a stream runs before the browser is asked to reconnect, which checks the sign-in again.
LIFETIME = 600
#: Seconds without a trade before a comment line keeps the connection from being timed out.
HEARTBEAT = 15
#: Seconds the feed stays connected after the last listener leaves, in case one comes straight back.
LINGER = 20
#: Trades held for a listener that has fallen behind; older ones are dropped first.
BACKLOG = 2000


class Relay:
    """One connection to Coinbase shared by every listening browser."""

    def __init__(self):
        self.listeners = set()
        self.task = None
        self.last = None
        self.fresh = True
        self.closing = False

    def join(self):
        queue = asyncio.Queue(maxsize=BACKLOG)
        self.listeners.add(queue)
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.run())
        return queue

    def leave(self, queue):
        self.listeners.discard(queue)

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
        payload = json.dumps(trade)
        for queue in self.listeners:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(payload)
        return trade

    async def run(self):
        """Stay connected while anyone listens, reconnecting with a growing pause after a failure."""
        pause = 1
        while True:
            failed = False
            try:
                async with connect(FEED, open_timeout=10, max_size=2**20) as feed:
                    await feed.send(SUBSCRIBE)
                    self.fresh = True
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
            except (OSError, WebSocketException, TimeoutError):
                failed = True
            # Nothing is awaited between this check and returning, so a listener that joins always has a feed.
            if self.closing or not self.listeners:
                return
            if failed:
                await asyncio.sleep(pause)
                pause = min(pause * 2, 30)


relay = Relay()


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


async def events(queue, lifetime):
    deadline = time.monotonic() + lifetime
    quiet = 0
    try:
        # Reconnect quickly, and start from the last trade so the price is right at once.
        yield "retry: 1000\n\n"
        if relay.last:
            yield f"data: {json.dumps({**relay.last, 's': 0.0})}\n\n"
        while time.monotonic() < deadline and not relay.closing:
            try:
                first = await asyncio.wait_for(queue.get(), 1)
            except TimeoutError:
                quiet += 1
                if quiet >= HEARTBEAT:
                    quiet = 0
                    yield ": waiting for a trade\n\n"
                continue
            quiet = 0
            burst = [first]
            while not queue.empty() and len(burst) < 500:
                burst.append(queue.get_nowait())
            yield "".join(f"data: {payload}\n\n" for payload in burst)
    finally:
        relay.leave(queue)


@router.get("/stream")
async def stream():
    """Every BTC-USD trade as `{"p": price, "s": size, "t": milliseconds}` server-sent events."""
    return StreamingResponse(
        events(relay.join(), LIFETIME),
        media_type="text/event-stream",
        # nginx would otherwise hold the events back to send them in blocks.
        headers={"X-Accel-Buffering": "no"},
    )
