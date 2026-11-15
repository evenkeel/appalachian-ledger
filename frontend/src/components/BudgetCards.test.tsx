import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetCards } from "./BudgetCards";
import type { BudgetOverview } from "../lib/types";
const plan: BudgetOverview = {
  category_id: 1,
  category: "Dining",
  budget_id: 2,
  planned_usd: "180.00",
  spent_usd: "80.59",
  spent_bitcoin: "68053",
  remaining_usd: "99.41",
  percent: "44.8",
};
test("budget card shows bitcoin spent and a dollar plan, without repeated conversion labels", () => {
  const edit = vi.fn();
  render(<BudgetCards budgets={[plan]} onEdit={edit} />);
  expect(screen.getByText("₿68,053")).toBeInTheDocument();
  expect(screen.getByText("$180.00")).toBeInTheDocument();
  expect(screen.getByText("$80.59")).toBeInTheDocument();
  expect(screen.getByText("$99.41")).toBeInTheDocument();
  expect(screen.queryByText(/all spending|converted/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit budget" }));
  expect(edit).toHaveBeenCalledWith(plan);
});
test("an unspent USD plan has zero bitcoin spent, never a converted allowance", () => {
  render(
    <BudgetCards
      budgets={[
        {
          ...plan,
          spent_usd: "0",
          spent_bitcoin: "0",
          remaining_usd: "180.00",
          percent: "0.0",
        },
      ]}
      onEdit={() => {}}
    />,
  );
  expect(screen.getByText("₿0")).toBeInTheDocument();
  expect(screen.queryByText("₿180,000")).not.toBeInTheDocument();
});
test("a missing USD plan asks for one and missing prices are not presented as zero", () => {
  render(
    <BudgetCards
      budgets={[
        {
          ...plan,
          budget_id: null,
          planned_usd: null,
          spent_bitcoin: null,
          remaining_usd: null,
          percent: null,
        },
      ]}
      onEdit={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Set USD budget" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("Remaining")).not.toBeInTheDocument();
  expect(screen.queryByText("$180.00")).not.toBeInTheDocument();
});
