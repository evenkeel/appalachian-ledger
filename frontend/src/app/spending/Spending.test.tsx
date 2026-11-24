import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData } from "../dashboard/types";
import { categories, periods, reading, report, transactions } from "../test/fixture";

const calls: string[] = [];
/** A ledger begun in September 2025, so the flow can go back across a year end. */
const current: DashboardData = { ...reading, first_entry_date: "2025-09-10" };
const sum = (count: number, usd: string | null, bitcoin: string | null) => ({ count, usd, bitcoin, missing_usd: 0, missing_bitcoin: 0 });
vi.mock("../../lib/api", () => ({
  setCsrf: () => {},
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path === "/dashboard") return current;
    if (path.startsWith("/transactions")) return transactions;
    if (path === "/categories") return categories;
    if (path.startsWith("/reports")) return { ...report, month: path.slice(15, 22) };
    if (path.includes("category_id=2"))
      return {
        totals: sum(1, "88.10", "91000"),
        periods: [],
        categories: [],
        transactions: [{ id: 5, date: "2025-12-14", description: "Winter market", category: "Groceries", account: "Checking", amount: "88.10", currency: "USD", usd: "88.10", bitcoin: "91000" }],
        transactions_truncated: false,
      };
    if (path.startsWith("/spending-history")) return { totals: sum(0, "0.00", "0"), periods, categories: [], transactions: [], transactions_truncated: false };
    if (path.startsWith("/budgets")) return { items: [], categories: [] };
    return { ok: true };
  }),
}));
vi.mock("../lib/session", () => ({ useSession: () => ({ lens: "USD", demoEnabled: false }) }));
vi.mock("./Allowances", () => ({ AllowancesPanel: () => null }));

import { Spending } from "./Spending";

beforeEach(() => {
  calls.length = 0;
});

describe("money flow on the Spending screen", () => {
  it("opens on the current month and steps back to any month on record", async () => {
    const onDrill = vi.fn();
    render(<Spending go={() => {}} drill={null} onDrill={onDrill} />);
    const now = await screen.findByLabelText("Money flow: November 2026's income and where it went · month so far");
    await waitFor(() => expect(now).toHaveTextContent("Bitcoin stacked"));
    expect(within(now).getByRole("button", { name: "Later month" })).toBeDisabled();

    fireEvent.click(within(now).getByRole("button", { name: "Earlier month" }));
    const october = await screen.findByLabelText("Money flow: October 2026's income and where it went");
    await waitFor(() => expect(calls).toContain("/reports?month=2026-10&months=1&denomination=USD"));
    await waitFor(() => expect(within(october).getByRole("img").getAttribute("aria-label")).toMatch(/^Where October 2026's income went/));

    // Any month since the first entry can be jumped to, across the year end.
    const jump = within(october).getByRole("combobox", { name: "Money flow month: jump to a month" });
    expect(within(jump).getAllByRole("option")).toHaveLength(15);
    fireEvent.change(jump, { target: { value: "2025-12" } });
    const december = await screen.findByLabelText("Money flow: December 2025's income and where it went");
    await waitFor(() => expect(calls).toContain("/reports?month=2025-12&months=1&denomination=USD"));

    // A category of an earlier month lists that month's entries, not this month's.
    fireEvent.click(await within(december).findByRole("button", { name: /^Groceries/ }));
    expect(onDrill).not.toHaveBeenCalled();
    await waitFor(() => expect(calls).toContain("/spending-history?start=2025-12-01&end=2025-12-31&interval=month&category_id=2"));
    const entries = await screen.findByLabelText("Groceries: 1 entry in December 2025 · $88.10");
    expect(within(entries).getByText("Winter market").closest("tr")).toHaveTextContent("Dec 14, 2025");

    // Going back to a month already read does not ask for it again; this month still drills the usual way.
    fireEvent.change(jump, { target: { value: "2026-10" } });
    await screen.findByLabelText("Money flow: October 2026's income and where it went");
    expect(screen.queryByLabelText(/^Groceries: 1 entry in December 2025/)).toBeNull();
    expect(calls.filter((path) => path === "/reports?month=2026-10&months=1&denomination=USD")).toHaveLength(1);
    fireEvent.change(jump, { target: { value: "2026-11" } });
    const again = await screen.findByLabelText("Money flow: November 2026's income and where it went · month so far");
    fireEvent.click(await within(again).findByRole("button", { name: /^Groceries/ }));
    expect(onDrill).toHaveBeenCalledWith("2");
  });
});
