import type { Category, Transaction } from "./types";

export type AnalysisUnit = "USD" | "BITCOIN";
export type Amount = bigint | null;
export interface SpendingTotal {
  value: Amount;
  count: number;
  missing: number;
}
export interface AnalysisCategory {
  key: string;
  name: string;
  current: SpendingTotal;
  previous: SpendingTotal;
  change: Amount;
  history: { month: string; total: SpendingTotal }[];
}
export interface WaterfallStep {
  key: string;
  name: string;
  keys: string[];
  change: bigint;
  start: bigint;
  end: bigint;
}
export interface SpendingAnalysis {
  month: string;
  previousMonth: string;
  currentDays: number;
  previousDays: number;
  cutoff: number;
  previousCutoff: number;
  future: boolean;
  current: SpendingTotal;
  previous: SpendingTotal;
  change: Amount;
  rows: Transaction[];
  previousRows: Transaction[];
  categories: AnalysisCategory[];
  waterfall: WaterfallStep[];
  pace: { day: number; current: Amount; previous: Amount }[];
  calendar: {
    date: string;
    day: number;
    future: boolean;
    total: SpendingTotal;
  }[];
}

export const categoryKey = (row: Transaction) =>
  String(row.category_id ?? "uncategorized");
export const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
export function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return monthKey(new Date(year, number - 1 + offset, 1));
}
export function daysInMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(year, number, 0).getDate();
}

// Financial aggregation stays in integer cents / native whole bitcoin units.
export function parseMinor(value: string, unit: AnalysisUnit): bigint {
  const [whole, fraction = ""] = value.split(".");
  return unit === "USD"
    ? BigInt(whole) * 100n +
        BigInt(fraction.padEnd(2, "0")) * (value.startsWith("-") ? -1n : 1n)
    : BigInt(whole);
}
export function decimalAmount(
  value: Amount,
  unit: AnalysisUnit,
): string | null {
  if (value === null) return null;
  if (unit === "BITCOIN") return String(value);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
export const chartAmount = (value: Amount, unit: AnalysisUnit) =>
  value === null ? null : Number(value) / (unit === "USD" ? 100 : 1);
export function transactionAmount(
  row: Transaction,
  unit: AnalysisUnit,
): Amount {
  if (row.currency === unit) return parseMinor(row.amount, unit);
  const saved =
    unit === "USD" ? row.purchase_cost?.usd : row.purchase_cost?.bitcoin;
  return saved == null ? null : parseMinor(saved, unit);
}
export function totalSpending(
  rows: Transaction[],
  unit: AnalysisUnit,
): SpendingTotal {
  let sum = 0n,
    missing = 0;
  for (const row of rows) {
    const value = transactionAmount(row, unit);
    if (value === null) missing++;
    else sum += value;
  }
  return { value: missing ? null : sum, missing, count: rows.length };
}
export const difference = (a: Amount, b: Amount): Amount =>
  a === null || b === null ? null : a - b;
const abs = (n: bigint) => (n < 0n ? -n : n);
const dayOf = (row: Transaction) => Number(row.date.slice(8, 10));

export function analyzeSpending({
  transactions,
  categories,
  month,
  unit,
  account = "",
  category = "",
  now = new Date(),
}: {
  transactions: Transaction[];
  categories: Category[];
  month: string;
  unit: AnalysisUnit;
  account?: string;
  category?: string;
  now?: Date;
}): SpendingAnalysis {
  const todayMonth = monthKey(now);
  const future = month > todayMonth;
  const previousMonth = shiftMonth(month, -1);
  const currentDays = daysInMonth(month),
    previousDays = daysInMonth(previousMonth);
  const cutoff = future
    ? 0
    : month === todayMonth
      ? now.getDate()
      : currentDays;
  const previousCutoff =
    month === todayMonth ? Math.min(cutoff, previousDays) : previousDays;
  const filtered = transactions.filter(
    (row) =>
      row.kind === "expense" &&
      (!account || String(row.account_id) === account) &&
      (!category || categoryKey(row) === category),
  );
  const inMonth = (key: string, end: number) =>
    filtered.filter(
      (row) => row.date.startsWith(`${key}-`) && dayOf(row) <= end,
    );
  const rows = inMonth(month, cutoff),
    previousRows = future ? [] : inMonth(previousMonth, previousCutoff);
  const current = totalSpending(rows, unit),
    previous = totalSpending(previousRows, unit);
  const historyMonths = Array.from({ length: 6 }, (_, i) =>
    shiftMonth(month, i - 5),
  );
  const historyRows = historyMonths.map((key) =>
    inMonth(key, key === month ? cutoff : daysInMonth(key)),
  );
  const names = new Map(categories.map((c) => [String(c.id), c.name]));
  const keys = new Map<string, string>();
  for (const row of [...historyRows.flat(), ...previousRows]) {
    const key = categoryKey(row);
    keys.set(
      key,
      key === "uncategorized"
        ? "Uncategorized"
        : (names.get(key) ?? row.category),
    );
  }
  const categoryRows = [...keys]
    .map(([key, name]): AnalysisCategory => {
      const matching = (items: Transaction[]) =>
        items.filter((row) => categoryKey(row) === key);
      const current = totalSpending(matching(rows), unit),
        previous = totalSpending(matching(previousRows), unit);
      return {
        key,
        name,
        current,
        previous,
        change: difference(current.value, previous.value),
        history: historyMonths.map((month, i) => ({
          month,
          total: totalSpending(matching(historyRows[i]), unit),
        })),
      };
    })
    .sort((a, b) => {
      if (a.change === null || b.change === null)
        return a.change === b.change
          ? a.name.localeCompare(b.name)
          : a.change === null
            ? -1
            : 1;
      const delta = abs(b.change) - abs(a.change);
      return delta === 0n ? a.name.localeCompare(b.name) : delta > 0n ? 1 : -1;
    });
  const waterfall: WaterfallStep[] = [];
  if (current.value !== null && previous.value !== null) {
    const changed = categoryRows.filter((c) => c.change !== 0n);
    const groups = changed.slice(0, 6).map((c) => ({
      key: c.key,
      name: c.name,
      keys: [c.key],
      change: c.change!,
    }));
    if (changed.length > 6)
      groups.push({
        key: "other",
        name: "Other changes",
        keys: changed.slice(6).map((c) => c.key),
        change: changed.slice(6).reduce((sum, c) => sum + c.change!, 0n),
      });
    let running = previous.value;
    for (const group of groups) {
      waterfall.push({ ...group, start: running, end: running + group.change });
      running += group.change;
    }
  }
  const pace = Array.from(
    { length: Math.max(currentDays, previousDays) },
    (_, i) => ({
      day: i + 1,
      current:
        i < cutoff
          ? totalSpending(
              rows.filter((row) => dayOf(row) <= i + 1),
              unit,
            ).value
          : null,
      previous:
        !future && i < previousDays
          ? totalSpending(inMonth(previousMonth, i + 1), unit).value
          : null,
    }),
  );
  const calendar = Array.from({ length: currentDays }, (_, i) => ({
    day: i + 1,
    date: `${month}-${String(i + 1).padStart(2, "0")}`,
    future: i >= cutoff,
    total: totalSpending(
      rows.filter((row) => dayOf(row) === i + 1),
      unit,
    ),
  }));
  return {
    month,
    previousMonth,
    currentDays,
    previousDays,
    cutoff,
    previousCutoff,
    future,
    current,
    previous,
    change: difference(current.value, previous.value),
    rows,
    previousRows,
    categories: categoryRows,
    waterfall,
    pace,
    calendar,
  };
}
