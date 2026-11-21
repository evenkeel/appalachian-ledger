import type { Category, Report, Transaction } from "../../lib/types";
import type { Period } from "../dashboard/history";
import type { DashboardData } from "../dashboard/types";

/** A fictional dashboard reading in the documented shape (docs/dashboard-api.md). */
export const reading: DashboardData = {
  today: "2026-11-19",
  month: "2026-11",
  first_entry_date: "2026-06-01",
  days_of_history: 172,
  price: { usd_per_btc: "118750.00", bitcoin_per_usd: "842", source: "Fictional demo rate", day: "2026-11-19", observed_at: null, stale: false },
  checking: { total: "4812.40", accounts: [{ id: 3, name: "Everyday checking", balance: "4812.40" }] },
  cash_ahead: {
    status: "ready",
    horizon_days: 30,
    start: "4812.40",
    events: [
      { kind: "bill", date: "2026-11-21", name: "Mortgage", amount: "1400.00", balance_after: "3412.40", overdue: false, bill_id: 7 },
      { kind: "bill", date: "2026-11-28", name: "Ridgeline Visa payment", amount: "1284.36", balance_after: "2128.04", overdue: false, bill_id: 8 },
      { kind: "paycheck", date: "2026-12-01", name: "Salary", amount: "3100.00", balance_after: "5228.04", schedule_id: 1 },
      { kind: "bill", date: "2026-12-12", name: "Streaming", amount: "22.99", balance_after: "5205.05", overdue: false, bill_id: 9 },
    ],
    next_paycheck: { date: "2026-12-01", name: "Salary", amount: "3100.00" },
    due_before_paycheck: "2684.36",
    low: { date: "2026-11-28", balance: "2128.04" },
    short: null,
    covered_days: 33,
  },
  bills: {
    items: [
      { id: 7, name: "Mortgage", amount: "1400.00", currency: "USD", due_date: "2026-11-21", days_until: 2, overdue: false, frequency: "monthly", monthly_amount: "1400.00", account_id: 3, account: "Everyday checking", category: "Housing", pays_account_id: 11, payoff: "209920.00" },
      { id: 8, name: "Ridgeline Visa payment", amount: "1284.36", currency: "USD", due_date: "2026-11-28", days_until: 9, overdue: false, frequency: "monthly", monthly_amount: "1284.36", account_id: 3, account: "Everyday checking", category: "Other expense", pays_account_id: 10, payoff: "1284.36" },
      { id: 9, name: "Streaming", amount: "22.99", currency: "USD", due_date: "2026-12-12", days_until: 23, overdue: false, frequency: "monthly", monthly_amount: "22.99", account_id: 3, account: "Everyday checking", category: "Shopping", pays_account_id: null, payoff: null },
    ],
    next_7: "1400.00",
    next_30: "2707.35",
    paid_this_month: { count: 6, total: "1214.50" },
    destroyed: { count: 2, monthly_freed: "31.98" },
  },
  stack: {
    status: "ready",
    held: "21932000",
    month_start: "21259600",
    gained: "672400",
    buys: { count: 2, usd: "800.00", bitcoin: "672400" },
    stack_rate: "11.3",
    rates: [
      { month: "2026-09", rate: "11.0" },
      { month: "2026-10", rate: "10.2" },
      { month: "2026-11", rate: "11.3" },
    ],
    history: [
      { month: "2026-09", held: "20612000" },
      { month: "2026-10", held: "21259600" },
      { month: "2026-11", held: "21932000" },
    ],
    milestone: { previous: "21000000", next: "22000000" },
    streak_months: 6,
    best_month: { month: "2026-09", bitcoin: "700000" },
  },
  pace: {
    day: 3,
    days_in_month: 30,
    current: { USD: ["0.00", "62.40", "154.20"], BITCOIN: ["0", "52891", "130700"] },
    previous: { USD: ["0.00", "84.20", "126.30", "412.30"], BITCOIN: ["0", "73800", "110700", "361500"] },
    missing_conversions: 0,
  },
  debt: {
    cards: [{ account_id: 10, name: "Ridgeline Visa", balance: "1284.36", limit: "6000.00", utilization: "21.4", due_day: 28, next_due: "2026-11-28" }],
    loans: [{ account_id: 11, name: "Home mortgage", balance: "209920.00", change: { since: "2026-06-30", amount: "-4080.00" } }],
  },
  budgets: { month_elapsed_percent: "63.3", items: [{ category_id: 2, category: "Groceries", planned_usd: "900.00", spent_usd: "648.20", percent: "72.0" }] },
  setup: { has_account: true, has_paycheck: true, has_bills: true, has_bitcoin: true, has_price_source: true, has_backup: true },
};

