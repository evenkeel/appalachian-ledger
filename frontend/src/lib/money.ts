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
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const places = denomination === "BTC" ? 8 : denomination === "USD" ? 2 : 0;
  const decimals = places
    ? "." + fraction.padEnd(places, "0").slice(0, places)
    : "";
  return `${negative ? "−" : ""}${denomination === "USD" ? "$" : denomination === "BITCOIN" ? "₿" : ""}${grouped}${decimals}`;
}
