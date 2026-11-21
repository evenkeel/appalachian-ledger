/** Shape of GET /api/dashboard. See docs/dashboard-api.md. Money is always a decimal string. */
export interface CashEvent {
  kind: "bill" | "paycheck";
  date: string;
  name: string;
  amount: string;
  balance_after: string;
  overdue?: boolean;
  bill_id?: number;
  schedule_id?: number;
}
export interface Bill {
  id: number;
  name: string;
  amount: string;
  currency: "USD" | "BITCOIN";
  due_date: string;
  days_until: number;
  overdue: boolean;
  frequency: string;
  monthly_amount: string;
  account_id: number;
  account: string;
  category: string;
  pays_account_id: number | null;
  payoff: string | null;
}
export interface DashboardData {
  today: string;
  month: string;
  first_entry_date: string | null;
  days_of_history: number;
  price: {
    usd_per_btc: string;
    bitcoin_per_usd: string;
    source: string;
    day: string;
    observed_at: string | null;
    stale: boolean;
  } | null;
  /** Dollars in everyday accounts: checking and cash that count for bills. */
  checking: { total: string; accounts: { id: number; name: string; balance: string }[] };
  cash_ahead: {
    status: "needs_account" | "needs_bills" | "ready";
    horizon_days: number;
    start: string;
    events: CashEvent[];
    next_paycheck: { date: string; name: string; amount: string } | null;
    due_before_paycheck: string;
    low: { date: string; balance: string };
    short: { date: string; amount: string } | null;
    covered_days: number | null;
  };
  bills: {
    items: Bill[];
    /** Null when a bitcoin-denominated bill cannot be valued because there is no price. */
    next_7: string | null;
    next_30: string | null;
    paid_this_month: { count: number; total: string | null };
    destroyed: { count: number; monthly_freed: string | null };
  };
  stack: {
    status: "needs_bitcoin" | "ready";
    held: string;
    month_start: string;
    gained: string;
    buys: { count: number; usd: string; bitcoin: string };
    stack_rate: string | null;
    rates: { month: string; rate: string | null }[];
    history: { month: string; held: string }[];
    milestone: { previous: string; next: string };
    streak_months: number;
    best_month: { month: string; bitcoin: string } | null;
  };
  pace: {
    day: number;
    days_in_month: number;
    current: { USD: string[]; BITCOIN: (string | null)[] };
    previous: { USD: string[]; BITCOIN: (string | null)[] } | null;
    missing_conversions: number;
  };
  debt: {
    cards: {
      account_id: number;
      name: string;
      balance: string;
      limit: string | null;
      utilization: string | null;
      due_day: number | null;
      next_due: string | null;
    }[];
    loans: {
      account_id: number;
      name: string;
      balance: string;
      change: { since: string; amount: string } | null;
    }[];
  };
  budgets: {
    month_elapsed_percent: string;
    items: { category_id: number; category: string; planned_usd: string; spent_usd: string | null; percent: string | null }[];
  };
  setup: {
    has_account: boolean;
    has_paycheck: boolean;
    has_bills: boolean;
    has_bitcoin: boolean;
    has_price_source: boolean;
    has_backup: boolean;
  };
}
