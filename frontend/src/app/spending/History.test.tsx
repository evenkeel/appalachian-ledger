import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData } from "../dashboard/types";
import { empty, reading } from "../test/fixture";

const calls: string[] = [];
const sum = (count: number, usd: string | null, bitcoin: string | null, missing = 0) => ({ count, usd, bitcoin, missing_usd: 0, missing_bitcoin: missing });
const reply = (periods: object[], rest: object = {}) => ({ totals: sum(0, "0.00", "0"), periods, categories: [], transactions: [], transactions_truncated: false, ...rest });
/** A ledger begun in November 2024: two months of that year, all of 2025, and 2026 through November 19. */
const long: DashboardData = { ...reading, first_entry_date: "2024-11-03" };
const months = reply([
  { period: "2024-11", ...sum(9, "900.00", "1000000") },
  { period: "2024-12", ...sum(9, "1100.50", "1200000") },
  { period: "2025-03", ...sum(12, "2400.00", "2500000") },
  { period: "2025-12", ...sum(12, "3600.00", "3000000") },
  { period: "2026-09", ...sum(12, "1841.41", "1650000") },
  { period: "2026-10", ...sum(14, "1849.31", null, 2) },
  { period: "2026-11", ...sum(9, "932.31", "790000") },
]);
const years = reply([
  { period: "2024", ...sum(18, "2000.50", "2200000") },
  { period: "2025", ...sum(24, "6000.00", "5500001") },
  { period: "2026", ...sum(35, "4623.03", null, 2) },
]);
const october = reply([], {
  totals: sum(3, "913.70", null, 1),
  categories: [
    { name: "Dining", ...sum(1, "68.25", null, 1) },
    { name: "Housing", ...sum(1, "720.00", "625467") },
    { name: "Shopping", ...sum(1, "125.45", "110000") },
  ],
  transactions: [
    { id: 1, date: "2026-10-21", description: "Mortgage interest", category: "Housing", account: "Checking", amount: "720.00", currency: "USD", usd: "720.00", bitcoin: "625467" },
    { id: 2, date: "2026-10-12", description: "Dinner on Main Street", category: "Dining", account: "Checking", amount: "68.25", currency: "USD", usd: "68.25", bitcoin: null },
  ],
});
const december = reply([], {
  totals: sum(1, "3600.00", "3000000"),
  categories: [{ name: "Housing", ...sum(1, "3600.00", "3000000") }],
  transactions: [{ id: 9, date: "2025-12-05", description: "New roof", category: "Housing", account: "Checking", amount: "3600.00", currency: "USD", usd: "3600.00", bitcoin: "3000000" }],
});
vi.mock("../../lib/api", () => ({
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path.includes("interval=year")) return years;
    if (path.includes("summary=true")) return months;
    return path.includes("start=2025-12-01") ? december : october;
  }),
}));

import { HistoryPanel, monthlyAverage } from "./History";

beforeEach(() => {
  calls.length = 0;
});

const columns = async (name: string) => within(await screen.findByRole("group", { name })).getAllByRole("button");
const names = (buttons: HTMLElement[]) => buttons.map((button) => button.getAttribute("aria-label"));

