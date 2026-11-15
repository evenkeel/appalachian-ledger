import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExpensesView } from "./ExpensesView";
import type { Account, Transaction } from "../lib/types";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const expense: Transaction = {
  id: 1,
  date: "2026-11-05",
  kind: "expense",
  description: "Electric bill",
  notes: "",
  account_id: 1,
  account: "Checking",
  currency: "USD",
  amount: "80.00",
  category_id: 2,
  category: "Utilities",
  destination_id: null,
  destination_amount: null,
  destination_currency: null,
  destination_account: null,
  bitcoin: null,
  usd: "80.00",
  rate_snapshot: null,
  valuation_basis: "historical purchasing power",
};
const props = {
  revision: 0,
  month: "2026-11",
  accounts: [{ id: 1, name: "Checking" } as Account],
  categories: [{ id: 2, name: "Utilities", kind: "expense" as const }],
  transactions: [
    expense,
    { ...expense, id: 2, kind: "income", description: "Salary" },
    { ...expense, id: 3, kind: "transfer", description: "Savings transfer" },
    { ...expense, id: 4, date: "2026-10-05", description: "Old bill" },
  ],
  onAdd: vi.fn(),
  onSaved: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/expense-costs") ? { payments: [], months: [] } : [],
  );
});

test("one Analysis workspace contains calendar and charts without navigation tabs", () => {
  const { container } = render(<ExpensesView {...props} />);
  expect(
    screen.queryByRole("heading", { name: "Analysis" }),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".analysis-controls")).toContainElement(
    screen.getByRole("button", { name: "Add expense" }),
  );
  expect(
    screen.getByRole("heading", { name: "Upcoming Expenses" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Spending Pace" }),
  ).toBeInTheDocument();
  expect(container.querySelector(".expense-tabs")).not.toBeInTheDocument();
  const readingOrder = [
    container.querySelector(".analysis-controls")!,
    screen.getByRole("heading", { name: "Spending Pace" }),
    screen.getByRole("heading", { name: "Spending Bridge" }),
    screen.getByRole("heading", { name: "Category Explorer" }),
    container.querySelector(".analysis-calendar")!,
    screen.getByRole("heading", { name: "Upcoming Expenses" }),
    container.querySelector(".expense-records")!,
    container.querySelector(".expense-costs")!,
  ];
  readingOrder.slice(1).forEach((element, index) => {
    expect(
      readingOrder[index].compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  expect(screen.getAllByRole("button", { name: "Add expense" })).toHaveLength(
    1,
  );
  expect(container.querySelector(".expense-records")).not.toHaveAttribute(
    "open",
  );
  expect(container.querySelector(".expense-costs")).not.toHaveAttribute("open");
});

test("recorded expenses retain search, dates, repeat, and edit inside Analysis", () => {
  const { container } = render(<ExpensesView {...props} />);
  fireEvent.click(container.querySelector(".expense-records > summary")!);
  expect(screen.getByText("Electric bill")).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  expect(screen.queryByText("Savings transfer")).not.toBeInTheDocument();
  expect(screen.queryByText("Old bill")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Repeat Electric bill" }));
  expect(props.onAdd).toHaveBeenCalledWith({
    type: "transaction",
    kind: "expense",
    repeat: expense,
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit Electric bill" }));
  expect(props.onAdd).toHaveBeenCalledWith({
    type: "transaction",
    transaction: expense,
  });
  fireEvent.change(screen.getByLabelText("Expense date scope"), {
    target: { value: "all" },
  });
  expect(screen.getByText("Old bill")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search expenses"), {
    target: { value: "Old" },
  });
  expect(screen.queryByText("Electric bill")).not.toBeInTheDocument();
  expect(screen.getByText("Old bill")).toBeInTheDocument();
});

test("creation stays unified and the reporting month controls recorded analysis", () => {
  const onMonth = vi.fn();
  render(<ExpensesView {...props} onMonth={onMonth} />);
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  expect(props.onAdd).toHaveBeenCalledWith({
    type: "transaction",
    kind: "expense",
  });
  expect(screen.getAllByLabelText("Reporting month")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Next week" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Reporting month"), {
    target: { value: "2026-10" },
  });
  expect(onMonth).toHaveBeenCalledWith("2026-10");
});

test("cost history loads on expansion rather than becoming another navigation view", async () => {
  const { container } = render(<ExpensesView {...props} />);
  expect(api).not.toHaveBeenCalledWith(
    expect.stringMatching(/^\/expense-costs/),
  );
  fireEvent.click(container.querySelector(".expense-costs > summary")!);
  expect(
    await screen.findByText(
      "No recorded payments yet. History appears when you record an expense.",
    ),
  ).toBeInTheDocument();
});
