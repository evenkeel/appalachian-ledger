"""Read-only Bitcoin Core adapter. Environment credentials; strict method allowlist."""

import hashlib
import json
import os
from decimal import Decimal
from urllib.parse import quote
import httpx
from .money import btc_to_bitcoin

ALLOWED = {"getblockchaininfo", "getwalletinfo", "getbalances", "listtransactions"}


class BitcoinCore:
    def __init__(self, wallet=""):
        self.host = os.getenv("BITCOIN_RPC_HOST", "")
        self.port = int(os.getenv("BITCOIN_RPC_PORT", "8332"))
        self.wallet = wallet

    def call(self, method, params=None):
        if method not in ALLOWED:
            raise ValueError("RPC method is not allowed")
        if not self.host or not os.getenv("BITCOIN_RPC_USER") or not os.getenv("BITCOIN_RPC_PASSWORD"):
            raise ValueError("Configure Bitcoin Core host and read-only RPC credentials in the environment")
        # Host is trusted administrator configuration, never supplied through an API request.
        suffix = "/wallet/" + quote(self.wallet, safe="") if self.wallet and method != "getblockchaininfo" else ""
        url = f"http://{self.host}:{self.port}{suffix}"
        try:
            response = httpx.post(
                url,
                auth=(os.environ["BITCOIN_RPC_USER"], os.environ["BITCOIN_RPC_PASSWORD"]),
                json={"jsonrpc": "2.0", "id": "ledger", "method": method, "params": params or []},
                timeout=15,
            )
            response.raise_for_status()
            data = json.loads(response.text, parse_float=Decimal)
            if data.get("error"):
                raise ValueError("Bitcoin Core RPC rejected the request; check wallet and permissions")
            return data["result"]
        except (httpx.HTTPError, KeyError):
            raise ValueError("Bitcoin Core is unavailable; check local connection settings") from None

    def status(self):
        chain = self.call("getblockchaininfo")
        return {
            "connected": True,
            "chain": chain["chain"],
            "blocks": chain["blocks"],
            "headers": chain["headers"],
            "sync_progress": str(chain["verificationprogress"]),
            "initial_block_download": chain["initialblockdownload"],
        }

    def wallet_data(self):
        info = self.call("getwalletinfo")
        if info.get("private_keys_enabled", True):
            raise ValueError("Only wallets with private keys disabled are supported")
        balances = self.call("getbalances")
        # Descriptor watch-only wallets use "mine"; legacy wallets may use "watchonly".
        groups = [balances[k] for k in ("mine", "watchonly") if k in balances]
        trusted = sum(btc_to_bitcoin(str(g.get("trusted", "0"))) for g in groups)
        pending = sum(btc_to_bitcoin(str(g.get("untrusted_pending", "0"))) for g in groups)
        rows, seen = [], set()
        for item in self.call("listtransactions", ["*", 1000, 0, True]):
            identity = json.dumps(
                [self.wallet, item["txid"], item.get("vout"), item["category"]], separators=(",", ":")
            )
            key = "node:" + hashlib.sha256(identity.encode()).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "key": key,
                    "txid": item["txid"],
                    "category": item["category"],
                    "bitcoin": str(btc_to_bitcoin(str(item["amount"]))),
                    "fee_bitcoin": str(btc_to_bitcoin(str(item.get("fee", "0")))),
                    "confirmations": item.get("confirmations", 0),
                    "time": item["time"],
                }
            )
        return {
            "balance_bitcoin": str(trusted),
            "pending_bitcoin": str(pending),
            "transactions": rows,
            "history_limit": 1000,
            "private_keys_enabled": False,
            "scanning": bool(info.get("scanning", False)),
        }
