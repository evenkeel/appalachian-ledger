import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { SpendingMix } from "./SpendingMix";
import { expense, expenseCategories } from "../test/expenseFixtures";

test("shows category shares for recorded expenses, excluding future entries and transfers", () => {
  render(
    <SpendingMix
      month="2026-11"
      now={new Date("2026-11-07T12:00:00")}
      categories={expenseCategories}
      transactions={[
        expense({ amount: "75.00" }),
        expense({ id: 2, category_id: 2, amount: "25.00" }),
        expense({ id: 3, date: "2026-11-20", amount: "900.00" }),
        expense({ id: 4, kind: "transfer", amount: "900.00" }),
      ]}
    />,
  );
  const card = within(screen.getByRole("region", { name: "Spending Mix" }));
  expect(card.getByText("Groceries")).toBeInTheDocument();
  expect(card.getByText("Dining")).toBeInTheDocument();
  expect(card.getByText("75.0%")).toBeInTheDocument();
  expect(card.getByText("25.0%")).toBeInTheDocument();
  expect(card.getByText("$75.00")).toBeInTheDocument();
  expect(card.getByRole("list", { name: "Expense categories" })).toHaveStyle({
    gridTemplateRows: "minmax(0, 0.75fr) minmax(0, 0.25fr)",
  });
});

test("does not invent shares when a saved conversion is missing", () => {
  render(
    <SpendingMix
      month="2026-11"
      now={new Date("2026-11-07T12:00:00")}
      categories={expenseCategories}
      transactions={[
        expense({ currency: "BITCOIN", amount: "12345", purchase_cost: null }),
      ]}
    />,
  );
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(
    screen.getByText("Category shares need saved conversion references."),
  ).toBeInTheDocument();
});
