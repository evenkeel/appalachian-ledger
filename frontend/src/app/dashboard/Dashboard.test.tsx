import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { empty, reading } from "../test/fixture";
import type { DashboardData } from "./types";

const calls: { path: string; method: string; body?: unknown }[] = [];
let current: DashboardData = reading;
vi.mock("../../lib/api", () => ({
  setCsrf: () => {},
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path === "/dashboard") return current;
    if (path.startsWith("/transactions")) return [];
    return { ok: true };
  }),
}));
vi.mock("../lib/session", () => ({
  useSession: () => ({ lens: "USD", demoEnabled: false }),
}));

import { Dashboard } from "./Dashboard";

const show = async () => {
  render(<Dashboard go={() => {}} onData={() => {}} />);
  await screen.findByLabelText(/^Cash ahead/);
};

beforeEach(() => {
  calls.length = 0;
  current = reading;
});

describe("dashboard", () => {
  it("shows the day-one readings exactly as the ledger reports them", async () => {
    await show();
    const cash = screen.getByLabelText(/^Cash ahead/);
    expect(within(cash).getByText("Covered through payday")).toBeInTheDocument();
    expect(within(cash).getByText("$2,128.04")).toBeInTheDocument();
    const stack = screen.getByLabelText(/^Stack: /);
    expect(within(stack).getByText("₿21,932,000")).toBeInTheDocument();
    expect(within(stack).getByText("11.3%")).toBeInTheDocument();
    expect(within(stack).getByText("best yet")).toBeInTheDocument();
    expect(within(stack).getByText("₿68,000 to go")).toBeInTheDocument();
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
    expect(within(sheet).getByText("Not enough ammo.")).toBeInTheDocument();
    expect(within(sheet).getByText("$205,107.60")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Pay off" })).toBeDisabled();
  });

  it("is useful on an empty ledger and draws no empty charts", async () => {
    current = empty;
    await show();
    expect(screen.getByText("0 of 6 done")).toBeInTheDocument();
    expect(screen.getByLabelText("Stack: bitcoin held")).toHaveTextContent("Record what you hold");
    expect(screen.getByLabelText("Spend pace: this month so far")).toHaveTextContent("Record your first expense");
    expect(document.querySelector("svg[role=img]")).toBeNull();
  });

  it("says what a history panel is waiting for instead of drawing it early", async () => {
    current = { ...reading, days_of_history: 19 };
    await show();
    expect(screen.getByLabelText("Two systems: the same life, priced two ways")).toHaveTextContent("Collecting data — 19 of 60 days");
    expect(screen.getByLabelText("Spending bridge: what changed since last month")).toHaveTextContent("19 of 30 days");
  });
});