describe("spending history", () => {
  it("asks once for every month since the ledger began and opens on this year, each month named with its year", async () => {
    render(<HistoryPanel data={reading} lens="USD" />);
    await waitFor(() => expect(calls).toEqual(["/spending-history?start=2026-06-01&end=2026-11-19&interval=month&summary=true"]));
    expect(names(await columns("Spending by month, 2026"))).toEqual([
      "June 2026: $0.00",
      "July 2026: $0.00",
      "August 2026: $0.00",
      "September 2026: $1,841.41",
      "October 2026: $1,849.31",
      "November 2026: $932.31, so far",
    ]);
    // A ledger inside one year has no other year to page to.
    expect(screen.getByRole("button", { name: "Earlier year" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later year" })).toBeDisabled();
  });

  it("pages back a year at a time through the whole ledger without asking again", async () => {
    render(<HistoryPanel data={long} lens="USD" />);
    await columns("Spending by month, 2026");
    expect(screen.getByText(/2026 so far/)).toHaveTextContent("2026 so far · $4,623.03 · $420.28 a month on average");
    fireEvent.click(screen.getByRole("button", { name: "Earlier year" }));
    const last = names(await columns("Spending by month, 2025"));
    expect(last).toHaveLength(12);
    expect(last[2]).toBe("March 2025: $2,400.00");
    expect(last[11]).toBe("December 2025: $3,600.00");
    expect(screen.getByText(/^2025 ·/)).toHaveTextContent("2025 · $6,000.00 · $500.00 a month on average");
    fireEvent.click(screen.getByRole("button", { name: "Earlier year" }));
    // The first year holds only the months since the ledger began.
    expect(names(await columns("Spending by month, 2024"))).toEqual(["November 2024: $900.00", "December 2024: $1,100.50"]);
    expect(screen.getByText(/^2024 Nov–Dec/)).toHaveTextContent("$2,000.50 · $1,000.25 a month on average");
    expect(screen.getByRole("button", { name: "Earlier year" })).toBeDisabled();
    expect(calls).toHaveLength(1);
  });

  it("shows one bar a year, says which years are partial, and opens a year to its months", async () => {
    render(<HistoryPanel data={long} lens="USD" />);
    await columns("Spending by month, 2026");
    fireEvent.click(screen.getByRole("button", { name: "Years" }));
    await waitFor(() => expect(calls).toContain("/spending-history?start=2024-11-01&end=2026-11-19&interval=year&summary=true"));
    const bars = await columns("Spending by year");
    expect(names(bars)).toEqual([
      "2024, a partial year, November to December only: $2,000.50, $1,000.25 a month on average over 2 months. Show its months.",
      "2025: $6,000.00, $500.00 a month on average over 12 months. Show its months.",
      "2026, so far, through November: $4,623.03, $420.28 a month on average over 11 months. Show its months.",
    ]);
    expect(bars[0]).toHaveTextContent("Nov–Dec");
    expect(bars[2]).toHaveTextContent("so far");
    fireEvent.click(bars[1]);
    expect(await columns("Spending by month, 2025")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Months" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens a month from an earlier year to its categories and entries, dated with the year", async () => {
    render(<HistoryPanel data={long} lens="USD" />);
    await columns("Spending by month, 2026");
    fireEvent.click(screen.getByRole("button", { name: "Earlier year" }));
    fireEvent.click(await screen.findByRole("button", { name: "December 2025: $3,600.00" }));
    await waitFor(() => expect(calls).toContain("/spending-history?start=2025-12-01&end=2025-12-31&interval=month"));
    expect(await screen.findByRole("list", { name: "Categories in December 2025" })).toHaveTextContent("Housing$3,600.00");
    expect(screen.getByText("New roof").closest("tr")).toHaveTextContent("Dec 5, 2025");
  });

  it("opens a month to its categories, largest first, and its entries", async () => {
    render(<HistoryPanel data={reading} lens="USD" />);
    fireEvent.click(await screen.findByRole("button", { name: "October 2026: $1,849.31" }));
    await waitFor(() => expect(calls).toContain("/spending-history?start=2026-10-01&end=2026-10-31&interval=month"));
    const categories = within(await screen.findByRole("list", { name: "Categories in October 2026" })).getAllByRole("listitem");
    expect(categories.map((item) => item.textContent)).toEqual(["Housing$720.00", "Shopping$125.45", "Dining$68.25"]);
    expect(screen.getByText("Dinner on Main Street")).toBeInTheDocument();
    expect(screen.getByText("$913.70")).toBeInTheDocument();
  });

  it("in bitcoin, a month or a year with an unpriced expense reads Partial instead of a guessed total", async () => {
    render(<HistoryPanel data={long} lens="BITCOIN" />);
    const month = await screen.findByRole("button", { name: "October 2026: partial, 2 entries without a bitcoin price" });
    expect(screen.getByRole("button", { name: "September 2026: ₿1,650,000" })).toBeInTheDocument();
    // The year's own total cannot be known either.
    expect(screen.getByText(/2026 so far/)).toHaveTextContent("2026 so far · Partial");
    fireEvent.click(month);
    expect(await screen.findByText(/1 without a bitcoin price/)).toBeInTheDocument();
    const row = screen.getByText("Dinner on Main Street").closest("tr")!;
    expect(within(row).getByText("no price")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Categories in October 2026" })).getByText("Partial")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Years" }));
    const bars = await columns("Spending by year");
    expect(names(bars)[1]).toBe("2025: ₿5,500,001, ₿458,333 a month on average over 12 months. Show its months.");
    expect(names(bars)[2]).toBe("2026, so far, through November: partial, 2 entries without a bitcoin price. Show its months.");
  });

  it("averages to the cent and the whole bitcoin, half to even", () => {
    expect(monthlyAverage("2000.50", 2, "USD")).toBe("1000.25");
    expect(monthlyAverage("0.05", 2, "USD")).toBe("0.02");
    expect(monthlyAverage("0.07", 2, "USD")).toBe("0.04");
    expect(monthlyAverage("100.00", 3, "USD")).toBe("33.33");
    expect(monthlyAverage("5500001", 12, "BITCOIN")).toBe("458333");
    expect(monthlyAverage("5", 2, "BITCOIN")).toBe("2");
    expect(monthlyAverage("7", 2, "BITCOIN")).toBe("4");
  });

  it("draws nothing on an empty ledger", () => {
    render(<HistoryPanel data={empty} lens="USD" />);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByText(/Record an expense/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
