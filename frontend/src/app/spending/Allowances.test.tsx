import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories } from "../test/fixture";

const calls: { path: string; method: string; body?: unknown }[] = [];
let rows = [
  { category_id: 2, category: "Groceries", budget_id: 5, planned_usd: "600.00", spent_usd: "412.18", percent: "68.7" },
  { category_id: 3, category: "Dining", budget_id: 6, planned_usd: "100.00", spent_usd: "131.40", percent: "131.4" },
  { category_id: 4, category: "Transport", budget_id: null, planned_usd: null, spent_usd: "88.00", percent: null },
];
let copied = 2;
vi.mock("../../lib/api", () => ({
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path.startsWith("/budget-overview")) return rows;
    if (path === "/budgets/copy-previous") return { copied, from: "2026-10" };
    return { id: 9, ok: true };
  }),
}));

import { AllowancesPanel } from "./Allowances";

const original = rows;
const changed = vi.fn();
const show = async () => {
  render(<AllowancesPanel month="2026-11" elapsed="63.3" categories={categories} onChanged={changed} />);
  await waitFor(() => expect(calls.some((call) => call.path === "/budget-overview?month=2026-11")).toBe(true));
};
const writes = () => calls.filter((call) => call.method !== "GET");

beforeEach(() => {
  calls.length = 0;
  rows = original;
  copied = 2;
  changed.mockClear();
});

describe("allowances", () => {
  it("shows what is used and what is over, exactly", async () => {
    await show();
    const panel = await screen.findByLabelText("Allowances: dollar limits by category · November");
    expect(panel).toHaveTextContent("$700.00 allowed across 2 categories");
    expect(panel).toHaveTextContent("$412.18 of $600.00");
    expect(panel).toHaveTextContent("$131.40 of $100.00 · $31.40 over");
    expect(within(panel).getByRole("img", { name: "69% of the Groceries allowance used; 63% of the month has passed" })).toBeInTheDocument();
    // A category with spending but no allowance is offered, not shown as a bar.
    expect(within(panel).queryByText("Transport")).not.toBeInTheDocument();
  });

  it("changes an allowance with the exact amount typed", async () => {
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Change the Groceries allowance" }));
    const form = within(screen.getByRole("form", { name: "Allowance for Groceries" }));
    fireEvent.change(form.getByLabelText("A month"), { target: { value: "$650.50" } });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: "/budgets", method: "POST", body: { month: "2026-11", category_id: 2, amount: "650.50", currency: "USD", scope: "all" } });
    expect(await screen.findByRole("status")).toHaveTextContent("Allowance for Groceries saved.");
    expect(changed).toHaveBeenCalled();
  });

  it("refuses an amount that is not dollars and sends nothing", async () => {
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Set an allowance" }));
    const form = within(screen.getByRole("form", { name: "New allowance" }));
    expect(form.getByRole("option", { name: "Transport · spent this month" })).toBeInTheDocument();
    fireEvent.change(form.getByLabelText("A month"), { target: { value: "lots" } });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the allowance as dollars");
    expect(writes()).toHaveLength(0);
  });

  it("removes an allowance", async () => {
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Remove the Dining allowance" }));
    await waitFor(() => expect(writes()).toEqual([{ path: "/budgets/6", method: "DELETE", body: undefined }]));
  });

  it("offers to copy last month's allowances when none are set, and says so when there were none", async () => {
    rows = [original[2]];
    copied = 0;
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Copy last month's" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Last month had no allowances to copy.");
    expect(writes()).toEqual([{ path: "/budgets/copy-previous", method: "POST", body: { month: "2026-11" } }]);
  });
});
