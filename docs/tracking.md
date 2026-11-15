# Budget, savings and investing tracking

The quick-entry buttons on Overview, Budgets and Savings & investing open the existing auditable transaction workflow. Historical entries default to the first day of the selected reporting month; adjust the date to match the actual transaction.

## Record a Bitcoin buy

1. Create an active USD checking account and a bitcoin wallet in Accounts.
2. Choose **Bitcoin buy**, select the checking account first, then the receiving bitcoin wallet.
3. Enter the actual dollars exchanged and whole bitcoin units received.
4. Choose **Today**, **Yesterday**, or enter a date.
5. Review the compact summary and choose **Confirm and record**. The description is automatically **Bitcoin buy**. Record separately charged fees as an expense.

Purchases are USD-to-bitcoin asset transfers, not spending or income. The purchase charts use the actual amounts sent and received, without needing an exchange-rate reference. Moving bitcoin between wallets is not a purchase. The journal shows the actual exchange rate as whole bitcoin units per dollar (₿ per $1) for cross-currency transfers. Other available conversions use their saved reference rates; current estimates remain labeled. Click any transaction row, or activate its title with the keyboard, to open a read-only summary of the recorded amounts, accounts, category, notes, and available exchange rate.

The monthly average purchase price is quantity-weighted, excludes separately recorded fees, and is not a tax cost basis or the cost basis of current holdings. Sales do not subtract from gross purchase activity; they affect balances and net investment transfers. Purchase history includes existing qualifying transfers automatically.

## Follow savings and investments

**Move to savings** and **Add investment funds** preselect the appropriate transfer workflow. Investment funding adds account cash; use **Accounts → Enter shares & ticker** to update shares and cash when buying securities.

Savings groups accounts whose type is `savings`. Investing groups other asset accounts denominated in bitcoin, plus brokerage, stock and ETF accounts. Archived accounts remain in history. An individual account filter includes transfers to/from other accounts in the same group; the all-accounts view excludes these internal transfers.

Monthly net transfers are funding less withdrawals. They exclude opening balances, income, expenses, adjustments and valuations. Recorded balances include those other changes. Neither chart is a performance return. Dollar amounts use the actual USD exchange leg where available; bitcoin-only transfers use the saved or available transaction-date conversion, with current estimates labeled. Bitcoin balances converted to USD require month-end historical prices; current-month valuations use an available current quote. Missing conversions are unavailable, never invented zeros.

## Plan and review expenses

Choose a reporting month and optionally an expense category. The chart compares spending with that month's USD plans. **Without a budget** totals expenses in categories without USD allowances. **Plan minus spending** includes those expenses as well, so it can be negative even when individual planned categories are within budget.

Use **Add expense** on a category card to prefill its category. **Copy previous month** copies all missing USD category plans from the preceding calendar month, including across year boundaries. Existing target-month plans and legacy bitcoin plans remain intact; repeated copies do not duplicate allowances. It does not establish recurring budgets.

Choose 3, 6, 12 or 24 months of history. Expand **Monthly figures** for exact, accessible values. The current month is month-to-date. Editing and reversing transactions updates their effective month while preserving the original audit trail.

## Analyze recorded spending

Open **Expenses → Analysis**. Dollars are selected initially; switch to bitcoin to use saved purchase-date equivalents. The reporting month and account/category filters apply throughout the analysis and its transaction details. Original native amounts remain available even when the other unit lacks a saved reference.

**Spending Pace** overlays cumulative spending with the preceding calendar month. For the current month, the headline and **Spending Bridge** compare day 1 through today against the same elapsed days in the previous month, capped at that month's last day. The previous pace line continues through its full month for context. Completed months compare full calendar months. Future months have no analysis. Future-dated expenses do not enter current-month actuals before their date.

The waterfall bridge shows the six largest absolute category changes, with remaining changes grouped into **Other changes**. Select a change to inspect the contributing transactions from both comparison periods. Category **Trends** show six calendar months on a common scale; the latest point is month-to-date for the current month, while earlier points are full months. The **Map** shows category shares of the selected period. Map selections show selected-period transactions only. Expand **When you spent** to inspect a particular day. Exact figures are available under each view.

Missing historical conversions produce unavailable totals, shares, and comparisons rather than partial sums or today's estimates. Calendar dates without records show zero recorded expenses; this does not establish that no spending occurred. These views exclude transfers, planned bills, income, and reversed/superseded entries through the existing active transaction collection.

The analysis layout pairs pace and the bridge when the available content width permits. The bridge reads left to right at every screen size; on a phone, its chart scrolls within its panel. Figures use compact tables, with a category selector for six-month history. Expense history and analysis transaction details keep categories visible and hide the conversion column until **Show conversions** is selected.

## Use one expense entry flow

Expenses opens one **Analysis** workspace with **Add expense**. **Upcoming expenses** shows one Sunday–Saturday week as seven labeled dots, with larger totals represented by larger dot areas. Every day of that week appears: a small light blue dot means no planned expenses, while orange dots show planned spending; select a dot to open a popup and inspect, record, edit, or remove its expenses. Dollar and bitcoin totals stay separate, and the dot-size currency can be switched. Previous/next week navigation and an overdue shortcut keep other dates accessible. **Recorded expenses** and **Cost history** expand below the charts, with their existing filters and actions.

In **Add expense**, choose **Payment → Paid** to post actual spending or **Upcoming** to save a plan without posting. **Repeats** offers Once, Weekly, Monthly, Quarterly, Every 6 months, and Yearly. Paid repeating entries post the first payment and schedule the next occurrence together. Upcoming entries require payment confirmation. Switching between Paid and Upcoming preserves the entered details; returning to Paid moves a future date back to today. Quarterly and six-month schedules preserve the original day after short months, as monthly schedules do.
