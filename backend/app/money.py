"""Exact monetary arithmetic. BTC is used only at compatibility boundaries."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext

BASE = 100_000_000
LIMIT = 2**63 - 1
CURRENCIES = {"USD": 100, "BITCOIN": 1}


def decimal(value) -> Decimal:
    if isinstance(value, (float, bool)):
        raise ValueError("Money must be a decimal string, never a floating-point number")
    try:
        result = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError("Invalid decimal") from None
    if not result.is_finite() or abs(result) > Decimal(LIMIT):
        raise ValueError("Decimal outside supported range")
    return result


def checked(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or abs(value) > LIMIT:
        raise ValueError("Amount exceeds signed 64-bit storage")
    return value


def to_minor(value: str, currency: str) -> int:
    with localcontext() as ctx:
        ctx.prec = 60
        scaled = decimal(value) * CURRENCIES[currency]
        if scaled != scaled.to_integral_value():
            raise ValueError("USD supports two decimal places; bitcoin must be whole units")
        return checked(int(scaled))


def btc_to_bitcoin(value: str) -> int:
    with localcontext() as ctx:
        ctx.prec = 60
        scaled = decimal(value) * BASE
        if scaled != scaled.to_integral_value():
            raise ValueError("Legacy BTC supports eight decimal places")
        return checked(int(scaled))


def bitcoin_to_btc(value: int) -> str:
    return f"{Decimal(checked(value)) / BASE:.8f}"


def rate_decimal(value) -> Decimal:
    rate = decimal(value)
    if rate < Decimal("0.00000001") or rate > Decimal("1000000000000"):
        raise ValueError("Rate must be between 0.00000001 and 1000000000000 USD per BTC")
    return rate


def convert(amount: int, currency: str, denomination: str, rate: str | None) -> str | None:
    """Convert minor units; never fabricate a missing rate. Half-even rounding."""
    with localcontext() as ctx:
        ctx.prec = 60
        raw = Decimal(amount)
        if amount == 0:
            return "0.00" if denomination == "USD" else "0.00000000" if denomination == "BTC" else "0"
        if denomination == "USD":
            value = raw / 100 if currency == "USD" else (raw * rate_decimal(rate) / BASE if rate else None)
            return format(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN), "f") if value is not None else None
        value = raw if currency == "BITCOIN" else (raw * BASE / (100 * rate_decimal(rate)) if rate else None)
        if value is None:
            return None
        if denomination == "BTC":
            return format((value / BASE).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_EVEN), "f")
        return format(value.quantize(Decimal("1"), rounding=ROUND_HALF_EVEN), "f")


def original(amount: int, currency: str) -> str:
    return str(amount) if currency == "BITCOIN" else f"{Decimal(amount) / 100:.2f}"


def exchange_price(usd_minor: int, bitcoin_minor: int) -> str | None:
    """Actual USD/BTC price, including quantity-weighted acquisition summaries."""
    if bitcoin_minor <= 0:
        return None
    with localcontext() as ctx:
        ctx.prec = 60
        return format((Decimal(usd_minor) * 1_000_000 / bitcoin_minor).quantize(Decimal(".01")), "f")
