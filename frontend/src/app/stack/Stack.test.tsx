import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Transaction } from "../../lib/types";
import type { DashboardData } from "../dashboard/types";
import { categories, empty, periods, reading, report, transactions } from "../test/fixture";
import { bitcoinPerDollar, buysFrom, totals, usdPerBtc } from "./price";

const wallet = (id: number, name: string, balance: string, usd: string | null, archived = false): Account => ({
  id,
  name,
  kind: "bitcoin_wallet",
  role: "asset",
  currency: "BITCOIN",
  balance,
  balance_minor: balance,
  bitcoin: balance,
  usd,
  value: usd,
  holding_type: "bitcoin",
  archived,
  rate_day: usd === null ? null : "2026-11-19",
  rate_source: usd === null ? null : "Fictional demo rate",
});
const checking: Account = { ...wallet(3, "Everyday checking", "4812.40", "4812.40"), kind: "checking", currency: "USD", holding_type: "dollars" };

const transfer = (id: number, date: string, amount: string, received: string | null, toBitcoin = true): Transaction => ({
  id,
  date,
  kind: "transfer",
  description: toBitcoin ? "Bitcoin buy" : "To savings",
  notes: "",
  account_id: 3,
  account: "Everyday checking",
  currency: "USD",
  amount,
  destination_id: toBitcoin ? 5 : 4,
  destination_amount: received,
  destination_currency: toBitcoin ? "BITCOIN" : "USD",
  destination_account: toBitcoin ? "Cold storage" : "Savings",
  category_id: null,
  category: "Transfer",
  bitcoin: null,
  usd: amount,
  rate_snapshot: null,
  valuation_basis: "historical purchasing power",
});
/** Two buys and a dollar transfer that must not be listed. */
const transfers: Transaction[] = [
  transfer(41, "2026-11-17", "400.00", "334300"),
  transfer(40, "2026-11-05", "250.00", "250.00", false),
  transfer(33, "2025-12-03", "400.00", "420000"),
];

const calls: string[] = [];
let current: DashboardData = reading;
let accounts: Account[] = [];
let moves: Transaction[] = transfers;
let failing = "";
vi.mock("../../lib/api", () => ({
  setCsrf: () => {},
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (failing && path.startsWith(failing)) throw new Error("server said no");
    if (path === "/dashboard") return current;
    if (path === "/accounts") return accounts;
    if (path === "/transactions?kind=transfer") return moves;
    if (path.startsWith("/transactions")) return transactions;
    if (path === "/prices/status") return { source: "manual", automatic: false, quote: null, history: null };
    if (path === "/categories") return categories;
    if (path.startsWith("/reports")) return report;
    if (path.startsWith("/spending-history")) return { periods };
    return { ok: true };
  }),
}));

import { Stack } from "./Stack";

const go = vi.fn();
beforeEach(() => {
  calls.length = 0;
  go.mockClear();
  current = reading;
  accounts = [checking, wallet(5, "Cold storage", "21000000", "24940.62"), wallet(6, "Phone wallet", "932000", "1106.89"), wallet(7, "Old wallet", "0", "0.00", true)];
  moves = transfers;
  failing = "";
});

describe("price paid", () => {
  it("is exact to the cent and rounds half to even", () => {
    expect(usdPerBtc(40000n, 334300n)).toBe("119653.01");
    expect(usdPerBtc(40000n, 420000n)).toBe("95238.10");
    expect(bitcoinPerDollar(40000n, 334300n)).toBe("836");
    // 1 cent for 800 units is 1,250.00 per BTC exactly; 12.5 units per dollar rounds to the even 12.
    expect(usdPerBtc(1n, 800n)).toBe("1250.00");
    expect(bitcoinPerDollar(800n, 100n)).toBe("12");
    expect(bitcoinPerDollar(800n, 108n)).toBe("14");
    expect(usdPerBtc(0n, 5n)).toBeNull();
    expect(usdPerBtc(500n, 0n)).toBeNull();
  });

  it("lists buys newest first with a running total, and leaves other transfers out", () => {
    const buys = buysFrom(transfers);
    expect(buys.map((buy) => buy.id)).toEqual([41, 33]);
    expect(buys.map((buy) => buy.soFar)).toEqual([754300n, 420000n]);
    expect(totals(buys)).toEqual({ spent: 80000n, bitcoin: 754300n, average: "106058.60" });
  });
});

