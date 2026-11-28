import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, empty, periods, reading, report, transactions } from "../test/fixture";
import type { Period } from "./history";
import type { DashboardData } from "./types";
import { act } from "@testing-library/react";
import { setPrivate } from "../lib/privacy";

const calls: { path: string; method: string; body?: unknown }[] = [];
let current: DashboardData = reading;
let history: Period[] = periods;
vi.mock("../../lib/api", () => ({
  setCsrf: () => {},
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path === "/dashboard") return current;
    if (path.startsWith("/transactions")) return current === empty ? [] : transactions;
    if (path === "/categories") return categories;
    if (path.startsWith("/reports")) return current === empty ? { month: "2026-11", dual: { USD: { income_categories: [], categories: [] }, BITCOIN: { income_categories: [], categories: [] } } } : report;
    if (path.startsWith("/spending-history")) return { periods: history };
    return { ok: true };
  }),
}));
let lens = "USD";
vi.mock("../lib/session", () => ({
  useSession: () => ({ lens, demoEnabled: false }),
}));

import { Dashboard } from "./Dashboard";

const show = async () => {
  render(<Dashboard go={() => {}} onData={() => {}} />);
  await screen.findByLabelText(/^Checking forecast/);
};

beforeEach(() => {
  calls.length = 0;
  current = reading;
  history = periods;
  lens = "USD";
});

