import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, empty, reading } from "../test/fixture";
import type { DashboardData } from "../dashboard/types";

const calls: { path: string; method: string; body?: unknown }[] = [];
let dashboard: DashboardData = reading;
const paychecks = [{ id: 1, account_id: 3, account: "Everyday checking", name: "Salary", amount: "3100.00", frequency: "semimonthly", next_date: "2026-11-16", next_occurrence: "2026-12-01" }];
const destroyed = [
  { id: 20, name: "Gym", amount: "24.99", currency: "USD", frequency: "monthly", monthly_amount: "24.99", destroyed_on: "2026-11-02", account: "Everyday checking", category: "Health", paid_off: false },
  { id: 21, name: "Store card payment", amount: "83.88", currency: "USD", frequency: "yearly", monthly_amount: "6.99", destroyed_on: "2026-10-12", account: "Everyday checking", category: "Other expense", paid_off: true },
];
const accounts = [
  { id: 1, name: "Cold storage", kind: "bitcoin_wallet", role: "asset", currency: "BITCOIN", archived: false },
  { id: 3, name: "Everyday checking", kind: "checking", role: "asset", currency: "USD", archived: false },
  { id: 10, name: "Ridgeline Visa", kind: "credit_card", role: "liability", currency: "USD", archived: false },
  { id: 11, name: "Mortgage", kind: "mortgage", role: "liability", currency: "USD", archived: false },
];
vi.mock("../../lib/api", () => ({
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path === "/dashboard") return dashboard;
    if (path === "/income-schedules" && method === "GET") return paychecks;
    if (path === "/recurring-bills/destroyed") return destroyed;
    if (path === "/accounts") return accounts;
    if (path === "/categories") return categories;
    if (path === "/recurring-bills" && method === "GET")
      return [{ id: 9, account_id: 3, category_id: 3, description: "Streaming", notes: "shared plan", amount: "22.99", frequency: "monthly", next_due: "2026-12-12" }];
    if (path === "/recurring-bills" && method === "POST") return { id: 31 };
    return { id: 9, ok: true };
  }),
}));

import { Bills } from "./Bills";

const go = vi.fn();
const show = async () => {
  render(<Bills go={go} />);
  await screen.findByRole("heading", { name: "Bills" });
  await screen.findByLabelText(/^All bills/);
};
const writes = () => calls.filter((call) => call.method !== "GET");
const set = (label: string | RegExp, value: string) => fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(label), { target: { value } });

beforeEach(() => {
  calls.length = 0;
  dashboard = reading;
  go.mockClear();
});

describe("bills", () => {
  it("lists every bill soonest first, with what each one needs", async () => {
    await show();
    const list = within(screen.getByLabelText(/^All bills/));
    expect(list.getAllByRole("listitem").map((item) => within(item).getByText(/Mortgage|Visa|Streaming/).textContent)).toEqual(["Mortgage", "Ridgeline Visa payment", "Streaming"]);
    expect(list.getByText("in 2 days")).toBeInTheDocument();
    expect(list.getByText("Shopping · every month · from Everyday checking")).toBeInTheDocument();
    // A bill linked to a debt can be paid off; a plain one can be destroyed.
    expect(list.getByRole("button", { name: "Pay off Mortgage in full and destroy it" })).toBeInTheDocument();
    expect(list.getByRole("button", { name: "Destroy Streaming for good" })).toBeInTheDocument();
    const glance = screen.getByLabelText(/^At a glance/);
    expect(glance).toHaveTextContent("Ammo · in checking$4,812.40");
    expect(glance).toHaveTextContent("All bills, a month$2,707.35");
  });

  it("adds up what destroyed bills freed, exactly, and prices it in bitcoin at today's quote", async () => {
    await show();
    const panel = screen.getByLabelText(/^Destroyed/);
    expect(panel).toHaveTextContent("$31.98 a month freed, $383.76 a year.");
    // 3,198 cents at ₿842 per $1, rounded down.
    expect(panel).toHaveTextContent("about ₿26,927 a month at today's price");
    expect(within(panel).getByText(/^Paid off Oct 12/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Bring back Gym" }));
    await waitFor(() => expect(writes()).toEqual([{ path: "/recurring-bills/20/restore", method: "POST", body: undefined }]));
    expect(await screen.findByRole("status")).toHaveTextContent("Brought back Gym.");
  });

  it("asks before destroying a bill and then destroys only that one", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Destroy Streaming for good" }));
    const sheet = within(screen.getByRole("dialog"));
    expect(writes()).toHaveLength(0);
    expect(sheet.getByText(/frees/)).toHaveTextContent("$22.99 a month, $275.88 a year");
    fireEvent.click(sheet.getByRole("button", { name: "Destroy" }));
    await waitFor(() => expect(writes()).toEqual([{ path: "/recurring-bills/9/destroy", method: "POST", body: undefined }]));
  });

  it("adds a bill without recording a payment, and links it to a debt when asked", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Add a bill" }));
    await screen.findByLabelText("Name");
    set("Name", "Car loan");
    set("Amount", "$1,310.50");
    set("Next due", "2026-12-05");
    set("Pays down a debt", "11");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add bill" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0]).toEqual({
      path: "/recurring-bills",
      method: "POST",
      body: {
        transaction: { kind: "expense", date: "2026-12-05", account_id: 3, category_id: 2, amount: "1310.50", description: "Car loan", notes: "" },
        frequency: "monthly",
        record_now: false,
      },
    });
    expect(writes()[1]).toEqual({ path: "/recurring-bills/31/pays-account", method: "PUT", body: { account_id: 11 } });
  });

  it("changes a bill and keeps its notes and category", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Change Streaming" }));
    await screen.findByLabelText("Name");
    expect(within(screen.getByRole("dialog")).getByLabelText("Category")).toHaveValue("3");
    set("Amount", "24.99");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: "/recurring-bills/9",
      method: "PUT",
      body: { transaction: { amount: "24.99", description: "Streaming", notes: "shared plan", category_id: 3, date: "2026-12-12" }, frequency: "monthly" },
    });
  });

  it("removes a planned paycheck only after a second press", async () => {
    await show();
    const panel = within(screen.getByLabelText(/^Paychecks/));
    expect(panel.getByText("twice a month · into Everyday checking")).toBeInTheDocument();
    expect(panel.getByText("next Dec 1")).toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Remove Salary" }));
    expect(writes()).toHaveLength(0);
    fireEvent.click(panel.getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(writes()).toEqual([{ path: "/income-schedules/1", method: "DELETE", body: undefined }]));
  });

  it("on an empty ledger, asks for an account first and draws nothing", async () => {
    dashboard = empty;
    render(<Bills go={go} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add an account" }));
    expect(go).toHaveBeenCalledWith("accounts");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