describe("stack screen", () => {
  it("shows what is held, the score and every buy at the price paid", async () => {
    render(<Stack go={go} />);
    const held = await screen.findByLabelText("Held: all your bitcoin");
    expect(within(held).getByText("₿21,932,000")).toBeInTheDocument();
    expect(within(held).getByText("₿68,000 to go")).toBeInTheDocument();
    expect(within(held).getByText("2 buys for $800.00 this month")).toBeInTheDocument();
    expect(within(held).getByText("6-month streak")).toBeInTheDocument();

    const rate = screen.getByLabelText(/^Stack rate: your score/);
    expect(within(rate).getByText("11.3%", { selector: "b" })).toBeInTheDocument();
    expect(within(rate).getByText("of November's income stacked so far")).toBeInTheDocument();
    expect(within(rate).getByText("▲ 1.1 pts")).toBeInTheDocument();
    expect(within(rate).getByText("Best yet.")).toBeInTheDocument();

    const buys = await screen.findByLabelText(/^Buys: every buy at the price paid · 2 buys/);
    const rows = within(buys).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Nov 17");
    expect(rows[0]).toHaveTextContent("$400.00");
    expect(rows[0]).toHaveTextContent("+₿334,300");
    expect(rows[0]).toHaveTextContent("$119,653.01");
    expect(rows[0]).toHaveTextContent("₿836");
    expect(rows[0]).toHaveTextContent("₿754,300");
    // A buy from an earlier year carries its year.
    expect(rows[1]).toHaveTextContent("Dec 3, 2025");
    expect(rows[1]).toHaveTextContent("$95,238.10");
    expect(within(buys).getByText("$106,058.60")).toBeInTheDocument();
    expect(within(buys).getByText("$118,750.00")).toBeInTheDocument();
    expect(within(buys).queryByText(/To savings/)).not.toBeInTheDocument();

    expect(await screen.findByLabelText(/^Cost of living/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bsats?\b|satoshi/i);
  });

  it("lists active wallets with their dollar value, and says so when there is no price", async () => {
    accounts = [checking, wallet(5, "Cold storage", "21000000", "24940.62"), wallet(6, "Phone wallet", "932000", null), wallet(7, "Old wallet", "0", "0.00", true)];
    render(<Stack go={go} />);
    const wallets = await screen.findByLabelText("Wallets: where it is held");
    await within(wallets).findByText("Cold storage");
    expect(within(wallets).getByText("₿21,000,000")).toBeInTheDocument();
    expect(within(wallets).getByText("$24,940.62 today")).toBeInTheDocument();
    expect(within(wallets).getByText("₿932,000")).toBeInTheDocument();
    expect(within(wallets).getByText("no price")).toBeInTheDocument();
    expect(within(wallets).queryByText("Old wallet")).not.toBeInTheDocument();
    expect(within(wallets).queryByText("Everyday checking")).not.toBeInTheDocument();
  });

  it("shows a missing price as missing, never a guess", async () => {
    current = { ...reading, price: null };
    render(<Stack go={go} />);
    const price = await screen.findByLabelText("Price: no source chosen");
    expect(price).toHaveTextContent("Nothing is guessed.");
    fireEvent.click(within(price).getByRole("button", { name: "Choose a price source" }));
    expect(go).toHaveBeenCalledWith("settings");
    const buys = await screen.findByLabelText(/^Buys: /);
    await within(buys).findByText("$106,058.60");
    // The price paid comes from the buy itself, so it is still known; only today's price is missing.
    expect(within(buys).getByText("no price")).toBeInTheDocument();
    expect(within(buys).getByText("$119,653.01")).toBeInTheDocument();
  });

  it("shows the price in use and where it came from", async () => {
    current = { ...reading, price: { ...reading.price!, stale: true } };
    render(<Stack go={go} />);
    const price = await screen.findByLabelText("Price: what the dollar figures use");
    expect(within(price).getByText("₿842")).toBeInTheDocument();
    expect(within(price).getByText("$118,750.00")).toBeInTheDocument();
    expect(within(price).getByText("Source: Fictional demo rate")).toBeInTheDocument();
    expect(within(price).getByText("stale")).toBeInTheDocument();
    await within(price).findByText("By hand");
    fireEvent.click(within(price).getByRole("button", { name: "Price settings →" }));
    expect(go).toHaveBeenCalledWith("settings");
  });

  it("offers one action on a ledger with no bitcoin", async () => {
    current = empty;
    accounts = [];
    moves = [];
    render(<Stack go={go} />);
    const setup = await screen.findByLabelText("No bitcoin recorded yet: nothing to show");
    expect(screen.queryByLabelText(/^Held/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Buys/)).not.toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
    fireEvent.click(within(setup).getByRole("button", { name: "Add a bitcoin wallet" }));
    expect(go).toHaveBeenCalledWith("accounts");
    expect(screen.getByLabelText("Price: no source chosen")).toBeInTheDocument();
  });

  it("says so when bitcoin is held but nothing was bought", async () => {
    moves = [transfers[1]];
    render(<Stack go={go} />);
    const buys = await screen.findByLabelText("Buys: every buy at the price paid");
    await within(buys).findByText(/No buys recorded yet/);
    fireEvent.click(within(buys).getByRole("button", { name: "Record a bitcoin buy" }));
    expect(go).toHaveBeenCalledWith("activity");
  });

  it("keeps the rest of the screen when one part fails to load", async () => {
    failing = "/transactions?kind=transfer";
    render(<Stack go={go} />);
    await screen.findByText(/Buys could not load: server said no/);
    expect(screen.getByLabelText("Held: all your bitcoin")).toBeInTheDocument();
    expect(screen.getByText("Buys could not be loaded.")).toBeInTheDocument();
    failing = "";
    fireEvent.click(screen.getByRole("button", { name: "Retry →" }));
    await waitFor(() => expect(screen.queryByText(/could not load/)).not.toBeInTheDocument());
    expect(await screen.findByText("$119,653.01")).toBeInTheDocument();
  });
});
