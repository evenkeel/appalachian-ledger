/** Exact conversion between whole bitcoin units (₿) and the older BTC unit. No floats anywhere. */
export const PER_BTC = 100_000_000n;
/** Every bitcoin there will ever be, in whole units: 21 million BTC. */
export const SUPPLY = 21_000_000n * PER_BTC;

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const strip = (text: string) => text.replace(/[₿,\s]/g, "").replace(/btc$/i, "");

/** "₿125,000" or "125000" → 125000n. Null when it is not a whole, non-negative number. */
export function parseWhole(text: string): bigint | null {
  const clean = strip(text);
  return /^\d{1,30}$/.test(clean) ? BigInt(clean) : null;
}

/** "0.00125" → 125000n. Null when it is not a number, or has more than eight decimal places. */
export function parseBtc(text: string): bigint | null {
  const clean = strip(text);
  if (!/^(\d{1,22}(\.\d{0,8})?|\.\d{1,8})$/.test(clean)) return null;
  const [whole = "", fraction = ""] = clean.split(".");
  return BigInt(whole || "0") * PER_BTC + BigInt(fraction.padEnd(8, "0"));
}

/** 125000n → "0.00125"; trailing zeros dropped, the whole part grouped in thousands. */
export function wholeToBtc(units: bigint): string {
  const fraction = String(units % PER_BTC)
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${group(String(units / PER_BTC))}${fraction ? `.${fraction}` : ""}`;
}

/** 125000n → "125,000" (the caller adds the ₿ sign). */
export const wholeText = (units: bigint) => group(units.toString());
