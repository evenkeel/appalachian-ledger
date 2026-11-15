import { expect, test } from "vitest";
import {
  analyzeSpending,
  decimalAmount,
  parseMinor,
  totalSpending,
  transactionAmount,
} from "./spendingAnalysis";
import {
  analysisExpenses,
  expense,
  expenseCategories,
} from "../test/expenseFixtures";
const base = {
  transactions: analysisExpenses,
  categories: expenseCategories,
  month: "2026-11",
  unit: "USD" as const,
  now: new Date(2026, 10, 7, 12),
};

test("matching elapsed dates drive totals and waterfall while previous pace continues", () => {
  const a = analyzeSpending(base);
  expect(a.current.value).toBe(14000n);
  expect(a.previous.value).toBe(14500n);
  expect(a.change).toBe(-500n);
  expect(a.pace[6]).toEqual({ day: 7, current: 14000n, previous: 14500n });
  expect(a.pace[7].current).toBeNull();
  expect(a.pace[19].previous).toBe(23500n);
  expect(a.rows.map((r) => r.id)).toEqual([1, 3]);
  expect(a.waterfall.at(-1)?.end).toBe(a.current.value);
  expect(
    a.waterfall.reduce((sum, s) => sum + s.change, a.previous.value!),
  ).toBe(a.current.value);
  expect(
    a.calendar.reduce((sum, day) => sum + (day.total.value ?? 0n), 0n),
  ).toBe(a.current.value);
  expect(a.calendar[7].future).toBe(true);
});

test("completed months include full periods, and history crosses year boundaries", () => {
  const a = analyzeSpending({
    ...base,
    month: "2026-01",
    transactions: [
      expense({ date: "2025-12-31" }),
      expense({ id: 2, date: "2026-01-31" }),
    ],
  });
  expect(a.previousMonth).toBe("2025-12");
  expect(a.cutoff).toBe(31);
  expect(a.previousCutoff).toBe(31);
  expect(a.current.value).toBe(8000n);
  expect(a.categories[0].history.map((h) => h.month)).toEqual([
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
  ]);
});

test("leap years and unequal month lengths do not extend a line beyond its month", () => {
  const a = analyzeSpending({
    ...base,
    month: "2024-03",
    now: new Date(2024, 2, 31),
    transactions: [
      expense({ date: "2024-02-29" }),
      expense({ id: 2, date: "2024-03-31" }),
    ],
  });
  expect(a.previousCutoff).toBe(29);
  expect(a.previousDays).toBe(29);
  expect(a.pace[29].previous).toBeNull();
  expect(a.pace[30].current).toBe(8000n);
  const b = analyzeSpending({ ...base, month: "2025-02" });
  expect(b.calendar).toHaveLength(28);
  expect(b.pace).toHaveLength(31);
  expect(b.pace[28].current).toBeNull();
});

test("future month stays empty", () => {
  const a = analyzeSpending({ ...base, month: "2026-12" });
  expect(a.future).toBe(true);
  expect(a.rows).toEqual([]);
  expect(a.calendar.every((d) => d.future)).toBe(true);
});

test("integer cents remain exact beyond floating point precision", () => {
  const n = parseMinor("90071992547409.93", "USD");
  expect(n).toBe(9007199254740993n);
  expect(decimalAmount(n, "USD")).toBe("90071992547409.93");
  expect(decimalAmount(parseMinor("-0.01", "USD"), "USD")).toBe("-0.01");
  expect(
    totalSpending(
      [expense({ amount: "0.10" }), expense({ amount: "0.20" })],
      "USD",
    ).value,
  ).toBe(30n);
});

test("native originals and immutable equivalents win over display quotes", () => {
  const usd = expense();
  expect(transactionAmount(usd, "USD")).toBe(8000n);
  expect(transactionAmount(usd, "BITCOIN")).toBe(80000n);
  const btc = expense({
    currency: "BITCOIN",
    amount: "12345",
    purchase_cost: { ...usd.purchase_cost!, usd: "12.34", bitcoin: "99999" },
  });
  expect(transactionAmount(btc, "BITCOIN")).toBe(12345n);
  expect(transactionAmount(btc, "USD")).toBe(1234n);
  expect(totalSpending([usd, btc], "USD").value).toBe(9234n);
  expect(totalSpending([usd, btc], "BITCOIN").value).toBe(92345n);
});

test("missing references make affected totals unavailable without hiding transactions", () => {
  const a = analyzeSpending({
    ...base,
    transactions: [
      expense({ currency: "BITCOIN", amount: "10000", purchase_cost: null }),
    ],
  });
  expect(a.current).toEqual({ value: null, count: 1, missing: 1 });
  expect(a.rows).toHaveLength(1);
  expect(a.change).toBeNull();
  expect(a.waterfall).toEqual([]);
  expect(a.pace[3].current).toBe(0n);
  expect(a.pace[4].current).toBeNull();
  expect(a.calendar[4].total.value).toBeNull();
});

test("account and category filters apply to current, previous, calendar and history", () => {
  const a = analyzeSpending({ ...base, category: "1", account: "1" });
  expect(a.current.value).toBe(12000n);
  expect(a.previous.value).toBe(8000n);
  expect(a.categories.map((c) => c.name)).toEqual(["Groceries"]);
  expect(a.categories[0].history.at(-2)?.total.value).toBe(17000n);
  expect(
    a.rows.every((row) => row.account_id === 1 && row.category_id === 1),
  ).toBe(true);
});

test("six largest absolute changes plus Other changes reconcile exactly", () => {
  const a = analyzeSpending({
    ...base,
    transactions: expenseCategories.map((category, i) =>
      expense({ id: i, category_id: category.id, amount: `${i + 1}.00` }),
    ),
  });
  expect(a.waterfall).toHaveLength(7);
  expect(a.waterfall[0].change).toBe(900n);
  expect(a.waterfall.at(-1)?.keys).toHaveLength(3);
  expect(a.waterfall.at(-1)?.change).toBe(600n);
  expect(a.waterfall.at(-1)?.end).toBe(4500n);
});

test("empty and zero-baseline comparisons produce amounts without invented percentages", () => {
  const empty = analyzeSpending({ ...base, transactions: [] });
  expect(empty.current.value).toBe(0n);
  expect(empty.categories).toEqual([]);
  expect(empty.change).toBe(0n);
  const a = analyzeSpending({ ...base, transactions: [expense()] });
  expect(a.previous.value).toBe(0n);
  expect(a.change).toBe(8000n);
});

test("uncategorized and historical categories remain filterable", () => {
  const a = analyzeSpending({
    ...base,
    transactions: [
      expense({ category_id: null }),
      expense({ id: 2, category_id: 100, category: "Old category" }),
    ],
  });
  expect(a.categories.map((c) => c.name)).toContain("Uncategorized");
  expect(a.categories.map((c) => c.name)).toContain("Old category");
  expect(
    analyzeSpending({
      ...base,
      transactions: a.rows,
      category: "uncategorized",
    }).rows,
  ).toHaveLength(1);
});

test("replacement / reversal results follow the active collection supplied by the server", () => {
  const original = expense();
  const corrected = expense({ id: 100, amount: "42.00" });
  expect(
    analyzeSpending({ ...base, transactions: [original] }).current.value,
  ).toBe(8000n);
  expect(
    analyzeSpending({ ...base, transactions: [corrected] }).current.value,
  ).toBe(4200n);
  expect(analyzeSpending({ ...base, transactions: [] }).current.count).toBe(0);
});
