/** What the server works out for the retirement screen. Every amount is an exact decimal string. */

export interface RetirementSettings {
  birth_date: string | null;
  growth_pct: string | null;
  last_age: number;
  cost_rise_pct: string;
  tax_pct: string;
  other_income_usd: string;
  other_income_age: number;
  monthly_spending_usd: string | null;
  monthly_purchase_usd: string | null;
  use_record: boolean;
  measure_from: number | null;
  freed_to_bitcoin: boolean;
  category_shares: Record<string, number>;
  left_out_entries: number[];
}
export interface Stop {
  month: number;
  age: number;
  date: string;
  bitcoin: string;
  need: string;
  first_year_pct: string | null;
  first_month_bitcoin: string;
}
export interface CrossPoint {
  month: number;
  age: string;
  date: string;
  stack: string;
  need: string;
}
export interface RunwayPoint {
  month: number;
  age: string;
  date: string;
  months: number | null;
  /** With part months, for drawing. */
  exact_months: string | null;
  left_months: number;
}
/** How long the stack pays for everything if the owner stopped today. Null months means for life. */
export interface Runway {
  months: number | null;
  flat_months: number | null;
  before: { date: string; months: number | null; price_usd: string } | null;
  points?: RunwayPoint[];
  milestones?: { months: number; stop: { month: number; age: number } | null }[];
}
export interface Lever {
  id: string;
  label: string;
  applied: boolean;
  frees_money: boolean;
  runway_days: number | null;
  runway_for_life: boolean;
  months_sooner: number | null;
  reaches_age: number | null;
}
export interface AfterSeries {
  points: { age: string; bitcoin: string }[];
  out_age: number | null;
}
export interface Answer {
  state: "not_yet" | "funded";
  age_today: number;
  first: Stop | null;
  safe: Stop | null;
  chart: CrossPoint[];
  levers: Lever[];
  /** What each crash right after stopping would do. A null month is the price halving for good; null runway lasts to the end. */
  crashes: { month: string | null; runway_months: number | null; out_age: number | null }[];
  after: AfterSeries | null;
  price_path: { age: string; usd: string }[];
  price_in: { years: number; usd: string }[];
  projected_years: { year: number; usd: string }[];
}
export interface Category {
  id: number;
  name: string;
  monthly_usd: string;
  share: number;
}
export interface RetirementView {
  as_of: string;
  status: "ready" | "needs_price" | "needs_spending" | "needs_birth_date" | "needs_growth";
  settings: RetirementSettings;
  money_supply_pct: string;
  bitcoin_record: { through: string; rows: { years: number; pct: string }[] };
  ledger: {
    bitcoin: string;
    price_usd: string | null;
    rate_source: string | null;
    rate_day: string | null;
    debts: { name: string; owed_usd: string; monthly_usd: string }[];
    purchase_usd: string;
    recorded_purchase_usd: string;
    purchase_months: number;
    spending_usd: string;
    recorded_spending_usd: string;
    spending_basis: "record" | "early" | "bills" | "entered" | "none";
    spending_months: number;
    spending_missing: number;
    categories: Category[];
    one_offs: { id: number; date: string; description: string; usd: string; left_out: boolean }[];
    years: { year: number; start: string; end: string; usd: string | null; bitcoin: string | null }[];
    trend: { pct: string; years: number; from: number } | null;
  };
  today: {
    worth_usd: string;
    year_usd: string;
    year_bitcoin: string;
    covered_months: number | null;
    year_share_pct: string | null;
    funded_pct?: string | null;
    hurdle_pct?: string | null;
  } | null;
  runway: Runway | null;
  answer: Answer | null;
}

const count = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;

/** "3 years 7 months" from a number of months. */
export function span(months: number) {
  const years = Math.floor(months / 12),
    rest = months % 12;
  return [years ? count(years, "year") : "", rest ? count(rest, "month") : ""].filter(Boolean).join(" ") || "less than a month";
}

/** "15" and "15.0" both read "15%". */
export const percent = (value: string) => `${value.includes(".") ? value.replace(/\.?0+$/, "") : value}%`;

/** "3 months", or "For life" when it never runs out. */
export const runwayText = (months: number | null) => (months === null ? "For life" : months === 0 ? "Under a month" : span(months));

/** What a lever does to today's runway: "4 days more runway now". Empty when it does nothing yet. */
export function leverRunway(lever: Lever) {
  if (lever.runway_for_life) return "runway for life";
  const days = lever.runway_days ?? 0;
  if (!days) return "";
  const size = Math.abs(days);
  return `${size < 60 ? count(size, "day") : span(Math.floor((size * 12) / 365))} ${days > 0 ? "more" : "less"} runway now`;
}

/** What a lever does to the age: "1 year 3 months sooner". */
export function leverText(lever: Lever) {
  if (lever.reaches_age !== null) return `to ${lever.reaches_age}`;
  if (!lever.months_sooner) return "no change";
  return lever.months_sooner > 0 ? `${span(lever.months_sooner)} sooner` : `${span(-lever.months_sooner)} later`;
}

type Check = { low: number; high: number; places: number; blank?: boolean; whole?: boolean };
export const CHECKS: Record<string, Check> = {
  growth_pct: { low: -20, high: 100, places: 4, blank: true },
  cost_rise_pct: { low: -5, high: 25, places: 4 },
  tax_pct: { low: 0, high: 60, places: 4 },
  other_income_usd: { low: 0, high: 10_000_000, places: 2 },
  monthly_spending_usd: { low: 0, high: 10_000_000, places: 2, blank: true },
  monthly_purchase_usd: { low: 0, high: 10_000_000, places: 2, blank: true },
  last_age: { low: 50, high: 115, places: 0, whole: true },
  other_income_age: { low: 18, high: 115, places: 0, whole: true },
};

/** A typed field as the server expects it: the value, null for a blank that is allowed, or what is wrong. */
export function readField(name: string, typed: string): { value: string | number | null } | { error: string } {
  const check = CHECKS[name];
  const tidy = typed.replace(/[$,%\s]/g, "").replace(/−/g, "-");
  if (!tidy) return check.blank ? { value: null } : { error: "Enter a number" };
  const shape = check.places ? new RegExp(`^-?\\d+(\\.\\d{1,${check.places}})?$`) : /^\d+$/;
  if (tidy.length > 20 || !shape.test(tidy) || Number(tidy) < check.low || Number(tidy) > check.high) {
    if (check.places === 2 && /^\d+\.\d{3,}$/.test(tidy)) return { error: "Use dollars and cents, like 1250.00" };
    return { error: `Enter ${check.whole ? "a whole age" : "a number"} from ${check.low} to ${check.high.toLocaleString("en-US")}` };
  }
  return { value: check.whole ? Number(tidy) : tidy };
}
