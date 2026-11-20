import { btc, cents, fromCents, usd } from "../lib/format";

export interface Holding {
  symbol: string;
  shares: string;
  cost_basis: string | null;
  value: string;
  gain: string | null;
  gain_percent: string | null;
  /** Null when no quote has been saved for this ticker. */
  price: string | null;
  day_change: string | null;
  observed_at: string | null;
  fetched_at: string | null;
  stale: boolean;
}
export interface Portfolio {
  holdings: Holding[];
  cash: string;
  started_on: string;
  error: string | null;
  source: string;
}
export interface Account {
  id: number;
  name: string;
  kind: string;
  role: "asset" | "liability";
  currency: "USD" | "BITCOIN";
  holding_type: "debt" | "valued_asset" | "bitcoin" | "dollars";
  archived: boolean;
  exclude_from_liquid_usd: boolean;
  exclude_from_consumer_debt?: boolean;
  portfolio?: Portfolio | null;
  balance: string;
  balance_minor: string;
  bitcoin: string | null;
  usd: string | null;
}

export const KIND: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  bitcoin_wallet: "Bitcoin wallet",
  credit_card: "Credit card",
  loan: "Loan",
  mortgage: "Mortgage",
  brokerage: "Brokerage",
  real_estate: "Home or property",
  vehicle: "Vehicle",
  stock: "Stock",
  etf: "Fund",
  other_asset: "Other asset",
  other_liability: "Other debt",
};

export type Currency = Account["currency"];
export const money = (value: string | null | undefined, currency: Currency) => (currency === "USD" ? usd(value) : btc(value));
export const native = (account: Account) => money(account.balance, account.currency);

/** Accounts valued from shares: a brokerage account, or a single stock or fund held as its own account. */
export const holdsShares = (account: Account) => account.role === "asset" && account.currency === "USD" && ["brokerage", "stock", "etf"].includes(account.kind);
/** Things valued by hand, where a new value is a dated record. */
export const valuedByHand = (account: Account) => account.role === "asset" && ["real_estate", "vehicle", "other_asset"].includes(account.kind);
const CASH_KINDS = ["bitcoin_wallet", "checking", "savings", "cash"];
/** What an account can pay out: its balance, or a share account's uninvested cash. Null when it cannot pay. */
export function spendable(account: Account) {
  if (account.archived || account.role !== "asset") return null;
  if (CASH_KINDS.includes(account.kind)) return account.balance;
  return holdsShares(account) ? (account.portfolio?.cash ?? null) : null;
}

/** An amount typed by a person, in the account's own unit, as exact minor units. Null if it is not an amount. */
export function typed(text: string, currency: Currency) {
  const clean = text.replace(/[$₿,\s]/g, "");
  if (!(currency === "USD" ? /^\d+(\.\d{1,2})?$/ : /^\d+$/).test(clean)) return null;
  return currency === "USD" ? cents(clean) : BigInt(clean);
}
export const untyped = (minor: bigint, currency: Currency) => (currency === "USD" ? fromCents(minor) : minor.toString());

/** A signed change, such as +$40.00 or −₿12,000, from exact minor units. */
export function signed(minor: bigint, currency: Currency) {
  const size = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "−" : "+"}${money(untyped(size, currency), currency)}`;
}

/** A saved moment, such as "Nov 19, 3:59 PM", in this device's time zone. */
export function moment(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
