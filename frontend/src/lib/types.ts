import type { Denomination } from "./money";
export interface Account {
  id: number;
  name: string;
  kind: string;
  role: "asset" | "liability";
  currency: "USD" | "BITCOIN";
  balance: string;
  balance_minor: string;
  bitcoin: string | null;
  usd: string | null;
  value: string | null;
  holding_type: "bitcoin" | "dollars" | "valued_asset" | "debt";
  archived: boolean;
  exclude_from_consumer_debt?: boolean;
  exclude_from_liquid_usd?: boolean;
  rate_day: string | null;
  rate_source: string | null;
  portfolio?: Portfolio | null;
}
export type SpendingType =
  "fixed" | "essential" | "discretionary" | "unclassified";
export interface Category {
  spending_type?: SpendingType;
  id: number;
  name: string;
  kind: "income" | "expense";
}
export interface PurchaseCost {
  usd: string;
  bitcoin: string;
  usd_per_btc: string;
  source: string;
  method: string;
  observed_at: string;
}
export interface CostPayment {
  id: number;
  date: string;
  recorded_at: string;
  description: string;
  account: string;
  usd: string | null;
  bitcoin: string | null;
  rate: string | null;
  source: string | null;
  method: string | null;
  quote_at: string | null;
}
export interface CostMonth {
  month: string;
  payments: number;
  usd: string | null;
  bitcoin: string | null;
  missing_usd: number;
  missing_bitcoin: number;
  change_usd: string | null;
  change_bitcoin: string | null;
}
export interface CostHistoryData {
  payments: CostPayment[];
  months: CostMonth[];
}
export interface PayeeRule {
  match: string;
  category_id: number;
  account_id: number | null;
}
export interface SafeToSpend {
  month: string;
  amount: string | null;
  per_day: string | null;
  days_left: number;
  income: string | null;
  spent: string | null;
  bitcoin_bought: string;
  bills_due: string;
  bills_count: number;
  goals: string;
  complete: boolean;
}
export interface Goal {
  id: number;
  name: string;
  account_id: number;
  account: string;
  currency: "USD" | "BITCOIN";
  target: string;
  saved: string;
  remaining: string;
  percent: string;
  complete: boolean;
  target_date: string | null;
  months_left: number | null;
  monthly_needed: string | null;
  overdue: boolean;
  shares_account: boolean;
}
export interface Transaction {
  /** Why this entry is waiting in the review queue; empty when nothing is doubtful. */
  review_reasons?: ("imported" | "catch_all_category")[];
  purchase_cost?: PurchaseCost | null;
  id: number;
  date: string;
  kind: string;
  description: string;
  notes: string;
  account_id: number;
  account: string;
  currency: "USD" | "BITCOIN";
  amount: string;
  destination_id: number | null;
  destination_amount: string | null;
  destination_currency: "USD" | "BITCOIN" | null;
  destination_account: string | null;
  actual_exchange_price?: string | null;
  category_id: number | null;
  category: string;
  bitcoin: string | null;
  usd: string | null;
  rate_snapshot: string | null;
  conversion_basis?:
    "saved" | "dated_reference" | "current_estimate" | "missing";
  conversion_rate?: string | null;
  conversion_source?: string | null;
  conversion_at?: string | null;
  valuation_basis: string;
}
export interface Rate {
  id?: number;
  usd_per_btc: string;
  day: string;
  source: string;
  fetched_at: string;
  stale?: boolean;
  observed_at?: string | null;
  method?: string;
}
export interface Flow {
  spending?: Record<SpendingType, string | null>;
  conversion_status?: {
    current_estimate: number;
    dated_reference: number;
    missing: number;
  };
  income_categories?: { name: string; value: string | null }[];
  income: string | null;
  expenses: string | null;
  savings_rate: string | null;
  categories: { name: string; value: string | null }[];
}
export interface Ownership {
  allocation?: Allocation;
  equivalents?: Record<
    "bitcoin" | "dollars" | "valued_asset" | "debt",
    Record<"USD" | "BITCOIN", string | null>
  >;
  native_other_assets: Record<"USD" | "BITCOIN", string>;
  native_liabilities: Record<"USD" | "BITCOIN", string>;
  bitcoin_held: string;
  usd_held: string;
  valued_assets_usd: string | null;
  liabilities_usd: string | null;
}
export interface Allocation {
  assets_usd: string | null;
  asset_percentages: Record<
    "bitcoin" | "dollars" | "valued_asset",
    string | null
  >;
  status: "ready" | "missing_values" | "negative_assets" | "empty";
  bitcoin_usd: string | null;
  dollars_usd: string | null;
  other_assets_usd: string | null;
  liabilities_usd: string | null;
  net_worth_usd: string | null;
  bitcoin_dominance: string | null;
}
export interface Performance {
  account_id: number;
  start_date: string;
  end_date: string;
  start_value: string | null;
  end_value: string | null;
  net_additions: string | null;
  value_change: string | null;
}
export interface DualValues extends Flow {
  assets: string | null;
  liabilities: string | null;
  net_worth: string | null;
}
export interface History {
  allocation?: Allocation;
  dual?: Record<"BITCOIN" | "USD", DualValues>;
  lifestyle?: Record<"BITCOIN" | "USD", string | null>;
  month: string;
  date: string;
  rate_day: string | null;
  flows: Record<"USD" | "BITCOIN", Flow>;
  native_flows: Record<"USD" | "BITCOIN", Flow>;
  net_worth: string | null;
  income: string | null;
  expenses: string | null;
  savings_rate: string | null;
  accounts: {
    id: number;
    name: string;
    balance: string;
    currency: "USD" | "BITCOIN";
    value: string | null;
  }[];
}
export interface Report {
  safe_to_spend?: SafeToSpend | null;
  debt_gauge?: DebtGaugeData;
  dual?: Record<"BITCOIN" | "USD", DualValues>;
  lifestyle_baseline?: string | null;
  ownership: Ownership;
  flows: Record<"USD" | "BITCOIN", Flow>;
  native_flows: Record<"USD" | "BITCOIN", Flow>;
  performance: Performance[];
  month: string;
  denomination: Denomination;
  net_worth: string | null;
  assets: string | null;
  liabilities: string | null;
  income: string | null;
  expenses: string | null;
  savings_rate: string | null;
  history: History[];
  accounts: Account[];
  categories: { name: string; value: string | null }[];
  recent: Transaction[];
  rate: Rate | null;
  missing_rates: boolean;
  valuation_basis: string;
}
export interface Budget {
  currency: "USD" | "BITCOIN";
  scope: "native" | "all";
  id: number;
  category_id: number;
  category: string;
  planned: string;
  actual: string | null;
  remaining: string | null;
  percent: string | null;
}
export interface Asset {
  id: number;
  account_id: number;
  name: string;
  kind: string;
  quantity: string;
  history: { date: string; value: string }[];
  account: Account;
}
export type CardScope = "accounts" | "assets" | "bills" | "overview-balances";
export type CardOrders = Partial<Record<CardScope, string[]>>;
export interface Preferences {
  payee_rules?: PayeeRule[];
  category_payment_defaults?: Record<string, number>;
  card_orders?: CardOrders;
  debt_limits?: DebtLimits | null;
  denomination: Denomination;
  theme: "dark" | "light";
  rate_source: "manual" | "coinbase" | "coingecko";
  automatic_prices?: boolean;
}
export interface DebtLimits {
  low: string;
  medium: string;
  high: string;
}
export interface DebtGaugeData {
  debt_usd: string | null;
  limits: DebtLimits | null;
  level: "low" | "medium" | "high" | "dangerous" | null;
  position: string | null;
}
export interface DominanceHistory {
  period: string;
  resolution: "daily" | "monthly";
  start: string;
  end: string;
  points: { date: string; bitcoin_dominance: string | null }[];
}
export interface Owner {
  username: string;
  csrf: string;
  demo: boolean;
  preferences?: Preferences;
}
export interface Audit {
  id: number;
  action: string;
  entity: string;
  detail: unknown;
  created_at: string;
}

