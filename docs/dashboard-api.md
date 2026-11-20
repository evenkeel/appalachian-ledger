# Dashboard API contract

The new dashboard reads one endpoint, `GET /api/dashboard`, and writes through a few small ones.
All money is a decimal **string** (USD two places, bitcoin whole units). Dates are `YYYY-MM-DD`.
Nothing here creates a posting except the three write actions that say so.

## Definitions

- **Everyday accounts**: non-archived asset accounts in USD of kind `checking` or `cash` with `exclude_from_liquid_usd` false. Their summed balance is "ammo".
- **Bill**: a non-archived `recurring_bills` row. Overdue when `next_due` is before today.
- **Paycheck**: a non-archived `income_schedules` row (new table). It never posts by itself.
- **Bitcoin held**: the existing rule in `reports.ownership` (`bitcoin_held`).
- **Stacked**: USD → BITCOIN transfers between asset accounts, as in `tracking.py` (`bitcoin_bought`, `bitcoin_paid_usd`).
- **Stack rate** for a month: stacked dollars ÷ USD-equivalent income for that month × 100, one decimal, half-even; `null` when income is zero or a conversion is missing.

## `GET /api/dashboard`

```jsonc
{
  "today": "2026-11-19",
  "month": "2026-11",
  "first_entry_date": "2026-06-01",        // null on an empty ledger
  "days_of_history": 172,                   // 0 on an empty ledger
  "price": {                                // null when no usable current rate
    "usd_per_btc": "118750.00",
    "bitcoin_per_usd": "842",              // whole bitcoin per $1, half-even
    "source": "Coinbase", "day": "2026-11-19", "observed_at": "…", "stale": false
  },
  "ammo": {
    "total": "4812.40",
    "accounts": [{ "id": 3, "name": "Everyday checking", "balance": "4812.40" }]
  },
  "cash_ahead": {
    "status": "ready",                      // "needs_account" | "needs_bills" | "ready"
    "horizon_days": 30,
    "start": "4812.40",
    // Chronological. Overdue bills are placed on today. Same day: bills before paychecks.
    "events": [
      { "kind": "bill", "date": "2026-11-21", "name": "Mortgage", "amount": "1400.00",
        "balance_after": "3412.40", "overdue": false, "bill_id": 7 },
      { "kind": "paycheck", "date": "2026-12-01", "name": "Salary", "amount": "3100.00",
        "balance_after": "4828.54", "schedule_id": 1 }
    ],
    "next_paycheck": { "date": "2026-12-01", "name": "Salary", "amount": "3100.00" },  // or null
    "due_before_paycheck": "3083.86",       // bills on or before the next paycheck date (all 30 days if none)
    "low": { "date": "2026-12-01", "balance": "1728.54" },       // lowest balance on or before the next paycheck
    "short": null,                          // or { "date": first day balance < 0, "amount": deepest gap as positive }
    "covered_days": 33                      // days of known bills covered with no paycheck; capped at 60
  },
  "bills": {
    "items": [{
      "id": 7, "name": "Mortgage", "amount": "1400.00", "currency": "USD",
      "due_date": "2026-11-21", "days_until": 2, "overdue": false,
      "frequency": "monthly", "monthly_amount": "1400.00",
      "account_id": 3, "account": "Everyday checking", "category": "Housing",
      "pays_account_id": 9,                 // linked debt account, or null
      "payoff": "209920.00"                 // current balance of the linked debt, or null
    }],
    "next_7": "1615.00", "next_30": "3283.85",
    "paid_this_month": { "count": 6, "total": "1214.50" },
    "destroyed": { "count": 2, "monthly_freed": "31.98" }
  },
  "stack": {
    "status": "ready",                      // "needs_bitcoin" when no bitcoin account exists
    "held": "21932000", "month_start": "21259600", "gained": "672400",
    "buys": { "count": 2, "usd": "800.00", "bitcoin": "672400" },
    "stack_rate": "11.3",
    "rates": [{ "month": "2026-06", "rate": "9.8" }],            // up to 6 months, oldest first, current last
    "history": [{ "month": "2026-06", "held": "18617000" }],     // month-end holdings, same months
    "milestone": { "previous": "21000000", "next": "22000000" }, // next round step above `held`
    "streak_months": 6,                     // consecutive months ending now (or last month) with a buy
    "best_month": { "month": "2026-09", "bitcoin": "700000" }    // most bitcoin bought in one month, or null
  },
  "pace": {
    "day": 19, "days_in_month": 30,
    // Cumulative recorded spending by day of month. BITCOIN uses purchase-date cost records;
    // an entry is null from the first day that includes an expense with no saved conversion.
    "current": { "USD": ["0.00", "62.40"], "BITCOIN": ["0", "52891"] },      // length = day
    "previous": { "USD": ["0.00"], "BITCOIN": ["0"] },                       // full previous month, or null if it has no expenses
    "missing_conversions": 0
  },
  "debt": {
    "cards": [{ "account_id": 8, "name": "Ridgeline Visa", "balance": "1284.36",
                "limit": "6000.00", "utilization": "21.4", "due_day": 28, "next_due": "2026-11-28" }],
    "loans": [{ "account_id": 9, "name": "Home mortgage", "balance": "209920.00",
                "change": { "since": "2026-06-30", "amount": "-4080.00" } }]
  },
  "budgets": {
    "month_elapsed_percent": "63.3",
    "items": [{ "category_id": 2, "category": "Groceries", "planned_usd": "900.00",
                "spent_usd": "648.20", "percent": "72.0" }]      // only categories with a USD allowance
  },
  "setup": { "has_account": true, "has_paycheck": true, "has_bills": true,
             "has_bitcoin": true, "has_price_source": true, "has_backup": false }
}
```

