# Appalachian Bitcoin

**Beta version for testing.**

A self-hosted personal finance application and project of Appalachian Bitcoin. React, TypeScript, Tailwind CSS, shadcn/ui component patterns and Recharts power the interface; FastAPI, SQLAlchemy, Alembic and SQLite power the local ledger.

The repository contains source and fictional examples only. Cloning it does not
copy a personal ledger or login. See [source privacy](docs/source-privacy.md) for
safe remote development and transferring encrypted backups separately.

Every API startup applies pending database migrations before loading ledger data or starting background workers. A failed migration stops startup. Keep a backup before updating. Local development and testing launchers reload the API when backend code or migrations change; restart the testing launcher after frontend edits so it rebuilds the interface. Docker installations require `docker compose up --build -d` after code updates to rebuild and restart both services.

## The new interface (in progress)

The app is being rebuilt as a dense dashboard; see the [design brief](docs/cockpit-design.md). The front page is the new interface: sign-in, navigation, and a dashboard with Checking forecast, Bills (pay, destroy, pay off), Stack with stack rate, Spend pace, Cards & debt, Allowances, alert lights, Cost of living, Spending bridge and Money flow; a Spending screen with drill-down; a Transactions screen with keyboard entry (`N` new, `/` search, `J`/`K` move, `E` correct); Bills, Stack, Accounts and Settings screens; a [Markets](docs/markets.md) screen of live, resizable price charts and watchlists for bitcoin, gold, stocks and indexes, with bitcoin's live order book and depth chart; and Learn, which explains how the ledger thinks about money. Every screen now lives in the new interface, including Retirement. The previous interface is still reachable at `/legacy.html`, on the same ledger, until it is removed. The data contract for the dashboard is in [docs/dashboard-api.md](docs/dashboard-api.md).

Existing ledgers upgrade in place: migration `0014_dashboard` only adds tables and two nullable columns, and `backend/tests/test_ledger_migration.py` proves the journal, balances and every earlier table are unchanged by it. Keep a backup before updating all the same. An encrypted backup made by an older version restores too: it is upgraded in a temporary copy first, and the ledger is replaced only if every check passes.

USD and bitcoin are first-class units of account. The new-installation reporting default is USD; existing preferences are retained. Bitcoin terminology follows BIP-177: **1 bitcoin is one native base unit; 100,000,000 bitcoin = 1 legacy BTC.** Native amounts display with a prefix (`₿125,000`); legacy amounts remain explicitly labeled (`0.00125000 BTC`). Original USD cents and native bitcoin amounts are always retained. The application uses the proposal's terminology explicitly; it does not imply universal adoption of BIP-177.

## Run with Docker Compose

### Browser access on your computer or node

Use one web interface across Windows, macOS, and phones. Run
`python3 scripts/host.py computer --start` for localhost access, or
`python3 scripts/host.py node --bind YOUR_PRIVATE_IP --start` on a private server
for HTTPS access from other devices. Both require Docker Compose 2.24.4+ and
Python 3.12+. On Windows, use `py -3` instead of `python3`.

The server holds one ledger; devices sign in to that same ledger. Optional
home-screen installation adds a shortcut without a separate desktop release.
Private HTTPS requires trusting the server's certificate on each device. Follow
[browser hosting](docs/browser-hosting.md) for certificate setup, updates, and backups.

### Manual localhost setup

Requires Docker Engine/Desktop with Compose v2.24.4+.

```sh
cp .env.example .env
chmod 600 .env
docker compose up --build -d
```

