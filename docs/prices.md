# Bitcoin/USD prices

Prices are optional public reference data. Original bitcoin and USD balances never depend on a feed. Providers receive only the BTC/USD pair and requested date ranges, not descriptions, amounts, wallet addresses, or account names.

## Use

In **Settings → Prices**, choose **Coinbase**, enable **Automatic prices**, and save. No Coinbase account or API key is required for these public endpoints. The application fetches a current quote every five minutes while the backend is running and backfills completed UTC days from the first journal entry. It catches up after downtime. **Refresh price** and **Sync history** also work with automatic updates off. Requests are queued; the status updates locally without holding the accounting write lock during HTTP.

**Price details → History start** allows an earlier backfill (from 2009 onward). Coverage is reported as saved/missing days. A provider may have gaps or may not cover early dates; the application never creates prices for them. Daily jobs retry gaps, while verified cached days are reused. Selecting Manual stops automatic external requests. New installations default to Manual. Demo seeding is entirely offline: it reads real Coinbase daily closes from a file shipped with the app (`backend/app/demo_data/btc_usd_daily.json`) and saves them as ordinary Coinbase daily references. It then selects Coinbase with automatic prices on, so days after that file ends are fetched by the normal sync, never guessed.

**Review missing conversions** lists up to 500 eligible entries with the date, provider, and both currency equivalents. Saving attaches those exact reference IDs to missing conversions, with an audit event, without changing the journal or postings. A changed price, reversed entry, or existing conversion prevents an unsafe overwrite. Repeat for another batch if necessary. Existing saved conversions remain fixed. Replacing an existing conversion still requires an explicit journal correction; this release does not bulk replace conversions.

## Price definitions

- **Current:** latest Coinbase BTC-USD trade quote (or optional CoinGecko current reference). Both provider observation time and local retrieval time are saved. Quotes older than ten minutes or over one minute in the future are not accepted. Cached quotes become visibly stale after ten minutes and are excluded from current cross-currency valuations. They never become historical closes.
- **Historical Coinbase:** close of a completed 00:00–00:00 UTC candle, attributed to its opening date. The observation boundary is the following midnight; it is a daily reference, not the exact timestamp or execution price of a purchase. The unfinished current day is excluded.
- **Historical CoinGecko:** midnight UTC snapshot, kept under a distinct method. The Demo API covers only the trailing 365 days. Optional `COINGECKO_API_KEY` stays on the server. No silent fallback or mixing of provider methods occurs.
- **Manual:** an explicit dated reference. It takes precedence for that date. Its retrieval timestamp is not represented as a market observation time.
- **Legacy:** pre-migration rows keep their original source, value, and timestamp. Unknown observation time remains null; they are never relabeled as verified closes.

Date-only entries use the matching UTC reference date consistently. For display reports, saved transaction snapshots take precedence, then matching cached daily references. Today's unsnapshotted spending may use a fresh current quote as a labeled provisional estimate. Historical gaps never borrow today's price. Display fallbacks do not change journal snapshots; explicit review can attach a dated reference for durable provenance. Actual exchanges always preserve both actual amounts; a reference quote never determines how much bitcoin was received. Fees remain separate accounting entries.

## Implementation

Migration `0004_price_sync` adds metadata to immutable `exchange_rates`, a separate current `price_quotes` cache, resumable `price_sync` state, and immutable `conversion_attachments`. Decimal JSON parsing and existing half-even monetary rounding remain centralized. Every conversion retains an immutable rate ID or original snapshot. Native account totals are unaffected.

The FastAPI lifespan starts one local worker thread; use one Uvicorn process. `PRICE_WORKER_ENABLED=false` disables it for tests or maintenance. The worker processes up to 300 Coinbase candles per batch (one day per CoinGecko request), checks timestamp alignment and OHLC consistency, deduplicates, filters extra candles, and retries transient failures at most three times. Failed jobs retain their cursor and retry after five minutes. Successive batches pause briefly; jobs are resumable across restarts. HTTP requests use fixed HTTPS provider hosts and bounded timeouts. In-flight results are invalidated during restore.

Current quotes refresh in place; daily references and conversion attachments are append-only. Downloading new history never overwrites a saved conversion. Selecting a provider changes the reference series used for account valuation charts, while transaction comparisons retain their recorded rates. In the demo the person is fictional and the prices are real: its conversions were saved from Coinbase daily closes in the first place, and the header keeps saying so.

The database backup includes prices, provenance, sync state, and conversion attachments. Restore validates attachment consistency, decimal values and quote timestamps in addition to accounting integrity. Older backups must be migrated using the matching schema before in-app restore; a pre-migration SQLite snapshot is the rollback path.

## Verification

Automated tests cover exact parsing, stale/future/missing timestamps, invalid and conflicting candles, UTC boundaries, unfinished days, bounded retries, offline mode, gaps, batching, caching, resume/backoff, provider separation, authentication/CSRF, unchanged financial records, review races, immutable attachments, and encrypted restore. Frontend tests cover stale/unavailable displays, explicit provider activation, review-before-save, and refreshing views when quote freshness changes.

Live read-only Coinbase checks on October 25, 2026 returned a fresh current quote and daily closes for January 1, 2025 and January 1, 2020. These spot checks do not establish complete coverage for every historical date. Live CoinGecko remains unverified.

Sources: [Coinbase ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker), [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [CoinGecko Demo history](https://docs.coingecko.com/demo/reference/coins-id-history).
