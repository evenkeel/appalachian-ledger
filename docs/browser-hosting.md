# One browser interface, two places to run it

Appalachian Bitcoin runs on your computer or on your private node/server. Open it
in a browser on Windows, macOS, or a phone. The host stores the ledger in SQLite;
browsers connect to that one ledger. A Bitcoin node is optional. This is a
single-owner application; signing in on another device uses the same owner.

## On this computer

### Mac background startup (this checkout)

The local Python server can run automatically at login without Docker. After
installing the project's dependencies and building the frontend, stop any existing
testing server, then run from this checkout:

```sh
.venv/bin/python scripts/macos-service.py install
```

Open <http://localhost:5173>. This uses the existing `data/testing.db` ledger,
binds only to this computer, and restarts the server if it exits. It runs after
login without an open terminal. Sleep pauses availability until the laptop wakes.
Do not move this checkout or remove its virtual environment while using the service.
Changing from `127.0.0.1` to `localhost` may require signing in again because browser
cookies belong to the hostname. Both addresses serve the same ledger.

After code updates, build the frontend with `npm --prefix frontend run build`, then
restart the service. Migrations run on API startup. Make a backup before updating.

```sh
.venv/bin/python scripts/macos-service.py status
.venv/bin/python scripts/macos-service.py restart
.venv/bin/python scripts/macos-service.py uninstall
```

Uninstall removes automatic startup and stops the server; it retains the ledger.
Logs are in `data/server.log` and `data/server-error.log`. macOS configuration lives
in `~/Library/LaunchAgents/com.appalachianbitcoin.ledger.plist`. Do not also run
`scripts/start-testing.sh` while this service is running: they use the same port.

### Docker alternative

Install Docker with Compose 2.24.4+ and Python 3.12+. From this repository, run:

```sh
python3 scripts/host.py computer --start
```

On Windows, use `py -3 scripts/host.py computer --start`. Open
<http://localhost:8080> and create your owner account. The server binds to loopback,
so other devices cannot connect. Docker keeps it running after the terminal closes
and restarts it when Docker starts. It works without internet except for external
price feeds and optional network integrations.

## On my node or home server

Run these commands **on the server**, with Docker Compose 2.24.4+ and Python 3.12+.
Reserve a stable private IPv4 address for it in your router. For example:

```sh
python3 scripts/host.py node --bind 192.168.1.20 --start
```

Replace the example with your server's actual LAN or private VPN address. Open
`https://192.168.1.20:8443` from devices on that network after trusting the
certificate below. Use `--port 443` to omit the port from the browser address.
Only the HTTPS gateway is published; the frontend and API remain inside Docker.
Authentication, exact Host/Origin checks, and secure session cookies remain enabled.

For a private DNS name, add `--host ledger.home.arpa` and configure your router's
DNS to resolve it to the bind address. The helper accepts private DNS suffixes
`.home.arpa`, `.local`, and `.internal`; it does not create DNS records.

### Trust the private HTTPS certificate

Caddy creates a private certificate authority stored in the persistent `ledger-tls`
volume. After startup, export **only its public root certificate**:

```sh
docker compose --env-file .env.hosting -f docker-compose.yml -f deployment/private.compose.yml cp gateway:/data/caddy/pki/authorities/local/root.crt ./ledger-root.crt
```

Transfer this certificate from your server through a trusted local channel. Install
it as a trusted certificate authority on each device/browser that will connect.
On macOS, import it into Keychain Access and trust it for SSL. On Windows, import
it into Trusted Root Certification Authorities for your user. On iOS, install the
certificate profile and enable its trust in Settings → General → About →
Certificate Trust Settings. Other devices and browsers have their own certificate
settings. Only trust a certificate obtained from your own server.

Reload the address and confirm the browser trusts HTTPS before creating the owner
or signing in. Do not bypass certificate errors. Preserve the TLS volume across
updates so clients keep trusting the same authority. This manual trust step is
required with Caddy's internal CA in Docker; see the
[Caddy HTTPS documentation](https://caddyserver.com/docs/automatic-https).

Complete first-owner setup before granting other people network access. Keep this
on your private network; this deployment does not configure public internet access
or router port forwarding. For access while away, connect to your private VPN and
use an address/name reachable through that VPN.

This is generic private-server hosting, not an Umbrel app-store package. Umbrel
proxy integration and real-device verification remain separate work; see
[the Umbrel roadmap](umbrel.md). Bitcoin Core runs as a separate service. Configure
its optional read-only connection using [the Bitcoin Core guide](bitcoin-core.md).

## Save a home-screen shortcut

In a supporting browser, choose **Install app**, **Add to Dock**, or **Add to Home
Screen**. You can also keep using a normal browser tab. The manifest includes the
app name and icons; installation options depend on the browser and platform.

The host must be running and reachable to use the ledger. No service worker caches
financial data, and there is no offline editing or synchronization between separate
installations. A shortcut points to the same host and ledger as its browser address.

## Configuration, updates, and backups

The helper creates `.env.hosting` with restricted file permissions where supported,
and refuses to overwrite an existing file. It leaves `.env` alone. Choose another
file with `--config path` if needed. Add any optional RPC/provider settings to that
file; Docker uses `.env.hosting` instead of `.env` with the commands below.

Reuse the generated configuration for future starts and updates. For local hosting:

```sh
docker compose --env-file .env.hosting -f docker-compose.yml up --build -d --wait
```

For node/server hosting:

```sh
docker compose --env-file .env.hosting -f docker-compose.yml -f deployment/private.compose.yml up --build -d --wait
```

Use the same command prefix with `logs`, `ps`, or `down` instead of
`up --build -d --wait` to inspect or stop it. Never add `--volumes` to `down` when
retaining records. The existing `ledger-data` volume is reused by both modes in
the same Compose project; switching hosting modes does not copy or synchronize
databases. The native beta's `data/testing.db` remains a separate installation.
Use the app's encrypted backup/restore to move a ledger between installations.

Make an encrypted backup in Settings before updates. A single server update serves
all connected browsers; reload open tabs afterward. Running both hosting modes
as separate projects creates separate ledgers. Do not share a live SQLite database
between backend instances. See [backup and restore](backup-and-restore.md).
