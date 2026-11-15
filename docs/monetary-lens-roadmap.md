# Monetary lens and retirement planning

Initial foundation checkpoint: November 11, 2026. This vision extends the existing application incrementally. Preserve the compact workspace, account ownership distinctions, original records, and existing price provenance.

## Existing architecture and reusable features

- React/TypeScript/Vite frontend; FastAPI, SQLAlchemy, Alembic and SQLite backend; same-origin nginx/Docker self-hosting. Authentication, CSRF protection, encrypted backups, imports and audit events already exist.
- `backend/app/models.py` contains accounts, append-only double-entry journals/postings, categories, assets, budgets, recurring bills, immutable exchange references and conversion attachments. There are no retirement or planning scenario models yet.
- `backend/app/money.py` stores USD in integer cents and BITCOIN in integer base units. Decimal strings cross API boundaries; Python Decimal with half-even rounding performs conversions. Frontend `lib/money.ts` formats exact strings and spending analysis uses BigInt. Floating-point chart coordinates are presentation only.
- `prices.py`, `price_sync.py`, `accounting.py` and `conversions.py` already implement optional public Coinbase/CoinGecko prices, local caches, UTC daily methods, provider provenance, missing-data handling and explicit conversion review. Retain these adapters; no new provider dependency is needed for the foundation.
- `reports.py` converts each transaction at its dated reference before summing. Saved snapshots win; exact-date cached references can fill display gaps without rewriting records. A fresh current quote can provisionally convert today's unsnapshotted entries, with an estimate label; it never fills a past-date gap.
- Expenses already has monthly comparison, category trends, daily exploration and transaction drill-down. Cost history tracks recorded recurring lifestyle costs. Historical account reports, income, budgets and native USD/bitcoin ownership also exist. These are reusable building blocks, not replacements to build.
- `frontend/src/App.tsx` already holds the reporting denomination; Settings persists a default. Previously the interactive reporting switches only changed session state, and expense analysis independently defaulted to USD.
- Existing tests cover accounting, reversals, conversions, precision, providers, missing prices, reporting, backup/restore and the compact UI. See `verification.md` for deployment limits.

## First increment: monetary lens foundation

Files changed:

- `backend/app/schemas.py` and `main.py`: authenticated, CSRF-protected `PUT /api/settings/monetary-lens`, accepting only a denomination. Merge that single field into existing owner preferences and audit the change. No migration or new configuration.
- `frontend/src/App.tsx`: keep USD/bitcoin selection accessible in the top bar on every page, save it through the narrow endpoint, use saved preferences on reload, retain the previous selection on failure, and ignore responses from a locked session. The overview trend switch uses the same save path.
- `ExpensesView.tsx` and `SpendingAnalysis.tsx`: expense analysis follows the workspace lens; its existing local switch overrides that selection until the workspace lens changes or the analysis is remounted. Legacy BTC maps to whole bitcoin in this analysis, which supports integer USD/bitcoin comparisons only.
- `Settings.tsx`: explain the base-unit convention in context: ₿1 is one satoshi; legacy BTC is ₿100,000,000. Keep normal pages concise.
- `index.css`: compact top-bar control with wrapping on small screens.
- Tests: persisted/failed/session-bound lens behavior, unchanged settings and ledger exports, authentication/CSRF, local report overrides, and transaction-date aggregation with two different daily rates.

The lens controls supported reporting and spending analysis. Native account balances, source transaction amounts, dual-currency tables, budgets and specialized overview cards keep their existing explicit units. Completing lens-aware primary summaries across every specialized view is follow-up work, not claimed complete here.

## Subsequent implementation (November 11)

The next working increments are now implemented: primary income/overview summaries follow the workspace lens, extended historical spending supports annual/custom ranges and optional hypothetical latest value, and a monthly retirement MVP supports independent spending models, explicit contributions, depletion, whole-age retirement search, saved scenarios and side-by-side comparison. See [retirement conventions and API](retirement.md) for the exact scope and remaining advanced features. Scenario storage uses migration `0011_planning_scenarios`; the initial no-migration statement above applies only to the foundation increment.

## Original incremental plan

1. **Historical analysis:** reuse transaction references and exact aggregations; add annual/custom ranges and category comparisons without replacing the existing monthly workspace. Add optional present-value comparison as a separate labeled result: historical base units × current price. Expose unavailable/stale prices and keep actual spending, dated equivalent and hypothetical current value separate. Extend `reports.py`, schemas/types, spending analysis and transaction disclosures with calculation tests.
2. **Retirement MVP:** add an independent `backend/app/forecasting.py` Decimal engine and validated request/response schemas, then a dedicated compact planner view. Require editable initial holdings, other assets/cash, liabilities, contributions, ages, retirement expenses, retirement income and end-balance target. Prefill only defensible ledger values, with source dates, while permitting manual use. No CPI adjustments or assumed appreciation. Make all assumptions visible and label results hypothetical.
3. **Spending models:** implement one explicit model per scenario: USD spending converted at projected prices, or direct bitcoin spending changed by a separately configured purchasing-power assumption. Never apply both to the same expense. Specify contribution/withdrawal timing, annual versus monthly compounding and rounding before implementing. Stop spendable holdings at zero and report unmet spending separately. Test zero/negative returns, depletion, past retirement targets, missing inputs and numerical limits.
4. **Scenarios and readiness:** add a separate versioned planning-scenario model/migration (not journal entries), CRUD endpoints and side-by-side results. Include it in backup/restore validation. Build earliest-retirement and required-savings solvers only after cash-flow conventions and sustainable-end-balance criteria have tests. Present sensitivities without probability claims.
5. **Advanced paths:** explicit variable returns and drawdown sequences, then optional stochastic modeling with documented distributions. Preserve deterministic scenarios for comparison. Do not introduce every advanced feature in one change.

## Decisions and migration risks

- Financial ledger, reference prices, display conversions and hypothetical forecasts remain separate concerns. A scenario must never create a posting or claim hypothetical holdings are owned.
- Do not change the denomination convention, convert existing stored amounts, overwrite saved rates or bulk attach conversions. Missing prices remain explicit. Exchange-rate coverage is provider-dependent, especially early Bitcoin history.
- Prefer Decimal calculations on the backend with strings at boundaries. Bound forecast horizons, rates and solver work. Reject overflow/nonfinite scenarios explicitly; enormous appreciation inputs must not produce fabricated results or hang the server.
- Snapshot assumptions and valuation date for saved scenarios so later live prices cannot silently rewrite the meaning of a comparison. Document whether reopening refreshes inputs or retains that snapshot.
- This first increment changes preferences only. Future scenario migrations must preserve ledger tables and extend backup validation; use isolated test databases before any migration of personal data.
- Existing ledgers may contain personal records, regardless of filename or demo settings. Never seed, reset or replace them during development. Use isolated temporary databases for verification.
- Keep databases, secrets, exports and local screenshots out of version control.
