# Appalachian Bitcoin

**Beta version for testing.**

Appalachian Bitcoin is a personal finance manager that runs on your own computer. Input your
paychecks, bills and everyday spending, so you can analyze what's actually happening and make
wise decisions. Easily toggle between using dollars as a measuring stick or bitcoin.

There is no cloud account, no telemetry and no third-party analytics. Your ledger is one file on
your computer. This repository holds the source code and fictional examples only: cloning it
never copies anyone's ledger or login. See [source privacy](docs/source-privacy.md).

Website and in-browser demo: [appalachianbitcoin.com](https://appalachianbitcoin.com)

## Where things stand

- **Mac app (new).** A real Mac program: download it, drag it to Applications and double-click
  it. No Docker, no terminal. It is a beta for Macs with Apple silicon (M1 or newer) on macOS 11 or newer, and is
  not yet signed, so the first time you open it the Mac says it can't be opened. Go to
  **System Settings → Privacy & Security** and click **Open Anyway**. You only do this once.
  Download it from [Releases](https://github.com/evenkeel/appalachian-ledger/releases) or the
  website. How it is built: [desktop/README.md](desktop/README.md).
- **Windows, Intel Macs and home servers.** Until their apps exist, run it with Docker (below).
  A Windows app and automatic updates are next.
- **The interface.** Every screen has been rebuilt as one dense dashboard (see the
  [design brief](docs/cockpit-design.md)). The previous interface is still reachable at
  `/legacy.html` on the same ledger until it is removed.
- **Not yet independently reviewed.** Each release is tested, but there has been no outside
  security or accounting audit. Keep backups.

## What it does

- **Dashboard:** checking forecast, bills, stack and stack rate, spend pace, cards and debt,
  allowances, cost of living, spending bridge, money flow, and warning lights that say what
  needs attention.
- **Activity:** every transaction, with keyboard entry (`N` new, `/` search, `J`/`K` move,
  `E` correct). Corrections never erase history: they post a reversal.
- **Spending:** where the money went, with drill-down, month and year history.
- **Bills:** what is due and when; pay a bill, or destroy it (cancel it or pay it off for good).
  See [bills](docs/bills.md).
- **Stack:** bitcoin bought, and the stack rate: how much of your income becomes bitcoin.
- **Markets:** live, resizable price charts and watchlists for bitcoin, gold, stocks and
  indexes, with bitcoin's live order book. See [markets](docs/markets.md).
- **Accounts:** checking, savings, cash, cards, loans, brokerage holdings and bitcoin wallets.
- **Retirement:** how long your savings would last (the runway), worked out from your own
  ledger, with the bitcoin growth rate you choose shown openly. See [retirement](docs/retirement.md).
- **Learn:** how the ledger thinks about money.
- **Settings:** prices, appearance, exports, and encrypted backup and restore.

Dollars and bitcoin are both first-class units. Bitcoin amounts follow BIP-177:
**1 bitcoin is one base unit; 100,000,000 bitcoin = 1 legacy BTC.** Amounts show with a prefix
(`₿125,000`); legacy amounts are labelled (`0.00125000 BTC`). Original dollar cents and bitcoin
amounts are always kept. Bitcoin figures for past spending use that day's real price, never
today's; missing prices stay visibly missing rather than being guessed. See [prices](docs/prices.md).

## Your data

- Your whole ledger is one file on your computer. On the Mac app it is in
  `~/Library/Application Support/com.appalachianbitcoin.desktop/`.
- **Settings → Backup** makes an encrypted backup file. Keep copies off the computer.
  See [backup and restore](docs/backup-and-restore.md).

## Run it with Docker (Windows, Intel Macs, servers)

Requires Docker Desktop (or Docker Engine) with Compose v2.24.4+.

```sh
cp .env.example .env
chmod 600 .env
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080) and create your account. Records persist in
the `ledger-data` volume. To stop: `docker compose down` (never add `--volumes`: it erases the
ledger). After updating the code, run `docker compose up --build -d` again.

To reach one ledger from your phone and other devices over your private network, use
`python3 scripts/host.py node --bind YOUR_PRIVATE_IP --start` and follow
[browser hosting](docs/browser-hosting.md).

## The fictional demo

**The person is fictional. The bitcoin prices are real.** The demo follows one made-up man,
25 today, an electrician who rents in the city, for five years: every paycheck, every bill,
everyday spending, a credit card, a car loan, and a little bitcoin bought every payday. His life
is written as a plan in [`backend/app/demo_plan.py`](backend/app/demo_plan.py). Every bitcoin
figure uses the real Coinbase BTC-USD daily close for its day, saved in
[`backend/app/demo_data/btc_usd_daily.json`](backend/app/demo_data/btc_usd_daily.json).

Try it in your browser at [appalachianbitcoin.com/demo](https://appalachianbitcoin.com/demo/),
or run a separate demo installation on port 8081:

```sh
docker compose -p appalachian-ledger-demo \
  -f docker-compose.yml -f deployment/demo.compose.yml up --build -d
```

Create a local owner there and click **Or load the fictional demo** on the empty dashboard.
Keep real records in a separate installation. `make demo-prices` moves the demo's five years
forward to the newest prices; `make website` rebuilds the website and its demo
(see [the website](website/README.md)).

## Develop

Use Python 3.12+ and Node 24.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
npm --prefix frontend ci
make dev-backend     # API on 127.0.0.1:8000, reloads on change
make dev-frontend    # interface on 127.0.0.1:5173, proxies /api
```

`sh scripts/start-testing.sh` instead builds the interface and serves it with the API on one
port (127.0.0.1:5173), with its ledger in `data/testing.db`.

The engine reads its settings from the environment: `DATABASE_URL`, `APP_ORIGIN` and
`ALLOWED_HOSTS` (exact addresses the interface is served from), `COOKIE_SECURE=true` behind
HTTPS, `DEMO_ENABLED`, and `PRICE_WORKER_ENABLED`. Never expose Bitcoin Core RPC publicly.

To build the Mac app: see [desktop/README.md](desktop/README.md). GitHub builds it on every pull
request that touches the app, and a version tag (`v0.1.0-beta.1`) publishes it as a pre-release.

### Tests and checks

```sh
make test     # pytest, interface tests, ruff, and the database upgrade
```

The tests cover exact money and rounding, the balanced journal and its database guards,
income, spending, transfers, debts, historical prices, budgets, sign-in and CSRF protection,
imports, encrypted backup and restore, the fictional demo, and every screen of the interface.
External price services are mocked; the suite needs no network.

## Repository map

```text
backend/app/          The engine: API, sign-in, exact money, ledger, reports, prices, backup
backend/tests/        Engine tests
frontend/src/         The interface (React); app/ is the current one, components/ the legacy one
database/migrations/  Database upgrades and the journal's guards
desktop/              The Mac app: Tauri window, bundled engine, icons
deployment/           Dockerfiles, nginx and Caddy for Docker installs
website/              appalachianbitcoin.com and its in-browser demo
docs/                 Design notes and how each part works
.github/workflows/    Checks on every push; the Mac app build
```

More: [architecture and accounting](docs/architecture.md) ·
[dashboard data](docs/dashboard-api.md) · [Bitcoin Core](docs/bitcoin-core.md) ·
[Umbrel plans](docs/umbrel.md) · [monetary lens roadmap](docs/monetary-lens-roadmap.md)

## Known limits

- One owner per ledger, one engine process, USD and bitcoin only (no other currencies, tax lots
  or trading). In-app backups are limited to 32 MB.
- Bitcoin Core: read-only review and balance comparison only; no automatic import of on-chain
  history yet.
- Investments: live stock and ETF quotes and unrealized gain or loss; no realized returns,
  splits or historical backfill.
- The desktop app is Mac-only (Apple silicon) and unsigned for now.

## Next

1. Windows app and automatic updates for the desktop app.
2. Signing, so Macs and Windows open it without a warning.
3. Retire the legacy interface.
4. Bitcoin Core import with review and matching.
5. An independent security and accounting review before wider release.

Released under the [MIT License](LICENSE). shadcn/ui's Button pattern is used under its MIT
license; see [third-party notices](THIRD_PARTY_NOTICES.md).
