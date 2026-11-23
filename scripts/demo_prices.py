"""Refresh the real bitcoin prices the fictional demo is priced with.

The demo person is made up; the bitcoin prices are not. This fetches Coinbase BTC-USD daily
candles through the same provider code the app uses (`app.prices.Coinbase`: completed UTC days
only, the close attributed to the candle's opening date) and saves every close in the demo
window to `backend/app/demo_data/btc_usd_daily.json`, with the source and when it was retrieved.

Seeding the demo reads that file and never calls the network. Run this at each release to move
the window forward:

    PYTHONPATH=backend .venv/bin/python scripts/demo_prices.py

The window ends on the last completed UTC day and starts on the first day of the month five
years before it, so the first month is a full one. A day Coinbase does not return is left out
of the file and reported; it is never filled in.
"""

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from app.prices import Coinbase, RateUnavailable, utcnow

ROOT = Path(__file__).resolve().parents[1]
PRICE_FILE = ROOT / "backend" / "app" / "demo_data" / "btc_usd_daily.json"
YEARS = 5


def window(end: date) -> tuple[date, date]:
    return date(end.year - YEARS, end.month, 1), end


def fetch(start: date, end: date, provider=None, pause=0.4) -> dict[str, str]:
    provider = provider or Coinbase()
    closes: dict[str, str] = {}
    cursor = start
    while cursor <= end:
        last = min(cursor + timedelta(days=provider.batch_days - 1), end)
        for ref in provider.history(cursor, last):
            closes[str(ref.day)] = ref.value
        cursor = last + timedelta(days=1)
        if cursor <= end:
            time.sleep(pause)
    return closes


def main() -> int:
    provider = Coinbase()
    now = utcnow()
    start, end = window(now.date() - timedelta(days=1))
    try:
        closes = fetch(start, end, provider)
        quote = provider.current()
    except RateUnavailable as exc:
        print(f"Not refreshed: {exc}", file=sys.stderr)
        return 1
    days = [start + timedelta(days=n) for n in range((end - start).days + 1)]
    missing = [str(day) for day in days if str(day) not in closes]
    if str(start) not in closes or str(end) not in closes or len(missing) > 5:
        # A hole at either end, or many holes, means the fetch went wrong. Keep the last good file.
        print(f"Not refreshed: {len(missing)} of {len(days)} days missing ({', '.join(missing[:8])})", file=sys.stderr)
        return 1
    payload = {
        "pair": "BTC-USD",
        "source": provider.name,
        "method": provider.method,
        "definition": "Close of each completed 00:00-00:00 UTC daily candle, keyed by the candle's opening date.",
        "endpoint": "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
        "retrieved_at": now.isoformat(timespec="seconds"),
        "start": str(start),
        "end": str(end),
        "missing": missing,
        # A real current quote for the website demo, shown there with its time and never as live.
        "quote": {"usd_per_btc": quote.value, "observed_at": quote.observed_at},
        "closes": {day: closes[day] for day in sorted(closes)},
    }
    PRICE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PRICE_FILE.write_text(json.dumps(payload, indent=1) + "\n")
    print(
        f"Saved {len(closes)} daily closes, {start} to {end}; {len(missing)} missing. Quote {quote.value} at {quote.observed_at}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
