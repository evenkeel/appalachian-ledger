import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PlannedExpensesCalendar } from "./PlannedExpensesCalendar";
import type { RecurringBill } from "../lib/types";
const bill: RecurringBill = {
  id: 1,
  account_id: 1,
  category_id: 1,
  description: "Insurance",
  notes: "",
  amount: "100.00",
  frequency: "monthly",
  next_due: "2026-11-10",
  account: "Checking",
  category: "Insurance",
  currency: "USD",
  account_archived: false,
};
const props = {
  bills: [
    bill,
    {
      ...bill,
      id: 2,
      amount: "400.00",
      description: "Rent",
      next_due: "2026-11-12",
    },
  ],
  loading: false,
  error: "",
  onRetry: vi.fn(),
  onRecord: vi.fn(),
  onEdit: vi.fn(),
  onRemove: vi.fn(),
  onHistory: vi.fn(),
  day: "2026-11-10",
};

test("weekly dots show bill names and open only the chosen day's expenses", () => {
  const { container } = render(<PlannedExpensesCalendar {...props} />);
  expect(screen.getByText("Rent")).toBeInTheDocument();
  expect(screen.getByText("Insurance")).toBeInTheDocument();
  expect(container.querySelectorAll(".planned-bubble")).toHaveLength(2);
  expect(
    within(
      screen.getByRole("group", { name: "Planned expense dates" }),
    ).getAllByRole("button"),
  ).toHaveLength(7);
  expect(
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
      (name) => screen.getByText(name).textContent,
    ),
  ).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  const emptyDay = screen.getByRole("button", {
    name: "November 9, 2026: 0 planned expenses",
  });
  expect(emptyDay.querySelector(".planned-empty-dot")).toBeInTheDocument();
  expect(emptyDay.querySelector(".planned-bubble")).not.toBeInTheDocument();
  fireEvent.click(emptyDay);
  expect(
    screen.getByRole("dialog", { name: "Upcoming expense details" }),
  ).toHaveTextContent("No unpaid expenses remain for this day.");
  const small = screen.getByRole("button", {
    name: "November 10, 2026: 1 planned expense, $100.00",
  });
  const large = screen.getByRole("button", {
    name: "November 12, 2026: 1 planned expense, $400.00",
  });
  expect(
    parseFloat(
      large.querySelector<HTMLElement>(".planned-bubble")!.style.width,
    ) /
      parseFloat(
        small.querySelector<HTMLElement>(".planned-bubble")!.style.width,
      ),
  ).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  fireEvent.click(small);
  const detail = screen.getByRole("dialog", {
    name: "Upcoming expense details",
  });
  expect(within(detail).getByText("Insurance")).toBeInTheDocument();
  expect(within(detail).queryByText("Rent")).not.toBeInTheDocument();
  fireEvent.click(
    within(detail).getByRole("button", { name: "Mark Insurance paid" }),
  );
  expect(props.onRecord).toHaveBeenCalledWith(bill);
});

test("mixed currencies stay separate and other-currency days stay discoverable", () => {
  render(
    <PlannedExpensesCalendar
      {...props}
      bills={[
        bill,
        {
          ...bill,
          id: 3,
          currency: "BITCOIN",
          amount: "10000",
          description: "Wallet payment",
          next_due: "2026-11-12",
          account_archived: true,
        },
      ]}
    />,
  );
  const day = screen.getByRole("button", {
    name: "November 12, 2026: 1 planned expense, ₿10,000",
  });
  expect(day.querySelector(".planned-other-unit")).toBeInTheDocument();
  fireEvent.click(day);
  expect(
    within(
      screen.getByRole("dialog", { name: "Upcoming expense details" }),
    ).getByRole("button", { name: "Mark Wallet payment paid" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Bitcoin" }));
  expect(day.querySelector(".planned-bubble")).toBeInTheDocument();
  expect(screen.getAllByText("₿10,000").length).toBeGreaterThan(0);
});

test("overdue plans outside this month remain accessible and moving months clears details", () => {
  render(
    <PlannedExpensesCalendar
      {...props}
      bills={[
        ...props.bills,
        { ...bill, id: 4, next_due: "2026-10-01", description: "Late payment" },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "1 overdue" }));
  expect(screen.getByText("Late payment")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  expect(screen.getByText("Nov 15 – Nov 21, 2026")).toBeInTheDocument();
  expect(
    screen.queryByRole("dialog", { name: "Upcoming expense details" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("No upcoming expenses this week."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "This week" }));
  expect(screen.getByText("Nov 8 – Nov 14, 2026")).toBeInTheDocument();
});

test("loading and failed fetches do not masquerade as an empty calendar", () => {
  const { rerender } = render(<PlannedExpensesCalendar {...props} loading />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading planned expenses",
  );
  rerender(
    <PlannedExpensesCalendar {...props} error="Connection interrupted" />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Connection interrupted");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(props.onRetry).toHaveBeenCalled();
  expect(
    screen.queryByText("No upcoming expenses this week."),
  ).not.toBeInTheDocument();
});

test("a leap-day week includes adjoining months and supports modal dismissal", () => {
  render(<PlannedExpensesCalendar {...props} bills={[]} day="2024-02-29" />);
  const dates = screen.getByRole("group", { name: "Planned expense dates" });
  expect(within(dates).getAllByRole("button")).toHaveLength(7);
  expect(dates.querySelectorAll(".planned-empty-dot")).toHaveLength(7);
  expect(
    screen.getByRole("button", {
      name: "February 29, 2024: 0 planned expenses",
    }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "February 29, 2024: 0 planned expenses",
    }),
  );
  fireEvent(
    screen.getByRole("dialog", { name: "Upcoming expense details" }),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "March 2, 2024: 0 planned expenses" }),
  ).toBeInTheDocument();
});

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

test("an overdue bill stays named in its week and all planned bills exposes later schedules", () => {
  const openai = {
    ...bill,
    id: 6,
    description: "OpenAI",
    next_due: "2026-11-09",
    amount: "21.00",
  };
  const later = {
    ...bill,
    id: 7,
    description: "Next month insurance",
    next_due: "2026-12-02",
  };
  render(
    <PlannedExpensesCalendar
      {...props}
      day="2026-11-11"
      bills={[openai, later]}
    />,
  );
  expect(
    screen.getByRole("group", { name: "Planned expense dates" }),
  ).toBeInTheDocument();
  const week = screen.getByLabelText("Bills this week");
  expect(week).toHaveTextContent("OpenAI");
  expect(week).toHaveTextContent("$21.00");
  expect(week).toHaveTextContent("Overdue");
  fireEvent.click(
    screen.getByRole("button", { name: "View OpenAI due November 9, 2026" }),
  );
  const day = screen.getByRole("dialog", { name: "Upcoming expense details" });
  expect(day).toHaveTextContent("November 9, 2026");
  expect(
    within(day).getByRole("button", { name: "Mark OpenAI paid" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  fireEvent.click(
    screen.getByRole("button", { name: "All planned bills (2)" }),
  );
  const all = screen.getByRole("dialog", { name: "Upcoming expense details" });
  expect(all).toHaveTextContent("OpenAI");
  expect(all).toHaveTextContent("Next month insurance");
  expect(all).toHaveTextContent("December 2, 2026");
  expect(props.onRecord).not.toHaveBeenCalled();
});
