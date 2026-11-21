import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { empty, reading } from "../test/fixture";

const calls: string[] = [];
const sum = (count: number, usd: string | null, bitcoin: string | null, missing = 0) => ({ count, usd, bitcoin, missing_usd: 0, missing_bitcoin: missing });
const range = {
  totals: sum(40, "5400.00", null, 2),
  periods: [
    { period: "2026-09", ...sum(12, "1841.41", "1650000") },
    { period: "2026-10", ...sum(14, "1849.31", null, 2) },
    { period: "2026-11", ...sum(9, "932.31", "790000") },
  ],
  categories: [],
  transactions: [],
  transactions_truncated: false,
};
const october = {
  totals: sum(3, "913.70", null, 1),
  periods: [],
  categories: [
    { name: "Dining", ...sum(1, "68.25", null, 1) },
    { name: "Housing", ...sum(1, "720.00", "625467") },
    { name: "Shopping", ...sum(1, "125.45", "110000") },
  ],
  transactions: [
    { id: 1, date: "2026-10-21", description: "Mortgage interest", category: "Housing", account: "Checking", amount: "720.00", currency: "USD", usd: "720.00", bitcoin: "625467" },
    { id: 2, date: "2026-10-12", description: "Dinner on Main Street", category: "Dining", account: "Checking", amount: "68.25", currency: "USD", usd: "68.25", bitcoin: null },
  ],
  transactions_truncated: false,
};
vi.mock("../../lib/api", () => ({
  api: vi.fn(async (path: string) => {
    calls.push(path);
    return path.includes("start=2026-10-01") ? october : range;
  }),
}));

import { HistoryPanel } from "./History";

beforeEach(() => {
  calls.length = 0;
});

describe("spending by month", () => {
  it("asks for the months since the ledger began and gives every month a column", async () => {
    render(<HistoryPanel data={reading} lens="USD" />);
    await waitFor(() => expect(calls).toEqual(["/spending-history?start=2026-06-01&end=2026-11-19&interval=month"]));
    const months = within(screen.getByRole("group", { name: "Spending by month" })).getAllByRole("button");
    expect(months.map((month) => month.getAttribute("aria-label"))).toEqual([
      "June 2026: $0.00",
      "July 2026: $0.00",
      "August 2026: $0.00",
      "September 2026: $1,841.41",
      "October 2026: $1,849.31",
      "November 2026: $932.31, so far",
    ]);
  });

  it("opens a month to its categories, largest first, and its entries", async () => {
    render(<HistoryPanel data={reading} lens="USD" />);
    fireEvent.click(await screen.findByRole("button", { name: "October 2026: $1,849.31" }));
    await waitFor(() => expect(calls).toContain("/spending-history?start=2026-10-01&end=2026-10-31&interval=month"));
    const categories = within(await screen.findByRole("list", { name: "Categories in October" })).getAllByRole("listitem");
    expect(categories.map((item) => item.textContent)).toEqual(["Housing$720.00", "Shopping$125.45", "Dining$68.25"]);
    expect(screen.getByText("Dinner on Main Street")).toBeInTheDocument();
    expect(screen.getByText("$913.70")).toBeInTheDocument();
  });

  it("in bitcoin, a month with an unpriced expense reads Partial instead of a guessed total", async () => {
    render(<HistoryPanel data={reading} lens="BITCOIN" />);
    const month = await screen.findByRole("button", { name: "October 2026: partial, 2 entries without a bitcoin price" });
    expect(screen.getByRole("button", { name: "September 2026: ₿1,650,000" })).toBeInTheDocument();
    fireEvent.click(month);
    expect(await screen.findByText(/1 without a bitcoin price/)).toBeInTheDocument();
    const row = screen.getByText("Dinner on Main Street").closest("tr")!;
    expect(within(row).getByText("no price")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Categories in October" })).getByText("Partial")).toBeInTheDocument();
  });

  it("draws nothing on an empty ledger", () => {
    render(<HistoryPanel data={empty} lens="USD" />);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByText(/Record an expense/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
