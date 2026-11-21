import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, reading } from "../test/fixture";
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
const holding = (symbol: string, more: object = {}) => ({
  symbol,
  shares: "10",
  cost_basis: "2000.00",
  value: "2450.00",
  gain: "450.00",
  gain_percent: "22.50",
  price: "245.00",
  day_change: "12.00",
  observed_at: "2026-11-19T21:00:00+00:00",
  fetched_at: "2026-11-19T21:00:05+00:00",
  stale: false,
  ...more,
});
const portfolio = {
  holdings: [holding("MSTR", { shares: "5", cost_basis: null, value: "2000.00", gain: null, gain_percent: null, price: null, day_change: null, observed_at: null, fetched_at: null, stale: true }), holding("VTI")],
  cash: "310.25",
  started_on: "2026-06-03",
  error: null,
  source: "Yahoo Finance",
};
const brokerage = account(20, "Long-term brokerage", "brokerage", "4760.25", "4760.25", "4008130", { holding_type: "valued_asset", portfolio });
const home = account(21, "Blue Ridge home", "real_estate", "329400.00", "329400.00", "277354800");
let assets = [{ id: 7, account_id: 21, history: [{ date: "2026-06-01", value: "325000.00" }, { date: "2026-11-03", value: "329400.00" }] }];
const entries = Array.from({ length: 23 }, (_, index) => ({
  id: 100 - index,
  date: `2026-11-${String(19 - Math.floor(index / 2)).padStart(2, "0")}`,
  kind: index === 0 ? "income" : index === 2 ? "transfer" : "expense",
  description: index === 0 ? "Salary" : index === 1 ? "Mountain Market" : index === 2 ? "Bitcoin buy" : `Entry ${index}`,
  notes: "",
  counterparty: index === 2 ? "Cold storage" : null,
  direction: index === 2 ? "out" : null,
  category: index === 1 ? "Groceries" : null,
  change: index === 0 ? "3100.00" : "-41.25",
  change_minor: index === 0 ? "310000" : "-4125",
  balance: index === 0 ? "4812.40" : "1712.40",
  reverses_id: null,
  reversed: index === 3,
}));
// What the quote refresh does: fails, reports nothing new, or brings a new MSTR quote.
let refresh: "fails" | "unchanged" | "new" = "new";
vi.mock("../../lib/api", () => ({
  setCsrf: vi.fn(),
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path === "/auth/status") return { initialized: true, demo_enabled: false };
    if (path === "/auth/me") return { username: "owner", csrf: "t", preferences: { theme: "dark", denomination: "USD" } };
    if (path === "/accounts" && method === "GET") return accounts;
    if (path === "/dashboard") return reading;
    if (path === "/accounts" && method === "POST") return { id: 40 };
    if (/^\/accounts\/\d+\/activity$/.test(path)) return { account_id: Number(path.split("/")[2]), currency: "USD", role: "asset", balance: "4812.40", rows: entries };
    if (path === "/assets") return assets;
    if (path === "/categories") return categories;
    if (path === "/investments/refresh") {
      if (refresh === "fails") throw new Error("Quote unavailable for MSTR. Check the ticker or try again later.");
      if (refresh === "unchanged") return { changed: false };
      accounts = accounts.map((row) =>
        row.id === 20
          ? ({ ...row, portfolio: { ...portfolio, holdings: [holding("MSTR", { shares: "5", cost_basis: null, value: "2100.00", gain: null, gain_percent: null, price: "420.00" }), holding("VTI")] } } as typeof row)
          : row,
      );
      return { changed: true };
    }
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

const firstAssets = assets;
beforeEach(() => {
  calls.length = 0;
  accounts = original;
  assets = firstAssets;
  refresh = "new";
  go.mockClear();
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
    expect(screen.getByText("Checking · pays the bills")).toBeInTheDocument();
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
  it("opens an account's detail with its entries, newest first, and shows more on request", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Show the detail for Everyday checking" }));
    const list = within(await screen.findByLabelText("Entries"));
    await list.findByText("Salary");
    expect(calls.some((call) => call.path === "/accounts/3/activity" && call.method === "GET")).toBe(true);
    const rows = list.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(20);
    expect(rows[0]).toHaveTextContent("2026-11-19Salary+$3,100.00$4,812.40");
    expect(rows[1]).toHaveTextContent("Mountain MarketGroceries−$41.25$1,712.40");
    expect(rows[2]).toHaveTextContent("Bitcoin buyto Cold storage");
    // A reversed entry stays on the record, marked.
    expect(rows[3]).toHaveTextContent("Entry 3 reversed");
    expect(list.getByText("Showing 20 of 23 entries, newest first")).toBeInTheDocument();
    fireEvent.click(list.getByRole("button", { name: "Show more" }));
    expect(list.getAllByRole("row").slice(1)).toHaveLength(23);
    expect(list.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    // Entries are read-only here.
    fireEvent.click(list.getByRole("button", { name: /Transactions/ }));
    expect(go).toHaveBeenCalledWith("activity");
    expect(writes()).toHaveLength(0);
  });

  it("shows a missing quote as missing and never as a price", async () => {
    accounts = [...original, brokerage];
    await show();
    expect(screen.getByText("Brokerage · 2 holdings · quote stale")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the detail for Long-term brokerage" }));
    const holdings = within(await screen.findByLabelText("Holdings"));
    const [mstr, vti] = holdings.getAllByRole("row").slice(1);
    expect(mstr).toHaveTextContent("MSTR5missing$2,000.00No quote saved");
    expect(vti).toHaveTextContent("VTI10$245.00$2,450.00+$450.00 against cost · 22.50%");
    expect(within(vti).queryByText("stale")).not.toBeInTheDocument();
    expect(holdings.getByText(/Uninvested cash/)).toHaveTextContent("Uninvested cash $310.25 · quotes from Yahoo Finance");
  });

  it("saves holdings in the exact shape the server expects", async () => {
    accounts = [...original, brokerage];
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Show the detail for Long-term brokerage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit holdings and cash" }));
    set("Shares 2", "12.5");
    fireEvent.click(dialog().getByRole("button", { name: "Add a holding" }));
    set("Ticker 3", " aapl ");
    set("Shares 3", "3");
    set("Total cost 3", "$450");
    // A ticker listed twice is refused before anything is sent.
    set("Ticker 1", "vti");
    fireEvent.click(dialog().getByRole("button", { name: "Save and fetch quotes" }));
    expect(await dialog().findByRole("alert")).toHaveTextContent("VTI is listed twice");
    expect(writes()).toHaveLength(0);
    set("Ticker 1", "MSTR");
    set("Uninvested cash", "$1,310.25");
    fireEvent.click(dialog().getByRole("button", { name: "Save and fetch quotes" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/accounts/20/holdings",
      method: "PUT",
      body: {
        cash: "1310.25",
        holdings: [
          { symbol: "MSTR", shares: "5", cost_basis: null },
          { symbol: "VTI", shares: "12.5", cost_basis: "2000.00" },
          { symbol: "AAPL", shares: "3", cost_basis: "450.00" },
        ],
      },
    });
  });

  it("refreshes quotes only when asked, and shows the new quote", async () => {
    accounts = [...original, brokerage];
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Show the detail for Long-term brokerage" }));
    const holdings = within(await screen.findByLabelText("Holdings"));
    expect(calls.some((call) => call.path === "/investments/refresh")).toBe(false);
    fireEvent.click(holdings.getByRole("button", { name: "Refresh quotes" }));
    await waitFor(() => expect(holdings.getAllByRole("row")[1]).toHaveTextContent("MSTR5$420.00$2,100.00"));
    expect(holdings.getByText("Quotes refreshed.")).toBeInTheDocument();
    expect(writes()).toEqual([{ path: "/investments/refresh", method: "POST", body: undefined }]);
  });

  it("keeps the saved quotes on screen when a refresh fails, and says why", async () => {
    accounts = [...original, brokerage];
    refresh = "fails";
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Show the detail for Long-term brokerage" }));
    const holdings = within(await screen.findByLabelText("Holdings"));
    const reads = () => calls.filter((call) => call.path === "/accounts" && call.method === "GET").length;
    const before = reads();
    fireEvent.click(holdings.getByRole("button", { name: "Refresh quotes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quote unavailable for MSTR. Check the ticker or try again later.");
    expect(holdings.getAllByRole("row")[1]).toHaveTextContent("MSTR5missing$2,000.00");
    expect(holdings.getAllByRole("row")[2]).toHaveTextContent("VTI10$245.00$2,450.00");
    expect(reads()).toBe(before);
  });

  it("records a new value with the amount and date as typed, after the last one", async () => {
    accounts = [...original, home];
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Show the detail for Blue Ridge home" }));
    const value = within(await screen.findByLabelText("Value"));
    // The history is listed newest first and is never edited.
    const history = within(await value.findByRole("list", { name: "Recorded values, newest first" })).getAllByRole("listitem");
    expect(history.map((item) => item.textContent)).toEqual(["2026-11-03$329,400.00", "2026-06-01$325,000.00"]);
    fireEvent.change(value.getByLabelText("Worth now"), { target: { value: "$412,500.50" } });
    fireEvent.change(value.getByLabelText("As of"), { target: { value: "2026-11-03" } });
    fireEvent.click(value.getByRole("button", { name: "Record value" }));
    expect(await value.findByRole("alert")).toHaveTextContent("A new value must be dated after the last one, 2026-11-03");
    expect(writes()).toHaveLength(0);
    fireEvent.change(value.getByLabelText("As of"), { target: { value: "2026-11-15" } });
    fireEvent.click(value.getByRole("button", { name: "Record value" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: "/assets/7/valuations", method: "POST", body: { date: "2026-11-15", value: "412500.50" } });
  });

  it("records the first value for a property through its account", async () => {
    accounts = [...original, home];
    assets = [];
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Show the detail for Blue Ridge home" }));
    const value = within(await screen.findByLabelText("Value"));
    await value.findByText(/No value has been recorded/);
    fireEvent.change(value.getByLabelText("Worth now"), { target: { value: "331000" } });
    fireEvent.click(value.getByRole("button", { name: "Record value" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: "/accounts/21/valuations", method: "POST", body: { date: "2026-11-19", value: "331000.00" } });
  });

  it("records a card payment from checking, with the interest inside it filed as an expense", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Record a payment to Ridgeline Visa" }));
    expect(dialog().getByLabelText("Pay from")).toHaveValue("3");
    // Only accounts that can pay are offered: not the card itself, and not the bitcoin wallet for a dollar debt.
    expect(within(dialog().getByLabelText("Pay from")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Everyday checking · $4,812.40", "Rainy day · $1,500.00"]);
    set("Amount", "$10");
    set("Interest and fees in it", "12.34");
    // The category is asked for only once some of the payment is interest.
    await dialog().findByRole("option", { name: "Dining" });
    set("Interest category", "3");
    fireEvent.click(dialog().getByRole("button", { name: "Record payment" }));
    expect(await dialog().findByRole("alert")).toHaveTextContent("at least as large as the interest and fees");
    expect(writes()).toHaveLength(0);
    set("Amount", "$500");
    expect(dialog().getByText(/comes off the balance/)).toHaveTextContent("$487.66 comes off the balance; $12.34 is recorded as an expense.");
    fireEvent.click(dialog().getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/accounts/10/payments",
      method: "POST",
      body: { account_id: 3, date: "2026-11-19", amount: "500.00", interest: "12.34", category_id: 3, notes: "" },
    });
  });

  it("can leave a debt out of consumer debt, and never offers that for other accounts", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Change Everyday checking" }));
    expect(dialog().queryByLabelText("Leave this out of consumer debt")).not.toBeInTheDocument();
    fireEvent.click(dialog().getByRole("button", { name: /Cancel/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change Ridgeline Visa" }));
    fireEvent.click(dialog().getByLabelText("Leave this out of consumer debt"));
    fireEvent.click(dialog().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes().length).toBeGreaterThan(0));
    expect(writes()[0]).toEqual({ path: "/accounts/10", method: "PATCH", body: { name: "Ridgeline Visa", archived: false, exclude_from_consumer_debt: true } });
  });
});
