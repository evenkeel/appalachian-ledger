# Retirement

## Your retirement age

**Retirement** answers one question: how long can your bitcoin pay for your life? That is your **runway**: the years of expenses you have, with your stack growing at the rate you think bitcoin grows (15% a year until you change it), less your expenses as they rise. It needs no birth date.

With a birth date it also gives your retirement age: the first age your runway reaches the rest of your life (to 95 by default). The screen also shows runway by age, when you reach 1, 2, 5, 10 and 20 years, what it was a year ago, what would make the age sooner, and how much runway you would have if the price and your costs never moved.

Further down is one extra check: how long the stack would last if bitcoin crashed right after you stopped. It has the price fall by half and never make it up, or repeat what it really did after December 2017, April 2021, November 2021 or October 2025.

`backend/app/retirement.py` is the arithmetic: no database, no network, Decimal throughout. `backend/app/retirement_plan.py` reads the ledger and builds the screen. Nothing here posts to the journal.

### What comes from the ledger

- **Stack:** balances of bitcoin accounts that are not closed, at the current price. Dollars in checking, homes and other assets are not counted.
- **Spending:** the last 12 complete calendar months of expenses. This month is left out because it is unfinished. With fewer months it is marked as an early estimate and averages what there is, adding yearly, half-yearly and quarterly bills that have not been paid yet. With no complete month it uses active bills. You can enter your own figure instead.
- **What continues:** each category can continue at 0 to 300% of today's amount. One-off costs can be left out of the figure and the yearly totals; they stay in the ledger. Bills, and anything bought four or more times in the year, are not offered as one-offs.
- **Bitcoin bought:** the average over up to 12 complete months, or your own figure. It rises with the standard cost rise.
- **Debts:** one with a bill is paid month by month from the stack once you stop, until it is gone. One with no bill is paid off from the stack the day you stop. Loan principal is not in spending, so nothing is counted twice. Interest is not added.

### Costs from here

Yearly totals are back-to-back 12-month blocks ending with the last complete month. With two or more complete years, your own yearly change in dollar costs is a straight-line fit through their logarithms. It is projected only as many years ahead as it has behind it, then the standard rise takes over (3% until you change it). You can choose the year to measure from, or turn it off. Your trend is measured in dollars on purpose: a cost in bitcoin moves with bitcoin's price even when you spend exactly the same.

The second preset, 6.0%, is how fast US dollars (M2) grew a year from October 2016 to October 2026: 13,124.5 to 23,532.8 billion. Source: Federal Reserve Bank of St. Louis, FRED series M2SL.

### Conventions

- Month 0 is today. Each month the price and costs rise first, then bitcoin is bought while working or sold once stopped. Yearly rates compound monthly.
- The stack needed at a month is the sum over later months of (cost and debt payments less other income, not below zero) / (1 - tax) / price, plus debts nothing is paying off. Your retirement age is the first month the stack covers it.
- Runway ends the first month the stack cannot pay in full. Without a birth date it looks 100 years ahead and counts no other income. The year-ago figure uses that day's stack, price and debts, and the year of spending before it.
- The replays use Coinbase BTC-USD daily closes nearest the 15th of each month, August 2015 to November 2026, in `backend/app/bitcoin_history.py`. After November 2026 your own rate takes over. Nothing is fetched.
- Bitcoin shown as held rounds down and bitcoin needed rounds up.
- Tax is one flat share of each sale. Other income is in today's dollars and rises with the standard rise. Drops are modelled only by the halving and the replays. The future can be worse than any of them.

### API and storage

- `GET /api/planning/retirement`: the saved choices, what the ledger records, and the answer.
- `POST /api/planning/retirement/draft`: the answer for changed choices, saving nothing.
- `PUT /api/planning/retirement`: save the choices.

Choices are kept in the owner's preferences, so there is no new table or migration, and saving other settings does not reset them. The audit trail records that they changed, not the birth date or amounts. Code from before this change does not know the new preference and refuses to open Settings on a ledger where it has been saved.

# Detailed planner: scenarios and extended spending history

## Use

Choose **Retirement** in the sidebar, then **Open the detailed planner** at the bottom. Enter a starting price and position manually, or select **Use ledger balances**. Every input remains editable. There is no account-connection requirement. The suggested ages are editable draft values; appreciation, other-asset returns and spending changes start at 0%.

Ledger prefill is explicit. It uses today's recorded non-archived accounts and the latest usable selected-provider quote or dated manual reference. Missing conversions remain null and are not substituted with zero. Only available fields are copied. Other assets can include property or vehicles: review and exclude assets unavailable for retirement. The price source/date is displayed. Contributions are never inferred from income. The previous completed month's recorded expenses can be copied separately, with a warning that records may be incomplete or atypical.

The planner distinguishes owned bitcoin from other assets expressed as a bitcoin equivalent. USD/bitcoin lens changes update the portfolio/spending presentation; bitcoin holdings always remain whole native units. USD-specific obligations and end targets retain explicit USD labels.

Choose **Save scenario** to save or update, or **Save copy** to duplicate your draft under an editable name. Select up to four saved scenarios for comparison. Names such as Conservative, Base case and Optimistic can be entered by the user; they do not imply likelihood. Loading a scenario restores its saved input date and price; it never refreshes those values silently. Edit the draft and save to update a comparison.