describe("dashboard", () => {
  it("can hide the balance while spending and this month's stacking stay readable", async () => {
    lens = "BITCOIN";
    render(<Dashboard go={() => {}} onData={() => {}} />);
    await screen.findByLabelText(/^Checking forecast/);
    const stack = screen.getByLabelText(/^Stack: /);
    // Everything that gives the balance away is marked for the blur: the balance, the milestone and
    // what is left to it, and the tape's scale around the balance.
    expect(within(stack).getByText("₿21,932,000")).toHaveClass("private");
    expect(within(stack).getByText("₿22,000,000")).toHaveClass("private");
    expect(within(stack).getByText("₿68,000")).toHaveClass("private");
    expect(stack.querySelectorAll("svg text.private").length).toBeGreaterThan(1);
    // This month's stacking and the bitcoin spending stay plain.
    const gained = within(stack).getByText(/^▲ ₿/);
    expect(gained.closest(".private")).toBeNull();
    const pace = screen.getByLabelText(/^Spend pace/);
    expect(pace.querySelector(".private")).toBeNull();
    expect(pace).toHaveTextContent("₿");
    // Hover tips cannot be blurred, so the balance in them is hidden instead. The panel is looked up
    // again each time, as a late answer from the server can draw it afresh.
    const tips = () => [...screen.getByLabelText(/^Stack: /).querySelectorAll("title")].map((title) => title.textContent ?? "");
    expect(tips().some((tip) => tip.includes("₿21,932,000"))).toBe(true);
    act(() => setPrivate(true));
    expect(document.documentElement).toHaveAttribute("data-private");
    expect(tips().filter((tip) => /₿\d/.test(tip))).toEqual([]);
    act(() => setPrivate(false));
  });

  it("shows the day-one readings exactly as the ledger reports them", async () => {
    await show();
    const cash = screen.getByLabelText(/^Checking forecast/);
    expect(within(cash).getByText("Covered through payday")).toBeInTheDocument();
    expect(within(cash).getByText("$2,128.04")).toBeInTheDocument();
    const stack = screen.getByLabelText(/^Stack: /);
    expect(within(stack).getByText("₿21,932,000")).toBeInTheDocument();
    expect(within(stack).getByText("11.3%")).toBeInTheDocument();
    expect(within(stack).getByText("best yet")).toBeInTheDocument();
    expect(within(stack).getByText("₿68,000").parentElement).toHaveTextContent(/^₿68,000 to go$/);
    // Spend pace: $154.20 so far against $126.30 by the same day last month.
    const pace = screen.getByLabelText(/^Spend pace/);
    expect(within(pace).getByText("$154.20")).toBeInTheDocument();
    expect(within(pace).getByText(/\$27\.90 more/)).toBeInTheDocument();
  });

  it("never says sats", async () => {
    await show();
    expect(document.body.textContent).not.toMatch(/\bsats?\b|satoshi/i);
  });

  it("warns when checking runs short before payday", async () => {
    current = { ...reading, cash_ahead: { ...reading.cash_ahead, short: { date: "2026-11-28", amount: "757.46" } } };
    await show();
    expect(screen.getByText("Short before payday")).toBeInTheDocument();
    expect(within(screen.getByLabelText(/^Bills: /)).getByText("$757.46 short.")).toBeInTheDocument();
  });

  it("pays a bill only after the confirm step, with the due date it was shown", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Pay Mortgage, $1,400.00" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    const sheet = screen.getByRole("dialog", { name: "Pay Mortgage" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        path: "/recurring-bills/7/record",
        method: "POST",
        body: { due_date: "2026-11-21", date: "2026-11-19", amount: "1400.00" },
      }),
    );
  });

  it("destroys a bill for good and shows what that frees each year", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Destroy Streaming for good" }));
    const sheet = screen.getByRole("dialog", { name: "Destroy Streaming" });
    expect(within(sheet).getByText("$275.88")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Destroy" }));
    await waitFor(() => expect(calls).toContainEqual({ path: "/recurring-bills/9/destroy", method: "POST", body: undefined }));
  });

  it("refuses to pay off a debt that checking cannot cover", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Pay off Mortgage in full and destroy it" }));
    const sheet = screen.getByRole("dialog", { name: "Pay off Mortgage" });
    expect(within(sheet).getByText("Not enough in checking.")).toBeInTheDocument();
    expect(within(sheet).getByText("$205,107.60")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Pay off" })).toBeDisabled();
  });

  it("is useful on an empty ledger and draws no empty charts", async () => {
    current = empty;
    await show();
    expect(screen.getByText("0 of 5 done")).toBeInTheDocument();
    // Prices come from Coinbase from the start: choosing a source is not a setup step.
    expect(screen.queryByText("Choose a price source")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Stack: bitcoin held")).toHaveTextContent("Record what you hold");
    expect(screen.getByLabelText("Spend pace: this month so far")).toHaveTextContent("Record your first expense");
    expect(document.querySelector("svg[role=img]")).toBeNull();
  });

  it("says what a history panel is waiting for instead of drawing it early", async () => {
    current = { ...reading, days_of_history: 19, first_entry_date: "2026-11-01" };
    history = [];
    await show();
    expect(await screen.findByLabelText("Cost of living: the same life, priced two ways")).toHaveTextContent("Collecting data — 19 of 60 days");
  });

  it("shows the same life priced in both systems once two full months exist", async () => {
    await show();
    const label = "Cost of living: the same life, priced two ways";
    await waitFor(() => expect(screen.getByLabelText(label)).toHaveTextContent("Since June 2026, a month of your life costs +4.8% in dollars and −11.7% in bitcoin."));
    const two = screen.getByLabelText(label);
    expect(within(two).getByText("$2,946.10")).toBeInTheDocument();
    expect(within(two).getByText("₿2,584,298")).toBeInTheDocument();
  });

  it("leaves a month out of the bitcoin line rather than guess a missing price", async () => {
    history = [...periods.slice(0, 4), { period: "2026-10", usd: "2946.10", bitcoin: null, missing_bitcoin: 3 }];
    await show();
    const label = "Cost of living: the same life, priced two ways";
    await waitFor(() => expect(screen.getByLabelText(label)).toHaveTextContent("1 month left out of the bitcoin line"));
    expect(screen.getByLabelText(label)).toHaveTextContent("−8.9% in bitcoin"); // through September, the last fully priced month
  });

  it("bridges last month to this one by category, exactly, in dollars and in bitcoin", async () => {
    const { unmount } = render(<Dashboard go={() => {}} onData={() => {}} />);
    const bridge = await screen.findByLabelText("Spending bridge: what changed since October");
    await waitFor(() => expect(bridge).toHaveTextContent("Oct 1–19 · $126.30"));
    expect(bridge).toHaveTextContent("Nov 1–19 · $154.20");
    expect(within(bridge).getByRole("button", { name: /^Groceries: \$40\.00 more than October/ })).toBeInTheDocument();
    expect(within(bridge).getByRole("button", { name: /^Dining: \$12\.10 less than October/ })).toBeInTheDocument();
    expect(within(bridge).queryByRole("button", { name: /^Transport/ })).toBeNull(); // unchanged, so not a step
    unmount();
    lens = "BITCOIN";
    render(<Dashboard go={() => {}} onData={() => {}} />);
    const inBitcoin = await screen.findByLabelText("Spending bridge: what changed since October");
    await waitFor(() => expect(inBitcoin).toHaveTextContent("Oct 1–19 · ₿110,770"));
    expect(inBitcoin).toHaveTextContent("Nov 1–19 · ₿129,840");
    expect(within(inBitcoin).getByRole("button", { name: /^Groceries: ₿31,870 more/ })).toBeInTheDocument();
  });

  it("puts bitcoin stacked first in the money flow and never calls leftover dollars savings", async () => {
    await show();
    const flow = await screen.findByLabelText(/^Money flow: November's income/);
    await waitFor(() => expect(flow).toHaveTextContent("Bitcoin stacked"));
    const chart = within(flow).getByRole("img");
    expect(chart.getAttribute("aria-label")).toMatch(/^Where November's income went: Bitcoin stacked ₿672,400 · \$800\.00, Groceries \$91\.80, Transport \$40\.00, Dining \$22\.40, Other moves out \$500\.00, Still in checking \$5,595\.80\.$/);
    expect(flow).toHaveTextContent("dollars waiting, not savings");
    expect(flow.textContent).not.toMatch(/saved|surplus|kept|savings rate/i);
  });

  it("opens a category's entries from the bridge", async () => {
    const onDrill = vi.fn();
    render(<Dashboard go={() => {}} onData={() => {}} onDrill={onDrill} />);
    const bridge = await screen.findByLabelText("Spending bridge: what changed since October");
    fireEvent.click(await within(bridge).findByRole("button", { name: /^Groceries/ }));
    expect(onDrill).toHaveBeenCalledWith("2");
  });
});