export interface BudgetOverview {
  estimated?: boolean;
  category_id: number;
  category: string;
  budget_id: number | null;
  planned_usd: string | null;
  spent_usd: string | null;
  spent_bitcoin: string | null;
  remaining_usd: string | null;
  percent: string | null;
}

export interface Portfolio {
  cash: string;
  started_on: string;
  source: string;
  error: string | null;
  holdings: {
    symbol: string;
    shares: string;
    cost_basis: string | null;
    value: string;
    price: string | null;
    gain: string | null;
    gain_percent: string | null;
    day_change: string | null;
    observed_at: string | null;
    fetched_at: string | null;
    stale: boolean;
  }[];
}

export interface TrackingMonth {
  month: string;
  date: string;
  planned_usd: string | null;
  spent_usd: string | null;
  remaining_usd: string | null;
  unbudgeted_usd: string | null;
  estimated: boolean;
  savings_net_usd: string | null;
  savings_balance_usd: string | null;
  investing_net_usd: string | null;
  investing_balance_usd: string | null;
  bitcoin_bought: string;
  bitcoin_paid_usd: string;
  purchase_count: number;
  average_price_usd: string | null;
  bitcoin_balance: string;
}

export interface RecurringBill {
  id: number;
  account_id: number;
  category_id: number;
  description: string;
  notes: string;
  amount: string;
  frequency:
    "once" | "weekly" | "monthly" | "quarterly" | "semiannual" | "yearly";
  next_due: string;
  account: string;
  category: string;
  currency: "USD" | "BITCOIN";
  account_archived: boolean;
}
