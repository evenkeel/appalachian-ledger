# Code audit — November 8, 2026

Reviewed the current source, with emphasis on accounting corrections, recurring expense schedules, immutable purchase costs, report dates, session transitions, and obsolete frontend paths. This checkout has no commits, so a reliable diff of the last few days was unavailable. Existing tests supplied the baseline; new regressions reproduced the accounting and scheduling defects before their fixes.

## Fixed

- **Recurring schedules drifted after an edit.** A monthly bill anchored to January 31 advanced to February 28 correctly, but editing its name or amount reset its anchor to the 28th. Detail edits now preserve the anchor. Changing the due date or frequency establishes a new schedule.
- **Expense corrections used inconsistent rates.** Cost history retained the original purchase reference, while the corrected journal, budgets, and reports could use a newer rate for the same date. Same-date expense corrections now carry the saved cost reference into the replacement journal. Changing the purchase date uses that date's reference. Existing journals and observations are not rewritten.
- **Reversing invested funding could create negative brokerage cash.** Removing or reducing a deposit after its cash was invested now fails atomically. Metadata edits validate the completed replacement, allowing a temporary reversal inside the transaction without accepting a negative final cash balance.
- **Report months were inconsistently validated.** Noncanonical months such as `2026-1` could produce inconsistent results; very early history could generate invalid years. Report/budget month parsing now requires `YYYY-MM` from January 1970 onward. History stops at the supported boundary, and copying a budget from before it is rejected. Future budget planning remains available.
- **Session changes retained old ledger state.** Sign-out and restore cleared fewer fields than session expiry. All three now clear accounts, categories, transactions, assets, rates, dialogs, preferences, and filters. A settings request finishing after its effect was disposed no longer adds an obsolete error. Regression tests keep the next ledger load pending to check that stale state does not reappear after login.

## Removed or updated

- Removed the unreachable asset-linking dialog, its submit branch, and its unused asset-list prop. The current asset creation and Update value flows remain available; existing valuation records and API compatibility are preserved.
- Removed unused expense-only/minimal chart modes and the unused value-label override.
- Removed CSS for the retired overview chart layout and trend tabs/balances.
- Removed obsolete chart mock branches and updated rate/valuation instructions in the entry dialog.
- Fixed the five pre-existing Python formatting failures and formatted the changed files.

## Verification

- Backend: **158 tests passed**.
- Frontend: **152 tests passed across 30 files**.
- Ruff lint and formatting: passed.
- TypeScript checking and production Vite build: passed.
- Alembic upgrade through all migrations and metadata drift check: passed on a new temporary database.

All database tests used temporary databases. No personal ledger was opened, migrated, reseeded, or rewritten by the audit commands. No schema migration was needed.

## Remaining verification limits

- Docker is unavailable on this machine; container startup remains unverified here.
- Live price providers and Bitcoin Core were not contacted; their adapter behavior is covered by the existing mocked tests.
- The backend suite emits an existing Starlette warning about its httpx test client. Tests pass; no dependency migration was attempted as part of these fixes.
- This report records the historical audit; see [current verification](verification.md) for publication checks. Databases and other private data must remain excluded from version control.
