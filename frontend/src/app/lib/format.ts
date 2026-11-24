import { formatMoney } from "../../lib/money";

/** Exact formatting from decimal strings; money never becomes a JavaScript number here. */
export const usd = (value: string | null | undefined) => formatMoney(value, "USD");
export const btc = (value: string | null | undefined) => formatMoney(value, "BITCOIN");

/** Whole dollars for axis labels and limits ($6,000). Rounds half up, exactly. */
export function usdWhole(value: string | null | undefined) {
  if (value == null || !/^-?\d+(\.\d+)?$/.test(value)) return "Unavailable";
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const dollars = BigInt(whole) + (fraction[0] >= "5" ? 1n : 0n);
  return `${negative && dollars !== 0n ? "−" : ""}$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Cents as a bigint, for exact comparisons and sums of dollar strings. */
export function cents(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -units : units;
}
export function fromCents(units: bigint) {
  const abs = units < 0n ? -units : units;
  return `${units < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Chart coordinates only. Never use the result as a displayed amount. */
export const coordinate = (value: string | null | undefined) => (value == null ? 0 : Number(value));

const parse = (iso: string) => new Date(`${iso}T12:00:00`);
export const shortDate = (iso: string) =>
  parse(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const monthName = (month: string) =>
  parse(`${month}-01`).toLocaleDateString("en-US", { month: "short" });
export const longMonth = (month: string) =>
  parse(`${month}-01`).toLocaleDateString("en-US", { month: "long" });
/** A month with its year, for anything that can be more than a year back: "November 2021", "Nov 2021". */
export const monthYear = (month: string) => `${longMonth(month)} ${month.slice(0, 4)}`;
export const shortMonthYear = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
export function daysBetween(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000);
}
export function addDays(iso: string, days: number) {
  const date = parse(iso);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Compact bitcoin for tape labels only ("21.5M"). */
export function btcShort(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(abs % 1e6 ? 1 : 0)}M`;
  if (abs >= 1e3) return `${Math.round(abs / 1e3)}k`;
  return String(abs);
}

/** Whole bitcoin a dollar amount buys at a quote of bitcoin per $1, rounded down. An estimate for labels only. */
export function bitcoinFor(centsValue: bigint, bitcoinPerUsd: string) {
  if (!/^\d+(\.\d+)?$/.test(bitcoinPerUsd)) return null;
  const [whole, fraction = ""] = bitcoinPerUsd.split(".");
  const scaled = BigInt(whole + fraction.padEnd(8, "0").slice(0, 8));
  return (centsValue * scaled) / 10_000_000_000n;
}
