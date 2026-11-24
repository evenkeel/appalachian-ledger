/**
 * Answers `/spending-history` for any span from the demo's saved months.
 *
 * The app's server prices every expense and adds them up. The demo has no server, so its build
 * saves the server's answer for each single month, and this adds those rows up the same way:
 * the same grouping, the same exact decimal sums, and a total left empty when any row in it
 * has no price. The demo build checks this against the server's own answers for longer spans.
 */

export interface Row {
  id: number;
  date: string;
  category: string;
  account: string;
  usd: string | null;
  bitcoin: string | null;
  hypothetical_value_usd: string | null;
  [key: string]: unknown;
}
export interface MonthAnswer {
  transactions: Row[];
  current_reference: unknown;
}
export interface Ask {
  start: string;
  end: string;
  interval: "month" | "year";
  category?: string | null;
  account?: string | null;
}

/** Exact decimal sum of strings such as "12.50" and "7"; null if any is missing. */
export function addNullable(values: (string | null)[]): string | null {
  if (values.some((value) => value === null)) return null;
  let places = 0;
  for (const value of values as string[]) places = Math.max(places, (value.split(".")[1] ?? "").length);
  let total = 0n;
  for (const value of values as string[]) {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const scaled = BigInt(whole + fraction.padEnd(places, "0"));
    total += negative ? -scaled : scaled;
  }
  if (places === 0) return total.toString();
  const digits = (total < 0n ? -total : total).toString().padStart(places + 1, "0");
  return `${total < 0n ? "-" : ""}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

function aggregate(rows: Row[]) {
  return {
    count: rows.length,
    usd: addNullable(rows.map((row) => row.usd)),
    bitcoin: addNullable(rows.map((row) => row.bitcoin)),
    hypothetical_value_usd: addNullable(rows.map((row) => row.hypothetical_value_usd)),
    missing_usd: rows.filter((row) => row.usd === null).length,
    missing_bitcoin: rows.filter((row) => row.bitcoin === null).length,
  };
}

/** The months, newest first, whose saved answers cover the span. */
export function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let [year, month] = [Number(end.slice(0, 4)), Number(end.slice(5, 7))];
  const first = start.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key < first) return months;
    months.push(key);
    month -= 1;
    if (month === 0) [year, month] = [year - 1, 12];
  }
}

/** ``answers`` must be newest month first, the order the server lists entries in. */
export function composeSpending(ask: Ask, answers: MonthAnswer[]) {
  const rows = answers
    .flatMap((answer) => answer.transactions)
    .filter(
      (row) =>
        row.date >= ask.start &&
        row.date <= ask.end &&
        (!ask.category || row.category === ask.category) &&
        (!ask.account || row.account === ask.account),
    );
  const groups = new Map<string, Row[]>();
  const categories = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.date.slice(0, ask.interval === "year" ? 4 : 7);
    groups.set(key, [...(groups.get(key) ?? []), row]);
    categories.set(row.category, [...(categories.get(row.category) ?? []), row]);
  }
  const sorted = (map: Map<string, Row[]>) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    start: ask.start,
    end: ask.end,
    interval: ask.interval,
    totals: aggregate(rows),
    periods: sorted(groups).map(([period, items]) => ({ period, ...aggregate(items) })),
    categories: sorted(categories).map(([name, items]) => ({ name, ...aggregate(items) })),
    transactions: rows.slice(0, 500),
    transactions_truncated: rows.length > 500,
    current_reference: answers[0]?.current_reference ?? null,
  };
}
