import { describe, expect, it } from "vitest";
import { addNullable, composeSpending, monthsBetween } from "./compose";
import type { MonthAnswer, Row } from "./compose";

const row = (id: number, date: string, category: string, usd: string | null, bitcoin: string | null): Row => ({
  id,
  date,
  category,
  account: "Everyday checking",
  usd,
  bitcoin,
  hypothetical_value_usd: usd,
});

describe("adding saved months together", () => {
  it("adds decimal strings exactly and keeps a missing price missing", () => {
    expect(addNullable(["0.10", "0.20"])).toBe("0.30");
    expect(addNullable(["1999.99", "0.01", "12"])).toBe("2012.00");
    expect(addNullable(["125000", "7"])).toBe("125007");
    expect(addNullable([])).toBe("0");
    expect(addNullable(["5.00", null])).toBeNull();
  });

  it("lists months newest first", () => {
    expect(monthsBetween("2025-11-15", "2026-02-03")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });

  it("groups by month or year, by category, and never guesses a missing price", () => {
    const answers: MonthAnswer[] = [
      { transactions: [row(3, "2026-01-09", "Dining", "20.00", null)], current_reference: { price_usd: "60000" } },
      { transactions: [row(2, "2025-12-20", "Dining", "10.50", "17500"), row(1, "2025-12-02", "Rent", "900.00", "1500000")], current_reference: null },
    ];
    const byMonth = composeSpending({ start: "2025-12-01", end: "2026-01-31", interval: "month" }, answers);
    expect(byMonth.periods.map((period) => [period.period, period.usd, period.bitcoin, period.missing_bitcoin])).toEqual([
      ["2025-12", "910.50", "1517500", 0],
      ["2026-01", "20.00", null, 1],
    ]);
    expect(byMonth.totals).toMatchObject({ count: 3, usd: "930.50", bitcoin: null, missing_bitcoin: 1 });
    expect(byMonth.categories.map((category) => [category.name, category.usd])).toEqual([
      ["Dining", "30.50"],
      ["Rent", "900.00"],
    ]);
    const byYear = composeSpending({ start: "2025-12-05", end: "2026-01-31", interval: "year", category: "Dining" }, answers);
    expect(byYear.periods.map((period) => [period.period, period.count])).toEqual([
      ["2025", 1],
      ["2026", 1],
    ]);
    expect(byYear.transactions.map((item) => item.id)).toEqual([3, 2]);
  });
});

// Present only after `scripts/web_demo.py` has run. Then the demo's sums must equal the server's own.
const years = import.meta.glob<Record<string, MonthAnswer>>("../../demo-public/demo-data/spending/*.json", { eager: true, import: "default" });
const saved: Record<string, MonthAnswer> = Object.assign({}, ...Object.values(years));
const checks = Object.values(
  import.meta.glob<{ path: string; category: string | null; answer: unknown }[]>("../../demo-checks.json", { eager: true, import: "default" }),
)[0];

describe.skipIf(!checks)("the saved demo against the server it was saved from", () => {
  it.each(checks ?? [])("gives the server's own answer for $path", ({ path, category, answer }) => {
    const query = new URLSearchParams(path.split("?")[1]);
    const [start, end] = [query.get("start")!, query.get("end")!];
    const answers = monthsBetween(start, end).map((month) => saved[month]);
    expect(answers.every(Boolean)).toBe(true);
    const composed = composeSpending(
      { start, end, interval: query.get("interval") as "month" | "year", category, summary: query.get("summary") === "true" },
      answers,
    );
    expect(composed).toEqual(answer);
  });
});
