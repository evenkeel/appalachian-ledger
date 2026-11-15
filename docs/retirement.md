# Retirement scenarios and extended spending history

## Use

Choose **Retirement** in the sidebar. Enter a starting price and position manually, or select **Use ledger balances**. Every input remains editable. There is no account-connection requirement. The suggested ages are editable draft values; appreciation, other-asset returns and spending changes start at 0%.

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
