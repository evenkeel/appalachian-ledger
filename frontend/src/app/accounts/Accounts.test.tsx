import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reading } from "../test/fixture";
import { SessionProvider } from "../lib/session";

const calls: { path: string; method: string; body?: unknown }[] = [];
const account = (id: number, name: string, kind: string, balance: string, usd: string | null, bitcoin: string | null, more: object = {}) => ({
  id,
  name,
  kind,
  role: ["credit_card", "mortgage", "loan"].includes(kind) ? "liability" : "asset",
  currency: kind === "bitcoin_wallet" ? "BITCOIN" : "USD",
  holding_type: kind === "bitcoin_wallet" ? "bitcoin" : ["credit_card", "mortgage", "loan"].includes(kind) ? "debt" : kind === "real_estate" ? "valued_asset" : "dollars",
  archived: false,
  exclude_from_liquid_usd: false,
  balance,
  balance_minor: kind === "bitcoin_wallet" ? balance : balance.replace(".", ""),
  usd,
  bitcoin,
  ...more,
});
let accounts = [
  account(1, "Cold storage", "bitcoin_wallet", "23937800", "28426.14", "23937800"),
  account(3, "Everyday checking", "checking", "4812.40", "4812.40", "4052552"),
  account(4, "Rainy day", "savings", "1500.00", "1500.00", "1263158"),
  account(10, "Ridgeline Visa", "credit_card", "1284.36", "1284.36", "1081566"),
  account(12, "Old checking", "checking", "0.00", "0.00", "0", { archived: true }),
];
vi.mock("../../lib/api", () => ({
  setCsrf: vi.fn(),
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path === "/auth/status") return { initialized: true, demo_enabled: false };
    if (path === "/auth/me") return { username: "owner", csrf: "t", preferences: { theme: "dark", denomination: "USD" } };
    if (path === "/accounts" && method === "GET") return accounts;
    if (path === "/dashboard") return reading;
    if (path === "/accounts" && method === "POST") return { id: 40 };
    return { ok: true };
  }),
}));

import { Accounts } from "./Accounts";

const go = vi.fn();
const original = accounts;
const show = async () => {
  render(
    <SessionProvider>
      <Accounts go={go} />
    </SessionProvider>,
  );
  await screen.findByLabelText(/^What you have/);
};
const writes = () => calls.filter((call) => call.method !== "GET");
const dialog = () => within(screen.getByRole("dialog"));
const set = (label: string | RegExp, value: string) => fireEvent.change(dialog().getByLabelText(label), { target: { value } });

beforeEach(() => {
  calls.length = 0;
  accounts = original;
});

describe("accounts", () => {
  it("adds up what you hold and owe exactly, and leaves closed accounts out", async () => {
    await show();
    const totals = screen.getByLabelText(/^What you have/);
    // 28,426.14 + 4,812.40 + 1,500.00 − 1,284.36
    expect(totals).toHaveTextContent("Net worth$33,454.18");
    expect(totals).toHaveTextContent("Bitcoin₿23,937,800$28,426.14");
    expect(totals).toHaveTextContent("Dollars$6,312.40");
    expect(totals).toHaveTextContent("Debt$1,284.36");
    expect(screen.getByLabelText(/^Dollars: 2 accounts/)).toBeInTheDocument();
    expect(screen.getByText("Checking · ammo")).toBeInTheDocument();
    expect(screen.queryByText("Old checking")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 closed account" }));
    expect(screen.getByText("Old checking")).toBeInTheDocument();
  });

  it("shows a missing price as missing instead of a guessed total", async () => {
    accounts = original.map((row) => (row.id === 1 ? { ...row, usd: null } : row));
    await show();
    const totals = screen.getByLabelText(/^What you have/);
    expect(totals).toHaveTextContent("Net worthNeeds a price");
    expect(totals).toHaveTextContent("Bitcoin₿23,937,800no price");
    expect(within(totals).queryByRole("img")).not.toBeInTheDocument();
  });

  it("corrects a balance by posting the exact difference, never by editing", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Change Everyday checking" }));
    set("Balance now", "$4,790.15");
    fireEvent.click(dialog().getByRole("button", { name: "Save" }));
    expect(await dialog().findByRole("alert")).toHaveTextContent("Say why the balance changed");
    expect(writes()).toHaveLength(0);
    set("Why it changed", "Bank fee I missed");
    fireEvent.click(dialog().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0]).toEqual({ path: "/accounts/3", method: "PATCH", body: { name: "Everyday checking", archived: false, exclude_from_liquid_usd: false } });
    expect(writes()[1]).toEqual({ path: "/accounts/3/adjustments", method: "POST", body: { date: "2026-11-19", amount: "-22.25", description: "Bank fee I missed" } });
  });

  it("saves a card's limit and due day without touching its balance", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Change Ridgeline Visa" }));
    set("Credit limit", "$6,000");
    set("Payment due day", "28");
    fireEvent.click(dialog().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({ path: "/accounts/10/card-terms", method: "PUT", body: { credit_limit: "6000", due_day: 28 } });
  });

  it("adds a bitcoin wallet in whole bitcoin units", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Add an account" }));
    set("Kind", "bitcoin_wallet");
    set("Name", "Phone wallet");
    set("Bitcoin held (₿)", "₿125,000");
    fireEvent.click(dialog().getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/accounts",
      method: "POST",
      body: { name: "Phone wallet", kind: "bitcoin_wallet", currency: "BITCOIN", opening_balance: "125000", date: "2026-11-19" },
    });
  });

  it("closes an account only after a second press", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Change Rainy day" }));
    fireEvent.click(dialog().getByRole("button", { name: "Close account" }));
    // A double-click lands on the same button; it must not count as the confirmation.
    fireEvent.click(dialog().getByRole("button", { name: "Yes, close it" }));
    expect(writes()).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 450));
    fireEvent.click(dialog().getByRole("button", { name: "Yes, close it" }));
    await waitFor(() => expect(writes()).toEqual([{ path: "/accounts/4", method: "PATCH", body: { name: "Rainy day", archived: true } }]));
  });
});