/** A brand-new ledger: nothing recorded, every panel waiting. */
export const empty: DashboardData = {
  today: "2026-11-19",
  month: "2026-11",
  first_entry_date: null,
  days_of_history: 0,
  price: null,
  checking: { total: "0.00", accounts: [] },
  cash_ahead: { status: "needs_account", horizon_days: 30, start: "0.00", events: [], next_paycheck: null, due_before_paycheck: "0.00", low: { date: "2026-11-19", balance: "0.00" }, short: null, covered_days: null },
  bills: { items: [], next_7: "0.00", next_30: "0.00", paid_this_month: { count: 0, total: "0.00" }, destroyed: { count: 0, monthly_freed: "0.00" } },
  stack: { status: "needs_bitcoin", held: "0", month_start: "0", gained: "0", buys: { count: 0, usd: "0.00", bitcoin: "0" }, stack_rate: null, rates: [], history: [], milestone: { previous: "0", next: "100000" }, streak_months: 0, best_month: null },
  pace: { day: 19, days_in_month: 30, current: { USD: Array(19).fill("0.00"), BITCOIN: Array(19).fill("0") }, previous: null, missing_conversions: 0 },
  debt: { cards: [], loans: [] },
  budgets: { month_elapsed_percent: "63.3", items: [] },
  setup: { has_account: false, has_paycheck: false, has_bills: false, has_bitcoin: false, has_price_source: false, has_backup: false },
};


const expense = (id: number, date: string, category_id: number, category: string, amount: string, bitcoin: string | null): Transaction => ({
  id,
  date,
  kind: "expense",
  description: `${category} ${id}`,
  notes: "",
  account_id: 3,
  account: "Everyday checking",
  currency: "USD",
  amount,
  destination_id: null,
  destination_amount: null,
  destination_currency: null,
  destination_account: null,
  category_id,
  category,
  bitcoin,
  usd: amount,
  rate_snapshot: null,
  valuation_basis: "historical purchasing power",
  purchase_cost: bitcoin === null ? null : { usd: amount, bitcoin, usd_per_btc: "118750.00", source: "Fictional demo rate", method: "legacy", observed_at: date },
});

export const categories: Category[] = [
  { id: 2, name: "Groceries", kind: "expense" },
  { id: 3, name: "Dining", kind: "expense" },
  { id: 4, name: "Transport", kind: "expense" },
  { id: 1, name: "Salary", kind: "income" },
];

/** November so far against October 1–19: groceries up $40, dining down $12.10, transport unchanged. */
export const transactions: Transaction[] = [
  expense(21, "2026-11-03", 2, "Groceries", "91.80", "77300"),
  expense(20, "2026-11-02", 3, "Dining", "22.40", "18860"),
  expense(19, "2026-11-02", 4, "Transport", "40.00", "33680"),
  expense(12, "2026-10-03", 2, "Groceries", "51.80", "45430"),
  expense(11, "2026-10-02", 3, "Dining", "34.50", "30260"),
  expense(10, "2026-10-02", 4, "Transport", "40.00", "35080"),
  expense(9, "2026-10-20", 2, "Groceries", "286.00", "250800"),
];

const flow = (income: string, incomeRows: [string, string][], rows: [string, string][]) => ({
  income,
  expenses: "154.20",
  savings_rate: null,
  spending: {},
  conversion_status: {},
  income_categories: incomeRows.map(([name, value]) => ({ name, value })),
  categories: rows.map(([name, value]) => ({ name, value })),
  assets: null,
  liabilities: null,
  net_worth: null,
});

export const report = {
  month: "2026-11",
  stacked: { bitcoin: "672400", usd: "800.00", other_usd: "500.00", stack_rate: "11.3" },
  dual: {
    USD: flow("7050.00", [["Salary", "6200.00"], ["Design project", "850.00"]], [["Groceries", "91.80"], ["Dining", "22.40"], ["Transport", "40.00"]]),
    BITCOIN: flow("5936100", [["Salary", "5220400"], ["Design project", "715700"]], [["Groceries", "77300"], ["Dining", "18860"], ["Transport", "33680"]]),
  },
} as unknown as Report;

/** Five full months: dollars up 4.8%, bitcoin down 11.7%. */
export const periods: Period[] = [
  { period: "2026-06", usd: "2810.00", bitcoin: "2927083", missing_bitcoin: 0 },
  { period: "2026-07", usd: "2865.00", bitcoin: "2865000", missing_bitcoin: 0 },
  { period: "2026-08", usd: "2790.00", bitcoin: "2669856", missing_bitcoin: 0 },
  { period: "2026-09", usd: "2905.00", bitcoin: "2665138", missing_bitcoin: 0 },
  { period: "2026-10", usd: "2946.10", bitcoin: "2584298", missing_bitcoin: 0 },
];
