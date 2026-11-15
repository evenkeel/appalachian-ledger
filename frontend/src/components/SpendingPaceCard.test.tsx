import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SpendingPaceCard } from "./SpendingPaceCard";
import { expense } from "../test/expenseFixtures";

const now = new Date("2026-11-07T12:00:00");
test("compares only elapsed days, excludes future entries and transfers, and opens Expenses", () => {
  const onOpen = vi.fn();
  render(
    <SpendingPaceCard
      month="2026-11"
      now={now}
      onOpen={onOpen}
      transactions={[
        expense({ amount: "120.00" }),
        expense({ id: 2, date: "2026-10-05", amount: "80.00" }),
        expense({ id: 3, date: "2026-10-20", amount: "900.00" }),
        expense({ id: 4, date: "2026-11-20", amount: "900.00" }),
        expense({ id: 5, kind: "transfer", amount: "900.00" }),
      ]}
    />,
  );
  expect(screen.getAllByText("$120.00")[0]).toBeInTheDocument();
  expect(
    screen.getByText("$40.00 more than last month through day 7."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View expenses" }));
  expect(onOpen).toHaveBeenCalledOnce();
});

test("shows missing saved references and recovers when switching to native currency", () => {
  render(
    <SpendingPaceCard
      month="2026-11"
      now={now}
      onOpen={() => {}}
      transactions={[
        expense({ currency: "BITCOIN", amount: "12345", purchase_cost: null }),
        expense({ id: 2, date: "2026-10-05" }),
      ]}
    />,
  );
  expect(screen.getAllByText("Unavailable")[0]).toBeInTheDocument();
  expect(
    screen.getByText("1 expense needs a saved conversion reference."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "bitcoin" }));
  expect(screen.getAllByText("₿12,345")[0]).toBeInTheDocument();
});

test("does not imply a comparison without a recorded baseline or for a future month", () => {
  const { rerender } = render(
    <SpendingPaceCard
      month="2026-11"
      now={now}
      onOpen={() => {}}
      transactions={[]}
    />,
  );
  expect(screen.queryByText(/Building your baseline/)).not.toBeInTheDocument();
  expect(screen.queryByText("Last month")).not.toBeInTheDocument();
  rerender(
    <SpendingPaceCard
      month="2026-12"
      now={now}
      onOpen={() => {}}
      transactions={[]}
    />,
  );
  expect(
    screen.getByText("Spending will appear as expenses are recorded."),
  ).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});

test("shows one basic spending line without category details", () => {
  render(
    <SpendingPaceCard
      month="2026-11"
      now={now}
      onOpen={() => {}}
      transactions={[expense()]}
    />,
  );
  const chart = screen.getByRole("img", {
    name: /Cumulative recorded spending/,
  });
  expect(chart.querySelectorAll("path")).toHaveLength(1);
  expect(chart.querySelector("path")).toHaveClass("overview-pace-current");
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Spending breakdown by category"),
  ).not.toBeInTheDocument();
});
