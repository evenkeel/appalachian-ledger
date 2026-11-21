import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reading } from "../test/fixture";
import { CashAheadPanel } from "./panels";
import type { DashboardData } from "./types";

/** $360.39 in checking, one small bill from checking, two bills charged to a card before payday. */
const withCard = (allShort: boolean): DashboardData => ({
  ...reading,
  cash_ahead: {
    ...reading.cash_ahead,
    start: "360.39",
    events: [
      { kind: "bill", date: "2026-11-20", name: "Insurance", amount: "250.00", balance_after: "360.39", all_bills_after: "110.39", on_card: true, account: "Visa", overdue: false, bill_id: 4 },
      { kind: "bill", date: "2026-11-22", name: "Water", amount: "40.00", balance_after: "320.39", all_bills_after: "70.39", on_card: false, overdue: false, bill_id: 5 },
      { kind: "bill", date: "2026-11-24", name: "Phone", amount: allShort ? "180.00" : "30.00", balance_after: "320.39", all_bills_after: allShort ? "-109.61" : "40.39", on_card: true, account: "Visa", overdue: false, bill_id: 6 },
      { kind: "paycheck", date: "2026-12-01", name: "Salary", amount: "3100.00", balance_after: "3420.39", all_bills_after: allShort ? "2990.39" : "3140.39", schedule_id: 1 },
    ],
    due_before_paycheck: "40.00",
    low: { date: "2026-11-22", balance: "320.39" },
    short: null,
    covered_days: 28,
    card_bills: { count: 2, due_before_paycheck: allShort ? "430.00" : "280.00", total: allShort ? "430.00" : "280.00" },
    all_bills: {
      due_before_paycheck: allShort ? "470.00" : "320.00",
      low: { date: "2026-11-24", balance: allShort ? "-109.61" : "40.39" },
      short: allShort ? { date: "2026-11-24", amount: "109.61" } : null,
    },
    other_bills: 1,
  },
});
const show = (data: DashboardData) => {
  render(<CashAheadPanel data={data} go={() => {}} onPaycheck={() => {}} />);
  return screen.getByLabelText("Cash ahead: checking after known bills");
};

describe("cash ahead with bills on a card", () => {
  it("counts card bills in what is due, and says when checking could not cover them too", () => {
    const panel = show(withCard(true));
    expect(panel).toHaveTextContent("Covered, until the card is due");
    expect(panel).toHaveTextContent("Set aside for 2 bills on a card too and it is $109.61 short by Nov 24.");
    expect(panel).toHaveTextContent("Due before payday$470.00$430.00 of it on a card");
    expect(panel).toHaveTextContent("Short, with card bills$109.61");
    // Checking itself is not short, so nothing here uses the warning colour's wording.
    expect(panel).not.toHaveTextContent("Short before payday");
    expect(within(panel).getByRole("img")).toHaveAccessibleName(/With bills on a card set aside too, checking is short by \$109\.61 from Nov 24\./);
    expect(panel).toHaveTextContent("1 bill paid from another account, such as savings, is not drawn here.");
  });

  it("says so when checking covers the card's bills as well", () => {
    const panel = show(withCard(false));
    expect(panel).toHaveTextContent("Covered through payday");
    expect(panel).toHaveTextContent("Bills paid from checking are covered for 28 days");
    expect(panel).toHaveTextContent("There is enough to set aside for 2 bills on a card as well.");
    expect(panel).toHaveTextContent("Free after all bills$40.39");
    expect(panel).toHaveTextContent("Circle = paid from checking · square = on a card");
  });

  it("draws a square for each bill on a card and a circle for each paid from checking", () => {
    const panel = show(withCard(true));
    const chart = within(panel).getByRole("img");
    expect(chart.querySelectorAll("rect > title")).toHaveLength(2);
    expect(chart.querySelector("rect > title")?.textContent).toBe(
      "Insurance $250.00, charged to Visa on Nov 20. It does not leave checking that day. With it set aside, checking would be $110.39.",
    );
    expect([...chart.querySelectorAll("circle > title")].map((title) => title.textContent).filter((text) => text?.startsWith("Water"))).toHaveLength(1);
  });

  it("reads exactly as before when no bill is on a card", () => {
    const panel = show(reading);
    expect(panel).toHaveTextContent("Covered through payday");
    expect(panel).toHaveTextContent("Known bills are covered for");
    expect(panel).toHaveTextContent("Free after bills");
    expect(panel).not.toHaveTextContent("on a card");
    expect(within(panel).getByRole("img").querySelectorAll("rect > title")).toHaveLength(0);
  });
});
