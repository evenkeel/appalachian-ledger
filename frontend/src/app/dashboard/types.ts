/** Shape of GET /api/dashboard. See docs/dashboard-api.md. Money is always a decimal string. */
export interface CashEvent {
  /** "card" is a credit card paid off in full from checking on its due day. */
  kind: "bill" | "card" | "paycheck";
  date: string;
  name: string;
  amount: string;
  balance_after: string;
  overdue?: boolean;
  bill_id?: number;
  schedule_id?: number;
  /** "paycheck" only: the amount is a typical one (tips, side work), not a fixed one. */
  estimate?: boolean;
  /** The card being paid: on a "card" payment, and on a bill that pays a card down. */
  account_id?: number;
  /** "card" payments only: what was owed on the card today, and the bills charged to it since. */
  owed_now?: string;
  charged?: string;
  charged_count?: number;
}
/** A credit card with a balance or bills charged to it, and how checking pays it. */
export interface CashCard {
  account_id: number;
  name: string;
  /** Owed on the card today. */
  owed: string;
  due_day: number | null;
  /** "full": paid off in full on its due day. "bill": a bill pays it down. null: no due day yet, so it is not drawn. */
  plan: "full" | "bill" | null;
  /** The bill that pays it, when plan is "bill". */
  paid_by: string | null;
  next_payment: { date: string; amount: string } | null;
  /** Bills charged to the card over the days shown. */
  charges: { count: number; total: string };
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
    next_paycheck: { date: string; name: string; amount: string; estimate?: boolean } | null;
    due_before_paycheck: string;
    low: { date: string; balance: string };
    short: { date: string; amount: string } | null;
    /** Covered only if income that varies arrives: how much of it is counted on, and the shortfall without it. */
    leans_on_estimate?: { income: string; date: string; amount: string } | null;
    covered_days: number | null;
    /** Credit cards with a balance or bills on them. */
    cards: CashCard[];
    /** Bills paid from neither checking nor a card (savings, a wallet); counted, not drawn. */
    other_bills: number;
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
