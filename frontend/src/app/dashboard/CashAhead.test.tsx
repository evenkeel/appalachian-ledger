import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reading } from "../test/fixture";
import type { CashCard, DashboardData } from "./types";

const calls: { path: string; method: string; body?: unknown }[] = [];
vi.mock("../../lib/api", () => ({
  setCsrf: () => {},
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    return { ok: true };
  }),
}));

import { CashAheadPanel } from "./panels";

const visa: CashCard = {
  account_id: 10,
  name: "Visa",
  owed: "100.00",
  due_day: 25,
  plan: "full",
  paid_by: null,
  next_payment: { date: "2026-11-25", amount: "280.00" },
  charges: { count: 3, total: "245.00" },
};

/** $360.39 in checking, one bill from checking, and a Visa paid off in full before payday. */
const withCard = (short: boolean): DashboardData => ({
  ...reading,
  cash_ahead: {
    ...reading.cash_ahead,
    start: "360.39",
    events: [
      { kind: "bill", date: "2026-11-22", name: "Water", amount: "40.00", balance_after: "320.39", overdue: false, bill_id: 5 },
      {
        kind: "card",
        date: "2026-11-25",
        name: "Visa",
        amount: short ? "430.00" : "280.00",
        balance_after: short ? "-109.61" : "40.39",
        account_id: 10,
        owed_now: "100.00",
        charged: short ? "330.00" : "180.00",
        charged_count: 2,
      },
      { kind: "paycheck", date: "2026-12-01", name: "Salary", amount: "3100.00", balance_after: short ? "2990.39" : "3140.39", schedule_id: 1 },
    ],
    due_before_paycheck: short ? "470.00" : "320.00",
    low: { date: "2026-11-25", balance: short ? "-109.61" : "40.39" },
    short: short ? { date: "2026-11-25", amount: "109.61" } : null,
    covered_days: short ? 5 : 11,
    cards: [{ ...visa, next_payment: { date: "2026-11-25", amount: short ? "430.00" : "280.00" } }],
    other_bills: 1,
  },
});
const show = (data: DashboardData, onChanged?: () => void) => {
  render(<CashAheadPanel data={data} go={() => {}} onPaycheck={() => {}} onChanged={onChanged} />);
  return screen.getByLabelText("Checking forecast: after bills and card payments");
};

beforeEach(() => {
  calls.length = 0;
});

describe("checking forecast with a card paid off in full", () => {
  it("counts the card payment in what is due, and on the one line", () => {
    const panel = show(withCard(false));
    expect(panel).toHaveTextContent("Covered through payday");
    expect(panel).toHaveTextContent("Bills and card payments are covered for 11 days");
    expect(panel).toHaveTextContent("Due before payday$320.00$280.00 of it to Visa");
    expect(panel).toHaveTextContent("Free after bills$40.39lowest on Nov 25");
    expect(panel).toHaveTextContent("Visa is paid in full on Nov 25: $100.00 owed today, plus 2 bills charged to it before then.");
    expect(panel).toHaveTextContent("1 bill paid from another account, such as savings, is not drawn here.");
  });

  it("names the card on the chart with its amount and due date, and has no squares", () => {
    const chart = within(show(withCard(false))).getByRole("img");
    expect(chart).toHaveAccessibleName("Projected checking balance. Lowest point $40.39 on Nov 25. Visa $280.00 due Nov 25.");
    expect(chart).toHaveTextContent("Visa $280.00 · Nov 25");
    expect(chart).toHaveTextContent("Payday Dec 1");
    expect(chart).toHaveTextContent("Low $40.39");
    // The only rectangles left are the clipping and hatch definitions.
    expect(chart.querySelectorAll("rect")).toHaveLength(chart.querySelectorAll("defs rect").length);
    expect([...chart.querySelectorAll("circle > title")].map((title) => title.textContent)).toEqual([
      "Water $40.00, due Nov 22. Checking after: $320.39.",
      "Visa paid in full from checking on Nov 25: $280.00. That is $100.00 owed today plus 2 bills charged before then ($180.00). Checking after: $40.39.",
      "Planned: Salary $3,100.00 on Dec 1. Not recorded yet. Checking after: $3,140.39.",
      "In checking today: $360.39.",
    ]);
  });

  it("is short when the card payment takes checking below zero", () => {
    const panel = show(withCard(true));
    expect(panel).toHaveTextContent("Short before payday");
    expect(panel).toHaveTextContent("Checking runs out on Nov 25, before the Dec 1 paycheck.");
    expect(panel).toHaveTextContent("Shortfall$109.61");
    const chart = within(panel).getByRole("img");
    expect(chart).toHaveAccessibleName(/Falls short by \$109\.61 from Nov 25\./);
    expect(chart).toHaveTextContent("Short $109.61");
  });

  it("says so when a card due after payday takes checking under even with the paycheck", () => {
    const data = withCard(true);
    data.cash_ahead.next_paycheck = { date: "2026-11-24", name: "Salary", amount: "50.00" };
    const panel = show(data);
    expect(panel).toHaveTextContent("Short on Nov 25");
    expect(panel).toHaveTextContent("Checking runs out on Nov 25, even with the Nov 24 paycheck.");
  });

  it("leaves a card to the bill that pays it down, and names that bill on the chart", () => {
    const data = withCard(false);
    data.cash_ahead.events[1] = { kind: "bill", date: "2026-11-25", name: "Visa payment", amount: "150.00", balance_after: "170.39", overdue: false, bill_id: 6, account_id: 10 };
    data.cash_ahead.cards = [{ ...visa, owed: "8000.00", plan: "bill", paid_by: "Visa payment", next_payment: { date: "2026-11-25", amount: "150.00" }, charges: { count: 1, total: "60.00" } }];
    const panel = show(data);
    expect(within(panel).getByRole("img")).toHaveTextContent("Visa payment $150.00 · Nov 25");
    expect(panel).toHaveTextContent("$150.00 of it to Visa");
    expect(panel).toHaveTextContent("Visa owes $8,000.00. Your Visa payment bill pays it down, so that bill is what is drawn, not a payment in full. 1 bill charged to the card adds to what it owes.");
  });

  it("asks for the due day of a card that has none, and saves it without touching the limit", async () => {
    const data = withCard(false);
    data.cash_ahead.events = data.cash_ahead.events.filter((event) => event.kind !== "card");
    data.cash_ahead.cards = [{ ...visa, due_day: null, plan: null, next_payment: null }];
    const changed = vi.fn();
    const panel = show(data, changed);
    expect(panel).toHaveTextContent("Visa owes $100.00, with 3 more bills charged to it in the next 30 days. It has no due day, so paying it off is not in this forecast yet.");
    expect(panel).toHaveTextContent("Known bills are covered for");
    fireEvent.change(within(panel).getByLabelText("Day of the month Visa is due"), { target: { value: "14" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add to forecast" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    // The fixture's card 10 has a $6,000 limit; saving the due day sends it back as it was.
    expect(calls).toEqual([{ path: "/accounts/10/card-terms", method: "PUT", body: { credit_limit: "6000.00", due_day: 14 } }]);
  });

  it("reads plainly when there are no cards", () => {
    const data = withCard(false);
    data.cash_ahead.events = data.cash_ahead.events.filter((event) => event.kind !== "card");
    data.cash_ahead.cards = [];
    const panel = show(data);
    expect(panel).toHaveTextContent("Known bills are covered for");
    expect(panel).not.toHaveTextContent("Card payment");
    expect(panel).not.toHaveTextContent("of it to");
  });
});
