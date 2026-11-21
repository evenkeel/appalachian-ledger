import type { ForecastInput } from "../../lib/planning";

/** Checks that mirror the server's (backend/app/forecasting.py), so a typo is caught before anything is sent. */

export type Field = keyof ForecastInput;
export type Errors = Partial<Record<Field, string>>;

const DOLLARS: Field[] = [
  "other_assets_usd",
  "cash_usd",
  "liabilities_usd",
  "monthly_savings_usd",
  "monthly_purchase_usd",
  "monthly_spending_usd",
  "monthly_retirement_income_usd",
  "end_balance_usd",
];
const BITCOIN: Field[] = ["bitcoin", "monthly_spending_bitcoin"];
const RATES: Field[] = ["appreciation_pct", "other_return_pct", "usd_spending_change_pct", "bitcoin_cost_change_pct"];

/** The largest amount the ledger stores, in its smallest unit. */
const LIMIT = 2n ** 63n - 1n;
const SCALE = 100_000_000n;

/** What was typed, without the symbols and separators people add: "$1,250.00" is "1250.00". A blank amount is zero. */
export const tidy = (value: string) => value.replace(/[$₿,%\s]/g, "").replace(/−/g, "-") || "0";

/** A plain decimal as a whole number of hundred-millionths, or null if it is not one. */
function scaled(value: string) {
  if (!/^-?\d+(\.\d{1,8})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  return negative ? -units : units;
}

export const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * The assumptions as the server expects them, plus what is wrong with them.
 * `payload` is null when the bitcoin price is still blank: there is nothing to calculate yet.
 */
export function prepare(inputs: ForecastInput): { payload: ForecastInput | null; errors: Errors } {
  const errors: Errors = {};
  const payload: ForecastInput = { ...inputs };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(inputs.as_of) || Number.isNaN(Date.parse(`${inputs.as_of}T12:00:00`))) errors.as_of = "Choose a starting date";

  const ages: [Field, number, number][] = [
    ["current_age", 0, 119],
    ["retirement_age", 0, 119],
    ["planning_age", 1, 120],
  ];
  for (const [field, low, high] of ages) {
    const age = inputs[field] as number;
    if (!Number.isInteger(age) || age < low || age > high) errors[field] = `Enter a whole age from ${low} to ${high}`;
  }
  if (!errors.current_age && !errors.retirement_age && !errors.planning_age) {
    if (inputs.retirement_age < inputs.current_age) errors.retirement_age = "Retirement age cannot be below your age now";
    else if (inputs.retirement_age >= inputs.planning_age) errors.planning_age = "Plan through an age above the retirement age";
    else if (inputs.planning_age - inputs.current_age > 100) errors.planning_age = "The plan can cover at most 100 years";
  }

  for (const field of DOLLARS) {
    const value = tidy(inputs[field] as string);
    (payload[field] as string) = value;
    if (value.length > 80 || !/^\d+(\.\d{1,2})?$/.test(value)) errors[field] = "Enter dollars and cents, zero or more, like 1250.00";
    else if (scaled(value)! / (SCALE / 100n) > LIMIT) errors[field] = "That amount is larger than the ledger can hold";
  }
  for (const field of BITCOIN) {
    const value = tidy(inputs[field] as string);
    (payload[field] as string) = value;
    if (value.length > 80 || !/^\d+$/.test(value)) errors[field] = "Enter whole bitcoin units, zero or more, like 125000";
    else if (BigInt(value) > LIMIT) errors[field] = "That amount is larger than the ledger can hold";
  }
  for (const field of RATES) {
    const value = tidy(inputs[field] as string);
    (payload[field] as string) = value;
    const rate = value.length > 80 ? null : scaled(value);
    if (rate === null || rate < -99n * SCALE || rate > 1000n * SCALE) errors[field] = "Enter a yearly rate from −99 to 1000 percent";
  }

  const price = inputs.price_usd.replace(/[$,\s]/g, "");
  payload.price_usd = price;
  if (price === "") return { payload: null, errors };
  const rate = price.length > 80 ? null : scaled(price);
  if (rate === null || rate < 1n || rate > 1_000_000_000_000n * SCALE) errors.price_usd = "Enter a price in dollars per BTC, above zero";

  return { payload, errors };
}

/** Rounded figures for chart axes only ("$1.2M", "₿350k"). Never shown as an amount. */
export function compact(value: number, unit: "USD" | "BITCOIN") {
  const sign = unit === "USD" ? "$" : "₿";
  const abs = Math.abs(value);
  const steps: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  if (abs >= 1e15) return `${sign}${abs.toExponential(1)}`;
  for (const [size, letter] of steps)
    if (abs >= size) {
      const scaledDown = abs / size;
      return `${sign}${scaledDown >= 100 ? Math.round(scaledDown) : Number(scaledDown.toFixed(1))}${letter}`;
    }
  return `${sign}${Math.round(abs)}`;
}

/** "March 2062" from an ISO date. */
export const monthYear = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/** "71" from the server's "71.25": the last birthday reached. */
export const wholeAge = (age: string) => age.split(".")[0];
