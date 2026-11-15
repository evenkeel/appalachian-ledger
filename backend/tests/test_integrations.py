from datetime import date
import pytest
from app.node import BitcoinCore
from app.prices import fetch_daily, RateUnavailable
from app.db import SessionLocal
from conftest import new_account, post


def test_price_cache_and_failure():
    class Fake:
        name = "Test provider"
        calls = 0

        def daily(self, day):
            self.calls += 1
            if day == date(2026, 1, 2):
                raise RateUnavailable("No data")
            return "120000.123456", "2026-01-01T00:00:00+00:00"

    provider = Fake()
    with SessionLocal() as db:
        first = fetch_daily(db, date(2026, 1, 1), provider)
        second = fetch_daily(db, date(2026, 1, 1), provider)
        assert first.id == second.id
        assert provider.calls == 1
        with pytest.raises(RateUnavailable):
            fetch_daily(db, date(2026, 1, 2), provider)


def test_node_allowlist_and_private_key_refusal(monkeypatch):
    with pytest.raises(ValueError, match="not allowed"):
        BitcoinCore().call("sendtoaddress")
    monkeypatch.setattr(BitcoinCore, "call", lambda self, method, params=None: {"private_keys_enabled": True})
    with pytest.raises(ValueError, match="private keys disabled"):
        BitcoinCore("hot").wallet_data()


def test_node_deduplication_and_reconciliation(owner, monkeypatch):
    wallet = new_account(owner, "Cold storage", "BITCOIN", "125000", "bitcoin_wallet")
    tx = {
        "txid": "abc",
        "vout": 0,
        "category": "receive",
        "amount": "0.00125000",
        "confirmations": 6,
        "time": 1700000000,
    }

    def rpc(self, method, params=None):
        return {
            "getwalletinfo": {"private_keys_enabled": False},
            "getbalances": {"mine": {"trusted": "0.00125000", "untrusted_pending": "0.00000001"}},
            "listtransactions": [tx, tx],
        }[method]

    monkeypatch.setattr(BitcoinCore, "call", rpc)
    connection = post(owner, "/node/wallets", {"wallet": "watch", "account_id": wallet})
    result = owner.get(f"/api/node/wallets/{connection['id']}/reconcile").json()
    assert result["difference"] == "0"
    assert result["balance_bitcoin"] == "125000"
    assert result["pending_bitcoin"] == "1"
    assert len(result["transactions"]) == 1


def test_public_price_provider_parses_precise_decimal_and_handles_unavailable(monkeypatch):
    import httpx
    from app.prices import CoinGecko

    client = httpx.Client

    def response(request):
        if request.url.params.get("date") == "01-01-2026":
            return httpx.Response(
                200, text='{"market_data":{"current_price":{"usd":120000.123456789}}}', request=request
            )
        return httpx.Response(429, request=request)

    monkeypatch.setattr(
        "app.prices.httpx.Client", lambda **kwargs: client(transport=httpx.MockTransport(response), **kwargs)
    )
    value, observed = CoinGecko().daily(date(2026, 1, 1))
    assert value == "120000.123456789"
    assert observed == "2026-01-01T00:00:00+00:00"
    with pytest.raises(RateUnavailable):
        CoinGecko().daily(date(2026, 1, 2))
