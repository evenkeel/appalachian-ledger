export type Denomination = "BITCOIN" | "BTC" | "USD";
export const unitLabel = (unit: Denomination) =>
  unit === "BITCOIN" ? "bitcoin" : unit;

/** Actual whole bitcoin units received per dollar, rounded for display only. */
export function formatBitcoinPerDollar(bitcoin: string, dollars: string) {
  if (!/^\d+$/.test(bitcoin) || !/^\d+(?:\.\d{1,2})?$/.test(dollars))
    return "Unavailable";
  const [whole, fraction = ""] = dollars.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents === 0n || BigInt(bitcoin) === 0n) return "Unavailable";
  const hundredths = (BigInt(bitcoin) * 10000n + cents / 2n) / cents;
  return formatBitcoinRateHundredths(hundredths);
}

/** Convert a stored USD-per-100,000,000-bitcoin reference without using floats. */
export function formatBitcoinPerDollarFromRate(
  rate: string | null | undefined,
) {
  if (!rate || !/^\d+(?:\.\d+)?$/.test(rate)) return "Unavailable";
  const [whole, fraction = ""] = rate.split(".");
  const scaled = BigInt(whole + fraction);
  if (scaled === 0n) return "Unavailable";
  const scale = 10n ** BigInt(fraction.length);
  return formatBitcoinRateHundredths(
    (10000000000n * scale + scaled / 2n) / scaled,
  );
}

function formatBitcoinRateHundredths(hundredths: bigint) {
  if (hundredths === 0n) return "<₿0.01 / $1";
  const grouped = String(hundredths / 100n).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `₿${grouped}.${String(hundredths % 100n).padStart(2, "0")} / $1`;
}

/** Format decimal strings without ever converting financial values to IEEE-754. */
export function formatMoney(
  value: string | null | undefined,
  denomination: Denomination = "BITCOIN",
) {
  if (value == null) return "Unavailable";
  if (!/^-?\d+(\.\d+)?$/.test(value)) return "Unavailable";
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const places = denomination === "BTC" ? 8 : denomination === "USD" ? 2 : 0;
  // Extra digits round half up instead of being cut off ($67,123.456 → $67,123.46).
  let units = BigInt(whole + fraction.padEnd(places, "0").slice(0, places));
  if (fraction.length > places && fraction[places] >= "5") units += 1n;
  const digits = units.toString().padStart(places + 1, "0");
  const rounded = digits
    .slice(0, digits.length - places)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = places ? "." + digits.slice(-places) : "";
  return `${negative && units !== 0n ? "−" : ""}${denomination === "USD" ? "$" : denomination === "BITCOIN" ? "₿" : ""}${rounded}${decimals}`;
}

const decimalPattern = /^-?\d+(\.\d{1,8})?$/;
function scaleDecimal(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole + fraction.padEnd(8, "0"));
  return negative ? -units : units;
}
function unscaleDecimal(units: bigint) {
  const digits = (units < 0n ? -units : units).toString().padStart(9, "0");
  const fraction = digits.slice(-8).replace(/0+$/, "");
  return `${units < 0n ? "-" : ""}${digits.slice(0, -8)}${fraction ? "." + fraction : ""}`;
}

/** Exact a − b for decimal strings (up to eight places); display maths never touches floats. */
export function subtractMoney(
  a: string | null | undefined,
  b: string | null | undefined,
) {
  if (
    a == null ||
    b == null ||
    !decimalPattern.test(a) ||
    !decimalPattern.test(b)
  )
    return null;
  return unscaleDecimal(scaleDecimal(a) - scaleDecimal(b));
}

/** Exact total of the available values, with a count of those that were unavailable. */
export function sumMoney(values: (string | null | undefined)[]) {
  let total = 0n,
    missing = 0;
  for (const value of values) {
    if (value == null || !decimalPattern.test(value)) missing += 1;
    else total += scaleDecimal(value);
  }
  return { total: unscaleDecimal(total), missing };
}

/** Percentage change for labels only; null when the base is zero or unavailable. */
export function percentChange(
  from: string | null | undefined,
  to: string | null | undefined,
) {
  if (from == null || to == null) return null;
  const start = Number(from),
    end = Number(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0)
    return null;
  return ((end - start) / Math.abs(start)) * 100;
}