`limit`, `utilization`, `due_day`, `next_due` are `null` for a card with no saved terms.

## Notes on the reading

- Cash ahead only moves on everyday accounts: bills paid from them and paychecks landing in them. A bill paid by card appears under `bills` only, so the card bill and the card payment are never both counted.
- Overdue bills are placed on today. On the same day, bills come before paychecks. A paycheck dated today is assumed to have landed.
- `next_paycheck` may fall after the 30 days shown.
- `bills.next_7`, `bills.next_30`, `paid_this_month.total` and `destroyed.monthly_freed` are `null` when a bitcoin-denominated bill cannot be valued because no price is saved. Nothing is guessed.
- `stack.rates` and `stack.history` cover only months since the first entry, so both are empty on a new ledger.
- `price.usd_per_btc` has at least two decimals and is never rounded.

## Writes

| Endpoint | Does |
| --- | --- |
| `GET/POST /api/income-schedules`, `PUT/DELETE /api/income-schedules/{id}` | Paycheck schedule. Body: `account_id`, `name`, `amount`, `frequency` (`weekly`, `biweekly`, `semimonthly`, `monthly`), `next_date`. Delete archives. |
| `PUT /api/accounts/{id}/card-terms` | Body: `credit_limit` (string or null), `due_day` (1–31 or null). Credit-card accounts only. |
| `PUT /api/recurring-bills/{id}/pays-account` | Body: `account_id` (a liability account) or null. Links a bill to the debt it pays down. |
| `POST /api/recurring-bills/{id}/destroy` | Archives the bill and stamps `destroyed_on` with today. No posting. Returns `{ "monthly_freed": "22.99" }`. |
| `POST /api/recurring-bills/{id}/pay-off` | Body: `date`. Bill must have `pays_account_id`. Posts one transfer for the debt's full balance from the bill's paying account to the debt account, then destroys the bill. Refuses (409) if the paying account balance is lower than the debt, or if nothing is owed. Returns `{ "entry_id", "amount", "monthly_freed" }`. |

Paying a bill for the month keeps using the existing `POST /api/recurring-bills/{id}/record`.

## Alert lights

`GET /api/alerts`

```jsonc
{
  // Always the same ten, in this order. A light that is not in `active` is dark.
  "lights": [{ "id": "overdue", "label": "Bill overdue" }, { "id": "cash", "label": "Cash short" },
             { "id": "card", "label": "Card due" }, { "id": "pace", "label": "Spend pace" },
             { "id": "util", "label": "Credit use" }, { "id": "allow", "label": "Allowance" },
             { "id": "price", "label": "Price feed" }, { "id": "conv", "label": "Missing price" },
             { "id": "backup", "label": "Backup" }, { "id": "stack", "label": "No stack yet" }],
  "active": [{
    "id": "util",
    "level": "caution",                  // "advisory" | "caution" | "warning"
    "magnitude": "68.8",                 // decimal string; larger is worse. Used for "comes back if worse".
    "acknowledged": false,
    "panel": "debt",                     // dashboard panel to flag: cash | bills | pace | debt | budgets | stack | null
    "title": "Ridgeline Visa is at 69% of its limit",
    "why": "A balance this high costs interest and leaves little room for an emergency.",
    // Figures behind the alert. `unit` tells the client how to format `value`.
    "facts": [{ "label": "Balance", "value": "4128.00", "unit": "USD" },
              { "label": "Limit", "value": "6000.00", "unit": "USD" },
              { "label": "Used", "value": "68.8", "unit": "percent" }],
    "rows": [{ "name": "Mortgage", "note": "Nov 21", "value": "1400.00", "unit": "USD" }],
    // One sentence of what clears it; `{value}` is replaced by the formatted value.
    "advice": { "text": "Pay {value} to get back under your 30% line.", "value": "2328.00", "unit": "USD" },
    // The one action. Exactly one of `route` (new-interface screen) or `bill_id` (opens Pay for that bill).
    "action": { "label": "Plan a payment", "route": "accounts" }
  }]
}
```

`unit` is one of `USD`, `BITCOIN`, `percent`, `days`, `count`, `text`. `facts`, `rows` may be empty; `advice` may be null.

| Endpoint | Does |
| --- | --- |
| `POST /api/alerts/{id}/acknowledge` | Stores the alert's current level and magnitude. It stays in `active` with `acknowledged: true` until it clears, and returns to `false` if its level rises or its magnitude grows past the stored value. |
| `POST /api/alerts/acknowledge-all` | The same for every active caution and warning. |
| `GET/PUT /api/settings/alert-thresholds` | Thresholds and per-light on/off, stored in their own `alert_settings` table. `PUT {}` restores the defaults, which are in `docs/cockpit-design.md`. |

## Destroyed bills

| Endpoint | Does |
| --- | --- |
| `GET /api/recurring-bills/destroyed` | Bills destroyed for good, newest first: `id`, `name`, `amount`, `currency`, `frequency`, `monthly_amount`, `destroyed_on`, `account`, `category`, and `paid_off` (true when the bill was linked to a debt). |
| `POST /api/recurring-bills/{id}/restore` | Brings a destroyed bill back. Never posts. The next due date keeps its day of the month and moves to today or later. `409` if the bill was not destroyed. |

## Backups

| Endpoint | Does |
| --- | --- |
| `GET /api/backup/status` | `{"last_backup_at": "<ISO UTC time>"}` for the last encrypted backup made on this ledger, or `null` if there has been none. |
| `POST /api/restore` | Unchanged request and reply. A backup made by an older version is first upgraded in a temporary copy by the same migrations that run at startup, then validated like any other; the live ledger is replaced only if every check passes. A backup from a newer version is refused with `422`. |
