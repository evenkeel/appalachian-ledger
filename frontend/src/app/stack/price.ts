import type { Transaction } from "../../lib/types";
import { cents, fromCents } from "../lib/format";

/** Whole-number division rounded half to even, for positive values. */
function halfEven(numerator: bigint, divisor: bigint) {
  const quotient = numerator / divisor,
    twice = (numerator % divisor) * 2n;
  return twice > divisor || (twice === divisor && quotient % 2n === 1n) ? quotient + 1n : quotient;
}

/** One BTC is 100,000,000 whole bitcoin units. */
const PER_BTC = 100_000_000n;

/** The price actually paid, in dollars per BTC, from the cents spent and the bitcoin received. */
export function usdPerBtc(spent: bigint, bitcoin: bigint): string | null {
  if (spent <= 0n || bitcoin <= 0n) return null;
  return fromCents(halfEven(spent * PER_BTC, bitcoin));
}

/** The same price the other way round: whole bitcoin received per dollar. */
export function bitcoinPerDollar(spent: bigint, bitcoin: bigint): string | null {
  if (spent <= 0n || bitcoin <= 0n) return null;
  return halfEven(bitcoin * 100n, spent).toString();
}

export interface Buy {
  id: number;
  date: string;
  description: string;
  from: string;
  wallet: string;
  spent: bigint;
  bitcoin: bigint;
  /** Dollars per BTC, to the cent. */
  price: string | null;
  perDollar: string | null;
  /** Bitcoin bought up to and including this buy. */
  soFar: bigint;
}

/** A bitcoin buy is dollars moved into a bitcoin account, with the bitcoin received written down. */
export const isBuy = (row: Transaction) =>
  row.kind === "transfer" && row.currency === "USD" && row.destination_currency === "BITCOIN" && /^\d+$/.test(row.destination_amount ?? "");

/** Every buy, newest first, each with the price paid and the running total bought. */
export function buysFrom(rows: Transaction[]): Buy[] {
  const oldestFirst = rows.filter(isBuy).sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  let soFar = 0n;
  return oldestFirst
    .map((row) => {
      const spent = cents(row.amount),
        bitcoin = BigInt(row.destination_amount!);
      soFar += bitcoin;
      return {
        id: row.id,
        date: row.date,
        description: row.description,
        from: row.account,
        wallet: row.destination_account ?? "",
        spent,
        bitcoin,
        price: usdPerBtc(spent, bitcoin),
        perDollar: bitcoinPerDollar(spent, bitcoin),
        soFar,
      };
    })
    .reverse();
}

export function totals(buys: Buy[]) {
  const spent = buys.reduce((sum, buy) => sum + buy.spent, 0n),
    bitcoin = buys.reduce((sum, buy) => sum + buy.bitcoin, 0n);
  return { spent, bitcoin, average: usdPerBtc(spent, bitcoin) };
}
