import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { SafeToSpend } from "./SafeToSpend";

const reading = {
  month: "2026-11",
  amount: "1550.00",
  per_day: "96.87",
  days_left: 16,
  income: "3000.00",
  spent: "500.00",
  set_aside: "500.00",
  bills_due: "250.00",
  bills_count: 1,
  goals: "200.00",
  complete: true,
};

test("shows the amount, a daily pace and each step of the sum", () => {
  render(<SafeToSpend reading={reading} />);
  expect(
    screen.getByRole("heading", { name: "Safe to spend" }),
  ).toBeInTheDocument();
  expect(screen.getByText("$1,550.00")).toBeInTheDocument();
  expect(screen.getByText(/\$96\.87 a day for the 16 days left/)).toBeVisible();
  expect(screen.getByText("Bills still due (1)")).toBeInTheDocument();
  expect(screen.getByText("−$250.00")).toBeInTheDocument();
});

test("an overspent month and a missing conversion are stated plainly", () => {
  const { rerender } = render(
    <SafeToSpend reading={{ ...reading, amount: "-80.00", per_day: "0.00" }} />,
  );
  expect(
    screen.getByRole("heading", { name: "Over this month by" }),
  ).toBeInTheDocument();
  expect(screen.getByText("$80.00")).toBeInTheDocument();
  rerender(
    <SafeToSpend
      reading={{ ...reading, amount: null, per_day: null, complete: false }}
    />,
  );
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
});
