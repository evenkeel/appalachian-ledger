import { beforeAll, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SpendingAnalysis } from "./SpendingAnalysis";
import {
  analysisExpenses,
  expense,
  expenseAccounts,
  expenseCategories,
} from "../test/expenseFixtures";

// Give Recharts a deterministic layout while retaining its real chart / map rendering.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 280,
    top: 0,
    left: 0,
    bottom: 280,
    right: 800,
    x: 0,
    y: 0,
    toJSON() {},
  });
});
const props = {
  month: "2026-11",
  accounts: expenseAccounts,
  categories: expenseCategories,
  transactions: analysisExpenses,
  now: new Date(2026, 10, 7, 12),
  onAdd: vi.fn(),
};

test("opens in dollars with pace, bridge and trends, and a collapsed calendar", () => {
  render(<SpendingAnalysis {...props} />);
  expect(screen.getByRole("button", { name: "Dollars" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("heading", { name: "Spending Pace" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("$5.00 less spent through November 7"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Spending Bridge" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Trends" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByText("When You Spent").closest("details"),
  ).not.toHaveAttribute("open");
  expect(screen.getByText("Daily figures")).toBeInTheDocument();
  const pace = screen.getByRole("region", { name: "Spending Pace" });
  expect(
    within(pace).getByText("$140.00", { selector: "strong" }),
  ).toBeInTheDocument();
  expect(within(pace).getByText("November so far")).toBeInTheDocument();
  expect(within(pace).getByText(/October ·/)).toBeInTheDocument();
  expect(within(pace).queryByText("Selected period")).not.toBeInTheDocument();
  expect(
    pace.querySelector(".recharts-cartesian-grid"),
  ).not.toBeInTheDocument();
});

test("bridge opens both periods' category transactions with edit and repeat actions", () => {
  render(<SpendingAnalysis {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Dining −$45.00" }));
  const detail = screen.getByRole("region", { name: "Analysis transactions" });
  expect(within(detail).getByText("Lunch")).toBeInTheDocument();
  expect(within(detail).getByText("Previous lunch")).toBeInTheDocument();
  expect(
    within(detail).queryByText("Market groceries"),
  ).not.toBeInTheDocument();
  fireEvent.click(within(detail).getByRole("button", { name: "Repeat Lunch" }));
  expect(props.onAdd).toHaveBeenLastCalledWith({
    type: "transaction",
    kind: "expense",
    repeat: analysisExpenses[2],
  });
  fireEvent.click(within(detail).getByRole("button", { name: "Edit Lunch" }));
  expect(props.onAdd).toHaveBeenLastCalledWith({
    type: "transaction",
    transaction: analysisExpenses[2],
  });
});

test("shared filters reset details and unit toggle uses immutable equivalents", () => {
  render(<SpendingAnalysis {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Dining −$45.00" }));
  fireEvent.change(screen.getByLabelText("Analysis category"), {
    target: { value: "1" },
  });
  expect(
    screen.queryByRole("region", { name: "Analysis transactions" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("$40.00 more spent through November 7"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Bitcoin" }));
  expect(
    screen.getByText("Same recorded spending as last month"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Analysis account"), {
    target: { value: "2" },
  });
  expect(
    screen.getAllByText(
      "No recorded expenses match these filters. An empty recorded month does not establish that no spending occurred.",
    ),
  ).toHaveLength(1);
});

test("map blocks support keyboard selection and share labels", () => {
  render(<SpendingAnalysis {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Map" }));
  const block = screen.getByRole("button", {
    name: "Groceries: $120.00, 85.7%",
  });
  fireEvent.keyDown(block, { key: "Enter" });
  const detail = screen.getByRole("region", { name: "Analysis transactions" });
  expect(within(detail).getByText("Market groceries")).toBeInTheDocument();
  expect(
    within(detail).queryByText("Previous groceries"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(detail).getByRole("button", { name: "Close details" }),
  );
  fireEvent.keyDown(block, { key: " " });
  expect(
    screen.getByRole("region", { name: "Analysis transactions" }),
  ).toBeInTheDocument();
});

test("calendar selection limits details to the day; future dates are disabled", () => {
  render(<SpendingAnalysis {...props} />);
  fireEvent.click(screen.getByText("When You Spent"));
  const calendar = screen.getByRole("group", {
    name: "Daily spending calendar",
  });
  fireEvent.click(
    within(calendar).getByRole("button", {
      name: "November 5: $120.00, 1 recorded expenses",
    }),
  );
  const detail = screen.getByRole("region", { name: "Analysis transactions" });
  expect(within(detail).getByText("Market groceries")).toBeInTheDocument();
  expect(within(detail).queryByText("Lunch")).not.toBeInTheDocument();
  expect(
    within(calendar).getByRole("button", { name: "November 8: Not elapsed" }),
  ).toBeDisabled();
});

test("new transaction props refresh calculations and reporting month resets selection", () => {
  const { rerender } = render(<SpendingAnalysis {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Dining −$45.00" }));
  rerender(
    <SpendingAnalysis
      {...props}
      transactions={[expense({ amount: "200.00" })]}
    />,
  );
  expect(
    screen.getByText("$200.00 more spent through November 7"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Analysis transactions" }),
  ).toBeInTheDocument();
  rerender(<SpendingAnalysis {...props} month="2026-12" />);
  expect(
    screen.queryByRole("region", { name: "Analysis transactions" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "Analysis is available for the current month and earlier recorded months.",
    ),
  ).toBeInTheDocument();
});

test("missing conversions disable misleading comparisons but allow inspecting native transactions", () => {
  render(
    <SpendingAnalysis
      {...props}
      transactions={[
        expense({ currency: "BITCOIN", amount: "10000", purchase_cost: null }),
      ]}
    />,
  );
  expect(screen.getByText("Comparison unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Map" }));
  expect(
    screen.getByText(
      "Complete purchase-date references to compare category shares. Exact amounts and transaction details remain available below.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Groceries Unavailable · 1 missing reference Unavailable",
    }),
  );
  expect(
    within(
      screen.getByRole("region", { name: "Analysis transactions" }),
    ).getByText("Weekly groceries"),
  ).toBeInTheDocument();
});

test("compact history preserves every category and conversion details remain available", () => {
  render(<SpendingAnalysis {...props} />);
  fireEvent.click(screen.getByText("Category figures and six-month history"));
  fireEvent.change(screen.getByLabelText("History category"), {
    target: { value: "1" },
  });
  const history = screen.getByRole("table", {
    name: "Groceries: six-month spending history",
  });
  expect(within(history).getAllByRole("columnheader")).toHaveLength(3);
  expect(within(history).getAllByRole("row")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Dining −$45.00" }));
  const detail = screen.getByRole("region", { name: "Analysis transactions" });
  expect(
    within(detail).queryByRole("columnheader", {
      name: "Conversion / ₿ per dollar",
    }),
  ).not.toBeInTheDocument();
  expect(
    within(detail).getByRole("columnheader", { name: "Category" }),
  ).toBeInTheDocument();
  fireEvent.click(
    within(detail).getByRole("button", { name: "Show conversions" }),
  );
  expect(
    within(detail).getByRole("columnheader", {
      name: "Conversion / ₿ per dollar",
    }),
  ).toBeInTheDocument();
});

test("encourages a full month of tracking when the previous calendar month has no records", () => {
  const { rerender } = render(
    <SpendingAnalysis
      {...props}
      transactions={[expense({ amount: "200.00" })]}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Track expenses for a full calendar month",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "No expenses are recorded for Oct 2026 yet.",
  );
  rerender(<SpendingAnalysis {...props} />);
  expect(screen.queryByText("Building Your Baseline")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Analysis account"), {
    target: { value: "2" },
  });
  expect(screen.queryByText("Building Your Baseline")).not.toBeInTheDocument();
});

test("follows the workspace lens, permits a local override, and resets it when the lens changes", () => {
  const { rerender } = render(
    <SpendingAnalysis {...props} monetaryLens="BITCOIN" />,
  );
  const bitcoin = () => screen.getByRole("button", { name: "Bitcoin" });
  const dollars = () => screen.getByRole("button", { name: "Dollars" });
  expect(bitcoin()).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(dollars());
  expect(dollars()).toHaveAttribute("aria-pressed", "true");
  rerender(<SpendingAnalysis {...props} monetaryLens="USD" />);
  expect(dollars()).toHaveAttribute("aria-pressed", "true");
  rerender(<SpendingAnalysis {...props} monetaryLens="BITCOIN" />);
  expect(bitcoin()).toHaveAttribute("aria-pressed", "true");
});
