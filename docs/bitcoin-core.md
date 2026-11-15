# Optional Bitcoin Core connection

Appalachian Bitcoin works without a node. The node connection observes an existing watch-only wallet and never creates a spending wallet or requests private keys.

Create/load a Bitcoin Core wallet with private keys disabled using your existing node administration workflow. Do not import seeds, private descriptors, or private keys into Ledger. Set the host, port and dedicated RPC authentication values in `.env`; restrict file permissions with `chmod 600 .env`.

Use Bitcoin Core `rpcauth` and a dedicated user, then restrict that user in `bitcoin.conf`:

```ini
# Generate the rpcauth credential with Bitcoin Core's rpcauth.py utility.
# Do not copy example credentials from documentation.
rpcwhitelist=ledger:getblockchaininfo,getwalletinfo,getbalances,listtransactions
rpcwhitelistdefault=1
```

`rpcwhitelistdefault` can affect other RPC users; add explicit policies for your existing clients. Configure `rpcbind` and `rpcallowip` for a private local/container network only. Do not forward port 8332 to the public internet. The adapter uses HTTP JSON-RPC on that trusted network; remote nodes require a secure local tunnel/private network. Do not send these credentials across an untrusted network.

In Docker, `localhost` inside the backend refers to the backend container. Use a private service hostname for a node on the same Docker network, or the host's supported private address. Docker Desktop commonly exposes `host.docker.internal`; Linux requires an explicit host gateway or private network configuration. The application does not open or reconfigure your node's listener.

In **Settings → Bitcoin Core**, check connection status, then select a bitcoin ledger account and enter the existing wallet name. Connecting validates `private_keys_enabled=false`. **Reconcile** displays confirmed balance, pending balance, ledger balance, difference and recent transactions. Unconfirmed activity can explain differences. Opening balances may already include historical receipts; do not import them twice.

This release deduplicates RPC list entries and shows the latest 1,000 entries. It does not automatically post node transactions or reconcile tax lots, fees or reorganizations. Record and categorize transactions manually after review. Full-history synchronization and on-chain-to-ledger matching are next-phase features and require regtest coverage before activation.
