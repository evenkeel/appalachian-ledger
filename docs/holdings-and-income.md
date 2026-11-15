# Bitcoin-first overview, income, and holdings

The overview displays total net worth (assets minus liabilities) first in native bitcoin and then USD. It also preserves original-currency holdings. These are estimated values, including recorded property and investment valuations; bitcoin-denominated net worth is not the quantity of bitcoin owned.

Asset allocation shows Bitcoin, USD cash, and Other assets as percentages of total asset value, with liabilities displayed separately. Bitcoin dominance is the USD value of actual bitcoin holdings divided by positive USD net worth, shown as a percentage and a dated line chart. Bitcoin-denominated property and investments stay in Other assets. Debt can bring dominance above 100%; zero or negative net worth leaves it unavailable. Missing rates leave gaps, and incomplete or negative asset groups suppress the pie rather than displaying a partial allocation. Percentages use exact decimal arithmetic and display to one decimal place.

Bitcoin dominance is displayed in the top net-worth summary. Its independent history selector offers 1 week, 1 month, 6 months, 1 year, 5 years and Max. Short views use daily balances and exact-date prices; longer views use month ends with explicit range endpoints. A ledger shorter than a month uses daily points in every view. Max covers the recorded ledger lifetime, and every view ends on the selected reporting date. Missing conversions stay gaps. History replays posted account movements, including reversals, rather than substituting current balances or prices into the past.

Debt comfort uses the recorded USD value of liabilities. Choose **Set levels** to define the upper USD limits for Low, Medium and High; debt above High is Dangerous. There are no default risk thresholds. Credit-funded spending raises debt and repayments lower it; cash-funded spending does not create debt. The gauge caps only its needle position; the full amount owed remains visible. Calibration is stored independently of display and pricing settings and applies to the selected reporting date. It does not change balances, transactions or budgets.

The comparison charts show monthly expenses, income, debt, and net worth simultaneously in bitcoin and dollars. Cash flows prefer immutable transaction-date conversion snapshots. If a snapshot is missing, display reports use an available exact-date reference; today’s conversions can use a fresh current quote and are labeled estimates. These read-only fallbacks never rewrite journal entries or saved conversions. Balances use the dated month-end Bitcoin rate and recorded asset values. Missing conversions produce gaps rather than partial totals. Original receipts and expenses remain visible when a combined equivalent is unavailable. Current-month flows are incomplete.

“Same lifestyle” holds the first nonzero, fully convertible month's dollar spending constant and converts it at each month-end Bitcoin rate. This isolates the exchange-rate effect, not changes in consumption or inflation. It is a historical comparison, not a claim that Bitcoin always appreciates. Each chart has its own labeled vertical scale; the monthly values table provides exact amounts.

## Income

Income is the sum of active `income` journal entries within the selected calendar month. Corrected or reversed entries are excluded. Transfers, opening balances, adjustments, and market valuation changes never count as income. Original USD and bitcoin receipts are separately totaled; combined equivalents use saved rates, exact-date cached prices, or explicitly labeled current estimates for today. A genuinely missing historical price still leaves a gap. CSV and journal exports retain saved snapshot provenance.

Open **Income** or **Overview → Income · manage**. Record a received payment, choose an account and income category, and enter its original amount/date. For payroll, record the take-home deposit. Use separate entries for gross pay and deductions if that is how you maintain the ledger; the app does not infer taxes. Income categories, monthly source totals, account/source/search filters, editing and audited reversal are available here. Filters affect the payment list, not the clearly labeled full-month totals. Scheduled pay and recurring templates are not automatically posted.

## Brokerage and MSTR

For any USD brokerage, stock, or ETF account, select **Enter shares & ticker**. Enter one or more tickers, current shares (up to eight decimal places), and uninvested cash. The MSTR ticker is prefilled for an account named MSTR or containing `(MSTR)`. No share count is inferred from an old manual valuation.

Saving fetches quotes and replaces the current account valuation with the sum of shares × quoted USD price + cash. An initial valuation journal entry preserves the previous history. Enter optional **total cost basis for the remaining shares** to calculate unrealized dollar gain/loss and percentage. Without cost basis, return stays unavailable rather than using an invented purchase price. Each holding also shows the regular-session price, quote timestamp, and daily price change multiplied by the current shares.

Quotes refresh at most once per minute while an authenticated app is open and visible, and on focus. Quote changes create balanced equity valuation entries; they do not create income, spending, or investment contributions. A refresh failure retains the last valuation and displays an error/cached status. The quote shown for a position is saved with its marked value, preventing a shared quote-cache update from making the displayed multiplication inconsistent.

Deposits/withdrawals recorded as transfers change uninvested cash. Update shares, remaining cost basis, and cash after trades or splits. Holdings reconciliation changes are account adjustments, distinct from market appreciation. Manual total valuation is disabled for an account once share tracking is enabled, and earlier account history is protected from backdated edits. Remove a holding to stop tracking it; removing all holdings leaves a cash-only account.

This is current holdings and **unrealized performance**, not a tax-lot or trade-execution system. Dividends, fees, realized gains, automatic split handling, historical equity backfill, TWR, and IRR are not inferred. Historical charts retain recorded valuations and accumulate actual quote marks from setup onward.

### Provider and privacy

The adapter uses Yahoo Finance's public chart endpoint and supports USD-quoted securities. Only ticker symbols are sent externally; share counts, cost basis, cash balances, and account names remain local. It uses regular-session prices with provider timestamps, not a guaranteed streaming or executable feed. Exchange delays vary; after the session closes, the last regular-session quote remains. See [Yahoo's exchange and data-provider information](https://help.yahoo.com/kb/SLN2352.html). The public endpoint is not a contracted API and can change or rate-limit requests; failures are shown without inventing prices.

## Schema and verification

Run `alembic -c database/alembic.ini upgrade head` before starting the updated backend. Migrations 0005/0006 add portfolios, holdings, quote caches and per-position quote snapshots; existing journals are unchanged. Encrypted database backups include these tables.

Tests cover fractional quantities, rounding, multiple holdings, unknown/zero basis, duplicate symbols, provider validation/failure, cached quote consistency, contribution-versus-market-gain accounting, income correction/reversal, missing conversions, and fixed-cost denomination comparisons. The live MSTR adapter was verified separately; ordinary automated tests mock external providers.


## Everyday Cash

The overview's middle row shows Everyday Cash: the sum of included, active USD checking balances as of the selected reporting period, including overdrafts. It always stays in USD. Savings, investments, physical cash, and archived accounts are excluded.

All USD checking accounts are included by default. To reserve an account for an emergency fund or another purpose, open **Accounts**, choose **Manage** on the account card, and enable **Exclude from Everyday Cash**. The overview discloses how many active checking accounts are excluded. This preference only changes Everyday Cash; balances, total USD cash, asset allocation, net worth, income, and expenses remain unchanged. Disable the switch to include the account again. The setting is a current display preference, including when viewing older reporting periods.
