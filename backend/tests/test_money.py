from decimal import Decimal
import pytest
from app.money import btc_to_bitcoin, bitcoin_to_btc, convert, to_minor, decimal, LIMIT


def test_bip177_exact_identity():
    assert btc_to_bitcoin("1") == 100_000_000
    assert bitcoin_to_btc(125000) == "0.00125000"
    assert btc_to_bitcoin(bitcoin_to_btc(LIMIT)) == LIMIT


def test_usd_conversions_and_rounding():
    assert convert(100, "USD", "BITCOIN", "120000") == "833"
    assert convert(12000, "USD", "BITCOIN", "120000") == "100000"
    assert convert(1, "BITCOIN", "USD", "120000") == "0.00"
    assert convert(1, "USD", "BITCOIN", "2000000") == "0"  # 0.5 rounds to even
    assert convert(3, "USD", "BITCOIN", "2000000") == "2"  # 1.5 rounds to even
    assert convert(-3, "USD", "BITCOIN", "2000000") == "-2"
    assert convert(1, "BITCOIN", "BTC", None) == "0.00000001"
    assert to_minor("90071992547409.91", "USD") == 9007199254740991
    assert to_minor("0.10", "USD") + to_minor("0.20", "USD") == 30


@pytest.mark.parametrize(
    "value,currency",
    [
        ("1.1", "BITCOIN"),
        ("0.001", "USD"),
        ("NaN", "USD"),
        ("Infinity", "USD"),
        (0.1, "USD"),
        (str(LIMIT + 1), "BITCOIN"),
    ],
)
def test_invalid_money_rejected(value, currency):
    with pytest.raises(ValueError):
        to_minor(value, currency)


def test_missing_rate_never_uses_current_price():
    assert convert(10000, "USD", "BITCOIN", None) is None
    assert convert(0, "USD", "BITCOIN", None) == "0"
    assert convert(10000, "USD", "USD", None) == "100.00"
    assert decimal("1.25") == Decimal("1.25")