Open [Appalachian Bitcoin](http://localhost:8080). Create your local owner account with a password of at least 12 characters. No default credentials, cloud account or Bitcoin node are required. Migrations run automatically before the API starts. The frontend binds to **127.0.0.1:8080**; the backend has no published port. Records persist in the `ledger-data` named volume.

To stop: `docker compose down`. Do not add `--volumes` unless you intend to erase the ledger. For logs: `docker compose logs backend`. Do not run more than one backend worker or share a database across backend instances.

## Explore the fictional demo

Run a separate project and volume on port 8081:

```sh
docker compose -p appalachian-ledger-demo \
  -f docker-compose.yml -f deployment/demo.compose.yml up --build -d
```

Open [the isolated demo](http://localhost:8081), create a local owner, and click **Load fictional demo** on the empty Overview. The demo includes cold storage, a spending wallet, checking, savings, brokerage, a home, a mortgage, six months of income/expenses/transfers, valuations and category budgets. **Every record and exchange rate is fictional.** It works offline and cannot seed a nonempty ledger.

Alternatively, set `DEMO_ENABLED=true` in `.env` before starting an empty normal installation. Keep real financial records in a separate installation. There is no automatic demo login or shared demo password.

## Quick bills and expenses

**Expenses → Analysis** compares spending with the preceding calendar month. It opens in dollars, with a historical bitcoin toggle and shared account/category filters. Spending pace compares matching elapsed days while retaining the previous month's full gray line for context. The spending bridge explains category increases/decreases; the category explorer switches between six-month trends and a spending map. Expand **When you spent** for the daily calendar. Select categories or dates to inspect and edit their transactions, or expand exact-value tables. Missing purchase-date conversions remain unavailable. These views describe recorded expenses, not forecasts or proof that unrecorded spending did not occur.

Open **Expenses**, directly below Income, for one **Analysis** workspace. **Upcoming expenses** shows exactly seven dots, Sunday through Saturday, for one week at a time; light blue means no planned expenses, while larger orange dots represent larger native-currency totals. Select a dot to inspect its expenses in a popup, or use the overdue shortcut for unpaid earlier dates. Week arrows show earlier or later weeks, including across month boundaries. The total covers the displayed week. Recorded expenses and Cost history expand below the charts. Overview keeps a compact linked summary of payments due in the next seven days and overdue items. Dollar and bitcoin totals remain separate. **Add expense → Payment → Upcoming**, with **Repeats → Once**, saves a future cost without posting spending; after confirmation it leaves the upcoming list. The dots show the next unpaid occurrence of each recurring bill, rather than projecting all later repeats.

Use **Add expense** for both paid and upcoming expenses. Choose **Payment → Paid** to record spending now, or **Upcoming** to save planned spending without posting a payment. **Repeats** offers Once, Weekly, Monthly, Quarterly, Every 6 months, and Yearly. One Add expense action serves the Analysis workspace; there are no separate Upcoming, History, or Cost history navigation tabs. Once saved, **Record → Confirm payment** records a planned occurrence; the payment date defaults to today and variable amounts can be adjusted before confirming. Each confirmation advances one scheduled occurrence. Calendar schedules retain their original day after short months (January 31 → February 28 → March 31 for monthly repeats).

Click an account card or its name to see the bills paid with that account in a modal. Close it to return to the same place on the page. For example, a Spotify bill assigned to Prime Card appears when you open Prime Card. Adding a bill from there preselects that account.

**Cost history** shows actual monthly expense totals in dollars and bitcoin, with search and category filters (for example, groceries or electricity). Each bill also has a **History** button with its recorded payments, including earlier prices after its scheduled amount or name changes. Changes compare the previous recorded month; usage and purchase changes are included. The current month may be incomplete.

Expense bitcoin equivalents use the **purchase date**, never the date entered or today's spot quote. Because entries currently store a date without a purchase time, these are labelled daily references (Coinbase UTC daily close, CoinGecko daily reference, or a manual dated rate), not exact intraday prices. Source, rate, and reference timestamp are retained with each immutable cost observation. Missing conversions remain unavailable until an exact-date historical reference is saved; the first saved observation is never repriced by later rates or provider changes. Existing payments are filled from their saved journal rates or available purchase-date references at startup. New daily price synchronization completes eligible gaps automatically. Corrections preserve the original conversion rate when the purchase date stays the same; reversals disappear from active cost totals. Snapshot equivalents use decimal arithmetic and the app's whole-bitcoin-unit rounding. JSON journal exports include these observations.

Choose **Paid** with a repeating frequency to record an expense now and prepare the next occurrence together. In Transactions, **Repeat expense** fills the previous expense's details with today's date; save to record it again. Edit recurring bills to update their details or next due date, or remove them to stop repeating. Saved bills require confirmation for every payment; they do not initiate payments or post automatically. Repeated requests for the same bill occurrence return the existing payment instead of duplicating it.

## Default payment methods

In **Settings → Default payment methods**, choose a payment account for each expense category and click **Save payment defaults**. For example, assign Gemini Credit Card to Groceries. Selecting that category on a new expense suggests its account; you can override it for that expense. Category shortcuts also use the default unless opened from a specific account. Existing transactions, repeated expenses, and saved bills retain their accounts. Archived accounts are never suggested. Choose **No default** and save to clear a category's preference.

## Arrange your cards

Use the grip on a card to drag it into a different position. This works with mouse and touch on Accounts, Assets & liabilities, upcoming bill cards, and Overview's balance cards. You can also focus a grip and use arrow keys to move one position, or Home/End to move to the start/end. Changes save automatically with your local owner preferences and survive reloads and server restarts. Each grid keeps its own order. New cards appear after saved cards; **Reset order** restores the default arrangement (including due-date order for bills). Financial balances, schedules, and history are unchanged by arranging cards.

## Where to manage things

**Accounts** is the primary home for bitcoin wallets, checking, savings, cash, brokerage/stock/ETF accounts, and credit cards. **Assets & liabilities** automatically shows property, vehicles, other valued assets, loans, mortgages, and other longer-term liabilities from the same ledger. Existing records appear without a separate linking step; valuation history is optional. Use **Add asset** or **Add debt** on that page to create a record of the appropriate type. No balances or transactions are copied between pages, and net worth/reporting still use every underlying account.

Manage the account name, archive status, and consumer debt exclusion from its card on its primary page. Archived cards are hidden by default on Accounts and Assets & liabilities; select **Show archived** to review or reactivate them. On Assets & liabilities, use **Update value** for property or **Record payment** for debt. Wallets and investments stay manageable in Accounts, while all debts and assets remain included in Overview totals.

## Transfer between your accounts

Use **Transfer** on Overview or Accounts, or **Transfer from this account** on a wallet or cash account card. The compact form fills today's date and a description automatically. A card shortcut selects the source account; when there is only one other account in the same currency, it suggests that destination. For River → Bitkey, enter the bitcoin amount and click **Record transfer**. You can enter whole native bitcoin units or decimal legacy BTC, with exact conversion. Same-currency transfers need only one amount. For a cross-currency transfer, enter the actual amount received as well. Date and notes are optional details. Transfers update both account balances without counting as income, spending, or budget expenses; record any fee separately.

Account actions follow the account type: wallets, checking, savings and cash offer **Transfer**; tracked brokerage/stock/ETF accounts offer **Move cash**, showing only uninvested cash. Brokerage withdrawals cannot exceed that cash balance; moving securities requires editing holdings rather than transferring the account's market value. Set up holdings and cash before using Move cash on an untracked investment account.

Credit cards offer **Make payment**, with a **Pay from account** selector. Loans and mortgages offer **Record payment**. Choose a paying account and enter the total; if part of it is interest or fees, enter that portion and its expense category. The remainder reduces principal as a transfer. Both entries save together, and only interest/fees consume expense budgets. Property, vehicles and other valued assets offer **Update value**, which records an equity valuation without income or spending.

## Balances and spending

The overview leads with **total net worth in bitcoin**, followed by its smaller USD equivalent. Each overview category has its own swap button for switching between bitcoin and USD. Trend categories remember their own currency choices while the overview stays open. Separate native-currency balances remain visible for bitcoin, USD cash, other assets, and liabilities. Combined net worth is an estimated valuation, not a claim to own that amount of bitcoin.

A single chart switches between bitcoin and USD for income, expenses, debt, and net worth. “Same lifestyle” holds a recorded month's dollar spending constant to isolate Bitcoin's exchange-rate effect. Prices are never fabricated and trends are not forced downward. Income and expense conversions prefer saved transaction-date rates, automatically use available exact-date references for missing snapshots, and label today’s fresh-quote conversions as estimates. Genuinely missing historical prices remain gaps; original amounts stay visible.

A dedicated **Income** page explains the calculation and provides payment entry, category totals, filtering, editing and reversal. **Accounts → Enter shares & ticker** supports automatic USD security quotes, fractional shares, cash, optional cost basis and unrealized gain/loss. See [income, holdings, and denomination comparisons](docs/holdings-and-income.md).

Overview's compact financial summary compares recorded expenses with income in one USD equivalent. **Spending pressure** reaches its redline at 100%; readings above it retain the actual percentage. **Classify expenses** assigns expense categories to fixed commitments, variable essentials, discretionary spending, or unclassified. Assignments persist and apply across category history. The summary shows the spending mix, cash surplus or shortfall, and the share of income left after expenses. Zero income or missing conversions leave the percentage unavailable. Current months are labeled **month so far**. Recorded burn rate averages up to three completed months and annualizes that average; transfers and investment value changes are excluded. These are observations based on recorded activity, not budget targets or forecasts.

**Budgets** now compares monthly spending with USD category plans over 3–24 months, highlights unbudgeted spending, and provides category-specific expense entry. **Copy previous month** fills missing USD plans while preserving existing allowances and legacy bitcoin budgets.

**Savings & investing** tracks bitcoin buys, savings and investment funding with monthly charts, account filters, exact monthly figures and editable activity. **Bitcoin buy** accepts the actual dollars exchanged and whole bitcoin units. Purchases remain transfers, so they do not consume expense budgets. See [budget, savings and investing tracking](docs/tracking.md).

In **Manage account** on Accounts or Assets & liabilities, turn on **Exclude from consumer debt** for a non-mortgage debt that should not count toward the Overview gauge. The choice persists with the account and affects the consumer debt gauge in current and historical views. Its balance still counts toward total debt and net worth. Mortgages remain automatically excluded.

## First real records

1. Create accounts in their original currency with dated opening balances. USD accepts two decimals; bitcoin accepts whole units. Positive liability balances mean debt owed. Dollar-only records work without price data.
2. In Settings → Prices, select Coinbase and enable Automatic prices, or stay offline with manual rates. Current quotes refresh every five minutes; completed daily history syncs automatically. See [pricing behavior](docs/prices.md).
3. Record income and expenses with matching categories. Conversions use an exact-date reference. After syncing history, Review missing conversions lets you save dated conversions without changing original entries. Today’s daily close is unavailable until the UTC day ends, so display reports can use a labeled current-quote estimate. Existing saved conversions stay fixed.
4. Use transfers for movements between accounts, including mortgage principal. Cross-currency transfers require the actual received amount. Record fees and mortgage interest separately as expenses.
5. Set monthly category budgets in USD. Cards show only recorded spending in bitcoin, alongside dollar spending, the dollar allowance, and dollars remaining. Prior months remain available through the month selector. Existing bitcoin allowances are retained without assuming a dollar conversion; use “Set USD budget” where no USD plan exists.
6. Switch between bitcoin and USD on Overview, or choose a denomination in Reports. Select an investment account in Reports to compare value history and net additions. Legacy BTC remains available through the reporting preference in Settings.
7. Export records and make encrypted backups in Settings.

## Implemented

- Ten screens: Overview, Accounts, Income, Expenses, Transactions, Budgets, Savings & investing, Assets & liabilities, Reports, Settings. Responsive navy/mist design, custom mountain mark and persisted dark/light preference.
- One local owner; Argon2id password hashing; expiring hashed sessions; HttpOnly/SameSite cookies; CSRF, Origin and Host checks; persistent login throttling; password change/session revocation.
- Exact integer/Decimal accounting with independently balanced postings per currency. SQLite triggers seal journals and protect audit events and exchange-rate rows. Edits/deletions create immutable reversals.
- Account creation, renaming, archiving and auditable adjustments. Original ownership and estimated values in either unit remain distinct.
- Categorized income/expense, same/cross-currency transfers, search, account/type/currency/month filtering, notes, edits and reversals.
- USD category budgets, historical bitcoin spending, dollar actual/remaining amounts, progress indicators and prior-month review. Older currency-specific plans remain stored and accessible through the original API.
- Linked assets/debts, chronological total valuations, and share-based brokerage holdings with automatic quotes and optional cost basis; appreciation posts to equity.
- Separate native-currency balances, monthly cash flow, expense trends, category spending and account balance history. Combined net worth leads the Overview with clearly labeled valuation estimates.
- Automatic Coinbase current quotes and completed daily history, optional CoinGecko, manual rates, resumable local caching, freshness checks and explicit gaps. Reviewed missing conversions use immutable, audited attachments.
- Atomic CSV imports with duplicate detection and import audit; CSV transaction export and complete JSON journal export.
- AES-256-GCM/scrypt encrypted SQLite backups and verified restore that revokes sessions.
- Bitcoin Core read-only method allowlist, private-key-disabled wallet checks, sync status, balances, latest-1,000 transaction retrieval/deduplication and balance reconciliation.
- Optional six-month fictional demo, migrations, Dockerfiles, localhost Compose deployment, documentation and CI configuration.

## Scope and remaining work

This is a functional initial release, not an independently audited accounting product. The following are deliberately not claimed as complete:

- **Original currencies:** USD and native bitcoin only. Legacy BTC is a reporting/RPC compatibility unit. Other fiat currencies, multi-currency FX gains and tax lots are future work.
- **Node ingestion:** read-only review and balance comparison work in adapter tests. Automatic posting/matching, full-history pagination, reorg/fee handling and live-node/regtest verification remain incomplete. Never assume every wallet receipt is income or that historic receipts are absent from an opening balance.
- **Investment data:** live-polled USD stock/ETF quotes, share-based valuations and unrealized gain/loss are supported. No trading, tax lots, realized total returns, annualized/TWR/IRR calculations, automatic splits, historical equity backfill, amortization schedules, split transactions or automatically posted recurring transactions. Public quote availability and exchange delays depend on the provider.
- **Scale:** a single owner, one worker, serialized local requests, no pagination. In-app encrypted backup/restore is limited to 32 MB. No multi-user/cloud/remote-exposure configuration is provided.
- **History:** corrections restate their effective dates. Valuation-protected account history cannot be backdated; use a current adjustment. No closed-period accounting workflow.
- **Deployment verification:** Docker was not available in the implementation environment, so the containers and Compose startup have not been executed there. Native migrations, API tests, frontend build and browser workflows were verified. CI includes Compose build/start/HTTP smoke checks, but no remote CI run is claimed.
- **Umbrel:** the architecture is portable, but packaging and on-device verification are pending.

## Develop without Docker

For the local beta, run `sh scripts/start-testing.sh`. This builds the frontend and serves the app and API together at [the beta](http://127.0.0.1:5173); no separate development server is needed. Keep this process running while testing. Stop any previous beta API or Vite server before launching it. The first visit offers **Create account**; later visits offer **Log in**. Beta records persist in `data/testing.db`, separately from existing demo databases. Automatic price updates run with the server when enabled in Settings. Creating the account signs you in immediately; you can then add your first financial account. Demo loading is disabled in this personal beta; use the separate demo installation for fictional records.

Use Python 3.12+ and Node 24 LTS.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
npm --prefix frontend ci
.venv/bin/alembic -c database/alembic.ini upgrade head
```

In one terminal:

```sh
APP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173 \
PYTHONPATH=backend .venv/bin/uvicorn app.main:app \
  --host 127.0.0.1 --port 8000 --no-access-log
```

In another:

```sh
npm --prefix frontend run dev
```

Open [the Vite development app](http://127.0.0.1:5173). Vite proxies `/api` to FastAPI. For a disposable native demo, set `DATABASE_URL=sqlite:///./data/demo.db` for **both** migration and API commands, and set `DEMO_ENABLED=true` for the API process. Use a different database from your real ledger.

Changing `PORT` or serving behind a private TLS proxy also requires updating the exact `APP_ORIGIN` and `ALLOWED_HOSTS` values. For TLS deployments, set `COOKIE_SECURE=true`. The default HTTP cookie setting is for localhost only. Never expose Bitcoin RPC publicly. Protect `.env` and the live database using OS permissions and disk encryption.

## Tests and checks

```sh
.venv/bin/pytest -q
.venv/bin/ruff check backend database
.venv/bin/ruff format --check backend database
.venv/bin/alembic -c database/alembic.ini check
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

Backend tests exercise denomination identity, rounding and overflow, journals and database guards, income/expenses/transfers, liabilities, exact historical rates, net worth, budgets, valuations, authentication/CSRF/login limits, CSV deduplication/rollback, encrypted backup/restore/tampering, fictional demo and mocked provider/node adapters. Additional tests cover ownership classification, independent native-currency flows, actual exchange receipts, contribution-adjusted investment changes in both units, missing conversion snapshots, currency budgets, migration preservation, and backup integrity. Frontend tests cover exact money displays, reporting controls, original-currency filters, actual transfer receipts, and new/legacy budget forms.

See [verification notes](docs/verification.md) for the observed results and browser checks. External APIs are mocked in automated tests, not required to run the suite.

## Repository map

```text
backend/app/             API, auth, exact money, ledger, reports, adapters, backup
backend/tests/           pytest integration and unit tests
frontend/src/            React screens, forms, financial components and tests
database/migrations/     Alembic schema and immutable-journal guards
deployment/             Dockerfiles, nginx, startup, isolated demo override
docs/                   Architecture, backup, node, Umbrel and verification
.github/workflows/      Test/build/migration/Compose smoke CI
```

- [Architecture and accounting](docs/architecture.md)
- [Markets: live price charts](docs/markets.md)
- [Backup and restore](docs/backup-and-restore.md)
- [Bitcoin Core setup](docs/bitcoin-core.md)
- [Umbrel roadmap](docs/umbrel.md)

## Next development priorities

1. Execute the container smoke suite on Docker and test persistence/restore on both amd64 and arm64.
2. Add Bitcoin Core regtest integration, paginated on-chain history, reorg handling and an explicit review/match/import workflow.
3. Broaden historical-provider verification and consider multi-currency support only when needed; preserve original amounts and recorded conversion provenance.
4. Add pagination/query optimization, accessibility automation and broader browser end-to-end coverage.
5. Complete independent security/accounting review and Umbrel packaging before broader distribution.

Released under the [MIT License](LICENSE). shadcn/ui's Button pattern is used under its MIT license; see [third-party notices](THIRD_PARTY_NOTICES.md).

The [monetary lens and retirement roadmap](docs/monetary-lens-roadmap.md) maps the longer-term planning vision to the existing ledger and records incremental implementation decisions.

[Retirement scenarios and extended spending history](docs/retirement.md) documents planner inputs, monthly calculations, saved comparisons, and the scenario-table migration.