**Expenses → Historical Spending** adds monthly/yearly totals for this year or a custom date range, account/category filters, exact tables, a selected-category trend and dated transaction references. It preserves the existing monthly analysis. The optional latest-price comparison values historical bitcoin equivalents at the latest usable stored reference; it is not actual spending or an investment return. The provider, date and older-reference status are visible. All totals include every matching expense, while transaction detail is limited to the first 500 matches; narrow the range for further detail. Maximum range: 50 years, 1970 through today.

## Projection conventions (version 1)

`backend/app/forecasting.py` is independent of accounts, prices, network access and persistence. All financial inputs and outputs are decimal strings. Bitcoin input amounts are whole base units; USD inputs have at most two decimal places. Python Decimal uses 60 significant digits. Display rounding is half-even to cents/whole bitcoin; only chart coordinates use JavaScript Number.

Each scenario uses monthly intervals through its planning age, at most 100 years. Ages are whole years on the starting date; later dates retain the original day when possible, clamping to month end. The first retirement withdrawal occurs one month after the target retirement date. A person retiring immediately has no contribution period.

1. Settle opening liabilities using cash, other assets, then bitcoin at the starting price. Unpaid liabilities create an opening shortfall. There is no separate debt-interest model.
2. Each month, multiply the Bitcoin price by `(1 + appreciation / 100)^(1/12)`. Multiply other assets by their independent return factor and round that balance to cents, half-even. Cash earns no return.
3. Before and through the retirement date, add monthly other-asset contributions after growth. Separately spend the designated monthly purchase budget on affordable whole bitcoin units, rounding purchases down and keeping the remainder as cash. These two contributions are additive and explicitly labeled.
4. After retirement, apply the selected spending model and constant monthly USD retirement income. Cash, other assets, then bitcoin cover the net spending requirement. Bitcoin sales round up to a whole unit; excess proceeds remain cash. Excess retirement income also remains cash.
5. Record any unmet obligation without borrowing or negative spendable balances. Later surplus does not erase an earlier shortfall. The first unmet-obligation date is reported, even if the account has a tiny non-spendable residual or later recovers. Cumulative withdrawals include settlement of opening liabilities; unfunded expenses are not withdrawals.

Two independent spending models:

- **USD:** today's monthly USD lifestyle cost compounds by the configured USD spending change from the starting date. The projected Bitcoin price determines withdrawals. Bitcoin lifestyle-cost change is ignored.
- **Direct bitcoin:** today's monthly bitcoin lifestyle cost compounds by the independent bitcoin cost change from the starting date. A negative rate means fewer base units buy the same lifestyle. The projected price values that cost and any USD income or other assets. USD spending change is ignored. Appreciation does not reduce this bitcoin cost again.

Costs are projected internally with Decimal precision; fractional market values are retained until display. Annual spending displayed at a date is that date's monthly lifestyle cost multiplied by twelve, not the actual sum of the following twelve changing costs. End targets and unfunded obligations are USD amounts. No CPI adjustment, default inflation, default investment gain, or default Bitcoin appreciation is imposed.

“Funded” means no unmet obligation through the planning age and enough remaining value to meet the explicit end-balance target. It is not a probability or guarantee. **Find earliest funded retirement age** checks every whole annual age from current age through the year before planning age, using the same monthly engine and end criterion. It does not assume monotonic outcomes. Its result is a whole-age candidate, not an exact optimal month. Price compounding has a floor of 0.00000001 USD per legacy BTC and a maximum projection magnitude of 10^45; unsupported scenarios fail visibly. Annual rates are bounded to -99% through 1000%.

Taxes, fees, liquidity constraints, variable returns, drawdowns, changing contributions/income, one-time future expenses and Monte Carlo distributions are not included in this MVP. No required-savings or required-starting-holdings solver is claimed. These are later increments.

## Storage, API and migrations

Migration `0011_planning_scenarios` adds only a new `planning_scenarios` table. Journals, accounts, price references and existing preferences are unchanged. The application already upgrades its schema on startup. Take a current encrypted export or an offline SQLite snapshot before upgrading a personal deployment. Older encrypted backups must be migrated to the matching schema before in-app restore, as with existing migrations. This implementation was tested against isolated databases; no personal ledger was migrated during development.

Saved rows contain a name, calculation version (`1`), validated assumption JSON, creation time and update time. Up to 40 scenarios can be saved. They are local to the self-hosted owner. Scenario saves/deletions are audited. Encrypted SQLite backups include scenarios; restore validates the version and input schema. There are no new runtime dependencies, API keys or external data transmissions.

Authenticated routes:

- `GET /api/planning/starting-position`: dated prefill candidates and recorded prior-month activity.
- `POST /api/planning/project`: calculate a draft, without saving it.
- `POST /api/planning/earliest-retirement`: whole-age search on demand.
- `GET/POST /api/planning/scenarios`, `PUT/DELETE /api/planning/scenarios/{id}`: local scenario management.
- `POST /api/planning/compare`: project one to four saved snapshots.
- `GET /api/spending-history?start=YYYY-MM-DD&end=YYYY-MM-DD&interval=month|year`: exact historical summaries, with optional category/account IDs.

All mutating HTTP methods, including read-only calculations submitted by POST, require the existing CSRF token. No projection creates a ledger entry.

Historical conversions prefer immutable purchase-cost observations, then saved journal/date references. Today's spot estimate is excluded from historical comparisons. Native amounts still remain available without a conversion; a missing dependent conversion makes its total unavailable. Each transaction is converted before summing, and each optional latest-price value is rounded to cents before aggregation. Shared report aggregation now uses 60-digit precision, including unusually large theoretical base-unit equivalents.
