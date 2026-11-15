"""Public BTC/USD references. Decimal parsing, explicit methods, no inferred prices."""

import json
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Protocol
import httpx
from sqlalchemy import select
from .models import ExchangeRate
from .money import rate_decimal

UTC = timezone.utc


def utcnow():
    return datetime.now(UTC)


def parse_time(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamp must include timezone")
    return result.astimezone(UTC)


class RateUnavailable(ValueError):
    pass


@dataclass(frozen=True)
class Reference:
    day: date
    value: str
    observed_at: str
    method: str


class PriceProvider(Protocol):
    name: str
    method: str
    batch_days: int

    def current(self) -> Reference: ...
    def history(self, start: date, end: date) -> list[Reference]: ...


def get_json(client, path, params=None):
    """Bounded retry; never retry invalid payloads or ordinary client errors."""
    for attempt in range(3):
        try:
            response = client.get(path, params=params)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < 2:
                    retry = response.headers.get("Retry-After", "")
                    time.sleep(min(int(retry), 10) if retry.isdigit() else 2**attempt)
                    continue
            response.raise_for_status()
            return json.loads(response.text, parse_float=Decimal)
        except (httpx.TimeoutException, httpx.NetworkError):
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def validate_current(value, observed, clock=None):
    clock = clock or utcnow()
    stamp = parse_time(observed)
    age = (clock - stamp).total_seconds()
    if age < -60 or age > 600:
        raise RateUnavailable("Provider quote is stale or has a future timestamp")
    return Reference(stamp.date(), str(rate_decimal(value)), stamp.isoformat(), "spot")


class Coinbase:
    name = "Coinbase"
    method = "daily_close"
    batch_days = 300

    def current(self):
        try:
            with httpx.Client(base_url="https://api.exchange.coinbase.com", timeout=10) as client:
                data = get_json(client, "/products/BTC-USD/ticker")
            return validate_current(data["price"], data["time"])
        except (httpx.HTTPError, KeyError, ValueError, TypeError, OverflowError) as exc:
            raise RateUnavailable("Coinbase current price is unavailable or stale. Retry later.") from exc

    def history(self, start, end):
        if start > end or (end - start).days >= 300 or end >= utcnow().date():
            raise RateUnavailable("History requires 1–300 completed UTC days")
        beginning = datetime.combine(start, datetime.min.time(), UTC)
        finish = datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC)
        try:
            with httpx.Client(base_url="https://api.exchange.coinbase.com", timeout=10) as client:
                data = get_json(
                    client,
                    "/products/BTC-USD/candles",
                    {
                        "start": beginning.isoformat(),
                        "end": finish.isoformat(),
                        "granularity": 86400,
                    },
                )
            if not isinstance(data, list):
                raise ValueError("Invalid candle response")
            result = {}
            for candle in data:
                if not isinstance(candle, list) or len(candle) != 6:
                    raise ValueError("Invalid candle")
                stamp = candle[0]
                if type(stamp) is not int or stamp % 86400:
                    raise ValueError("Candle must start at midnight UTC")
                opened = datetime.fromtimestamp(stamp, UTC)
                day = opened.date()
                # Coinbase can include extra candles outside the requested range.
                if not start <= day <= end:
                    continue
                low, high, opening, close = [rate_decimal(v) for v in candle[1:5]]
                if not low <= opening <= high or not low <= close <= high:
                    raise ValueError("Inconsistent candle prices")
                ref = Reference(day, str(close), (opened + timedelta(days=1)).isoformat(), self.method)
                if day in result and result[day] != ref:
                    raise ValueError("Conflicting duplicate candle")
                result[day] = ref
            return [result[day] for day in sorted(result)]
        except (httpx.HTTPError, KeyError, ValueError, TypeError, OverflowError) as exc:
            raise RateUnavailable("Coinbase daily prices are unavailable or invalid. Retry later.") from exc


class CoinGecko:
    name = "CoinGecko"
    method = "midnight"
    batch_days = 1

    def client(self):
        headers = {}
        if os.getenv("COINGECKO_API_KEY"):
            headers["x-cg-demo-api-key"] = os.environ["COINGECKO_API_KEY"]
        return httpx.Client(base_url="https://api.coingecko.com/api/v3", timeout=10, headers=headers)

    def current(self):
        try:
            with self.client() as client:
                data = get_json(
                    client,
                    "/simple/price",
                    {
                        "ids": "bitcoin",
                        "vs_currencies": "usd",
                        "include_last_updated_at": "true",
                    },
                )["bitcoin"]
            observed = datetime.fromtimestamp(int(data["last_updated_at"]), UTC).isoformat()
            return validate_current(data["usd"], observed)
        except (httpx.HTTPError, KeyError, ValueError, TypeError, OverflowError) as exc:
            raise RateUnavailable("CoinGecko current price is unavailable or stale. Retry later.") from exc

    def daily(self, day):
        # Legacy single-date interface retained for explicit fetches and imports.
        if day >= utcnow().date():
            raise RateUnavailable("Historical prices require a completed UTC day")
        try:
            with self.client() as client:
                data = get_json(
                    client,
                    "/coins/bitcoin/history",
                    {
                        "date": day.strftime("%d-%m-%Y"),
                        "localization": "false",
                    },
                )
            value = data["market_data"]["current_price"]["usd"]
            return str(rate_decimal(value)), datetime.combine(day, datetime.min.time(), UTC).isoformat()
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            raise RateUnavailable(
                "CoinGecko has no usable quote for this date. Enter a manual rate or retry later."
            ) from exc

    def history(self, start, end):
        if start != end or end >= utcnow().date():
            raise RateUnavailable("CoinGecko history requires one completed UTC day")
        if start < utcnow().date() - timedelta(days=365):
            return []  # Outside documented Demo coverage; never fabricate a substitute.
        value, observed = self.daily(start)
        return [Reference(start, value, observed, self.method)]


def provider_for(source):
    if source == "coinbase":
        return Coinbase()
    if source == "coingecko":
        return CoinGecko()
    raise RateUnavailable("Choose a price provider in Settings first")


def save_reference(db, provider, ref):
    existing = db.scalar(
        select(ExchangeRate)
        .where(
            ExchangeRate.day == str(ref.day),
            ExchangeRate.source == provider.name,
            ExchangeRate.method == ref.method,
        )
        .order_by(ExchangeRate.id.desc())
    )
    if existing:
        from .costs import capture

        capture(db, ref.day)
        return existing
    row = ExchangeRate(
        day=str(ref.day), usd_per_btc=ref.value, source=provider.name, observed_at=ref.observed_at, method=ref.method
    )
    db.add(row)
    db.flush()
    from .costs import capture

    capture(db, ref.day)
    return row


def fetch_daily(db, day, provider=None, refresh=False):
    # Compatibility endpoint: completed daily data only, never a current quote.
    provider = provider or CoinGecko()
    method = getattr(provider, "method", "legacy")
    existing = db.scalar(
        select(ExchangeRate)
        .where(
            ExchangeRate.day == str(day),
            ExchangeRate.source == provider.name,
            ExchangeRate.method == method,
        )
        .order_by(ExchangeRate.id.desc())
    )
    if existing and not refresh:
        return existing
    if hasattr(provider, "history"):
        refs = provider.history(day, day)
        if not refs:
            raise RateUnavailable("No historical price for this date")
        return save_reference(db, provider, refs[0])
    value, observed = provider.daily(day)
    return save_reference(db, provider, Reference(day, value, observed, method))
