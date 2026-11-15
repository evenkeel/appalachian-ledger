export interface ForecastInput {
  as_of: string;
  current_age: number;
  retirement_age: number;
  planning_age: number;
  bitcoin: string;
  other_assets_usd: string;
  cash_usd: string;
  liabilities_usd: string;
  price_usd: string;
  monthly_savings_usd: string;
  monthly_purchase_usd: string;
  monthly_spending_usd: string;
  monthly_spending_bitcoin: string;
  monthly_retirement_income_usd: string;
  end_balance_usd: string;
  appreciation_pct: string;
  other_return_pct: string;
  usd_spending_change_pct: string;
  bitcoin_cost_change_pct: string;
  spending_model: "USD" | "BITCOIN";
}
export interface ProjectionPoint {
  month: number;
  date: string;
  age: string;
  bitcoin: string;
  price_usd: string;
  other_assets_usd: string;
  cash_usd: string;
  portfolio_usd: string;
  portfolio_bitcoin: string;
  annual_spending_usd: string;
  annual_spending_bitcoin: string;
  withdrawals_usd: string;
  withdrawals_bitcoin: string;
  shortfall_usd: string;
}
export interface ForecastResult {
  assumptions: ForecastInput;
  retirement: ProjectionPoint;
  end: ProjectionPoint;
  history: ProjectionPoint[];
  sustainable: boolean;
  depletion_date: string | null;
  depletion_age: string | null;
  shortfall_usd: string;
  target_surplus_usd: string;
  total_spending_usd: string;
}
export interface Scenario {
  id: number;
  name: string;
  version: number;
  assumptions: ForecastInput;
  created_at: string;
  updated_at: string;
}
export interface Comparison {
  id: number;
  name: string;
  result: ForecastResult;
}
export interface StartingPosition {
  as_of: string;
  bitcoin: string | null;
  other_assets_usd: string | null;
  cash_usd: string | null;
  liabilities_usd: string | null;
  price_usd: string | null;
  rate_source: string | null;
  rate_day: string | null;
  previous_month: string;
  previous_month_spending_usd: string | null;
  previous_month_income_usd: string | null;
  previous_month_entries: number;
}
export function emptyPlan(asOf: string): ForecastInput {
  return {
    as_of: asOf,
    current_age: 35,
    retirement_age: 65,
    planning_age: 90,
    bitcoin: "0",
    other_assets_usd: "0",
    cash_usd: "0",
    liabilities_usd: "0",
    price_usd: "",
    monthly_savings_usd: "0",
    monthly_purchase_usd: "0",
    monthly_spending_usd: "0",
    monthly_spending_bitcoin: "0",
    monthly_retirement_income_usd: "0",
    end_balance_usd: "0",
    appreciation_pct: "0",
    other_return_pct: "0",
    usd_spending_change_pct: "0",
    bitcoin_cost_change_pct: "0",
    spending_model: "USD",
  };
}
