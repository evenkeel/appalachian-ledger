import { beforeEach, expect, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { RecurringBills } from "./RecurringBills";
import { today } from "./EntryDialog";
import { api } from "../lib/api";
import type { RecurringBill } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const bill: RecurringBill = {
  id: 1,
  account_id: 2,
  category_id: 3,
  description: "Internet",
  notes: "",
  amount: "60.00",
  frequency: "monthly",
  next_due: "2026-01-31",
  account: "Checking",
  category: "Utilities",
  currency: "USD",
  account_archived: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (_path, method = "GET") =>
    method === "GET" ? [bill] : { entry_id: 9 },
  );
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});

test("a saved bill is recorded in two clicks with no fields to fill", async () => {
  const saved = vi.fn();
  render(<RecurringBills revision={0} onAdd={vi.fn()} onSaved={saved} />);
  fireEvent.click(await screen.findByRole("button", { name: "Record" }));
  expect(screen.getByLabelText("Payment date")).toHaveValue(bill.next_due);
  expect(screen.getByLabelText("Payment amount · USD")).toHaveValue("60.00");
  fireEvent.click(screen.getByRole("button", { name: "Confirm payment" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith("Internet recorded."));
  expect(api).toHaveBeenCalledWith("/recurring-bills/1/record", "POST", {
    due_date: "2026-01-31",
    date: bill.next_due,
    amount: "60.00",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("failed payments keep entered values and retry the same occurrence", async () => {
  const saved = vi.fn();
  render(<RecurringBills revision={0} onAdd={vi.fn()} onSaved={saved} />);
  fireEvent.click(await screen.findByRole("button", { name: "Record" }));
  fireEvent.change(screen.getByLabelText("Payment amount · USD"), {
    target: { value: "64.17" },
  });
  vi.mocked(api).mockRejectedValueOnce(new Error("Connection interrupted"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm payment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Connection interrupted",
  );
  expect(screen.getByLabelText("Payment amount · USD")).toHaveValue("64.17");
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm payment" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenLastCalledWith("/recurring-bills/1/record", "POST", {
    due_date: bill.next_due,
    date: bill.next_due,
    amount: "64.17",
  });
});

test("archived accounts cannot be used and bill setup opens without posting", async () => {
  vi.mocked(api).mockResolvedValue([{ ...bill, account_archived: true }]);
  const add = vi.fn();
  render(<RecurringBills revision={0} onAdd={add} onSaved={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Record" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  expect(add).toHaveBeenCalledWith({
    type: "transaction",
    kind: "expense",
    recurring: true,
    oneTime: true,
  });
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([, method]) => method && method !== "GET"),
  ).toEqual([["/recurring-bills/reconcile", "POST"]]);
});

test("overview separates overdue from upcoming and filters later planned expenses", async () => {
  const day = today();
  vi.mocked(api).mockResolvedValue([
    { ...bill, id: 1, description: "Overdue power", next_due: "2020-01-01" },
    {
      ...bill,
      id: 2,
      description: "Due today internet",
      next_due: day,
      amount: "40.00",
    },
    {
      ...bill,
      id: 3,
      description: "Later repair",
      next_due: "2099-01-01",
      frequency: "once",
    },
  ]);
  const add = vi.fn();
  render(
    <RecurringBills overview revision={0} onAdd={add} onSaved={vi.fn()} />,
  );
  expect(await screen.findByText("Overdue power")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Upcoming Expenses" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Overdue · 1")).toBeInTheDocument();
  expect(screen.getByText("Next 30 days · 1")).toBeInTheDocument();
  expect(screen.queryByText("Later repair")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Upcoming time range"), {
    target: { value: "all" },
  });
  expect(screen.getByText("Later repair")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  expect(add).toHaveBeenCalledWith({
    type: "transaction",
    kind: "expense",
    recurring: true,
    oneTime: true,
  });
});

test("compact overview links to expenses without showing individual bill cards or actions", async () => {
  vi.mocked(api).mockResolvedValue([
    {
      ...bill,
      description: "Due internet",
      next_due: today(),
      amount: "40.00",
    },
    {
      ...bill,
      id: 2,
      description: "Overdue power",
      next_due: "2020-01-01",
      amount: "60.00",
    },
    { ...bill, id: 3, description: "Later repair", next_due: "2099-01-01" },
  ]);
  const open = vi.fn();
  render(
    <RecurringBills
      compact
      revision={0}
      onOpen={open}
      onAdd={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  const summary = await screen.findByRole("button", { name: /1 upcoming/ });
  expect(summary).toHaveTextContent("$40.00 due in the next 7 days");
  expect(summary).toHaveTextContent("1 overdue");
  expect(summary).toHaveTextContent("$60.00");
  expect(screen.queryByText("Due internet")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Record" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add expense" }),
  ).not.toBeInTheDocument();
  fireEvent.click(summary);
  expect(open).toHaveBeenCalledOnce();
});

test("calendar investigation retains the real payment confirmation flow", async () => {
  const due = today();
  vi.mocked(api).mockImplementation(async (_path, method = "GET") =>
    method === "GET" ? [{ ...bill, next_due: due }] : { entry_id: 9 },
  );
  const saved = vi.fn();
  render(
    <RecurringBills calendar revision={0} onAdd={vi.fn()} onSaved={saved} />,
  );
  expect(screen.queryByText("Internet")).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", { name: /1 planned expense, \$60\.00$/ }),
  );
  fireEvent.click(
    within(
      screen.getByRole("dialog", { name: "Upcoming expense details" }),
    ).getByRole("button", { name: "Mark Internet paid" }),
  );
  expect(screen.getByLabelText("Payment date")).toHaveValue(due);
  fireEvent.click(screen.getByRole("button", { name: "Confirm payment" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith("Internet recorded."));
  expect(api).toHaveBeenCalledWith("/recurring-bills/1/record", "POST", {
    due_date: due,
    date: due,
    amount: "60.00",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("mark paid allows a variable amount and date before posting", async () => {
  vi.mocked(api).mockImplementation(async (_path, method = "GET") =>
    method === "GET"
      ? [
          {
            ...bill,
            next_due: today(),
            description: "Power bill",
            amount: "100.00",
          },
        ]
      : { matched: 0, entry_id: 99 },
  );
  const saved = vi.fn();
  render(
    <RecurringBills calendar revision={0} onAdd={vi.fn()} onSaved={saved} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Mark Power bill paid" }),
  );
  expect(screen.getByLabelText("Payment amount · USD")).toHaveValue("100.00");
  fireEvent.change(screen.getByLabelText("Payment amount · USD"), {
    target: { value: "112.37" },
  });
  expect(
    vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/record")),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm payment" }));
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith("Power bill recorded."),
  );
  expect(api).toHaveBeenCalledWith("/recurring-bills/1/record", "POST", {
    due_date: today(),
    date: today(),
    amount: "112.37",
  });
});

test("automatic matching happens before bills are loaded and reports that no expense was created", async () => {
  vi.mocked(api).mockImplementation(async (_path, method = "GET") =>
    method === "POST" ? { matched: 1 } : [],
  );
  render(
    <RecurringBills calendar revision={0} onAdd={vi.fn()} onSaved={vi.fn()} />,
  );
  expect(
    await screen.findByText(/No new expenses created/),
  ).toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.slice(0, 2)).toEqual([
    ["/recurring-bills/reconcile", "POST"],
    ["/recurring-bills"],
  ]);
});

test("compact dots cover exactly seven days and grow with expense count rather than amount", async () => {
  vi.mocked(api).mockResolvedValue([
    { ...bill, id: 1, next_due: today(), amount: "9000.00" },
    { ...bill, id: 2, next_due: today(1), amount: "1.00" },
    { ...bill, id: 3, next_due: today(1), amount: "2.00" },
    { ...bill, id: 4, next_due: today(6), amount: "5.00" },
    { ...bill, id: 5, next_due: today(7), amount: "80.00" },
    { ...bill, id: 6, next_due: today(-1), amount: "20.00" },
  ]);
  render(
    <RecurringBills
      compact
      revision={0}
      onOpen={vi.fn()}
      onAdd={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  const week = within(
    await screen.findByRole("group", {
      name: "Expenses due over the next seven days",
    }),
  );
  expect(week.getAllByRole("img")).toHaveLength(7);
  const one = week.getByRole("img", { name: `${today()}: 1 expense due` });
  const two = week.getByRole("img", { name: `${today(1)}: 2 expenses due` });
  const zero = week.getByRole("img", { name: `${today(2)}: 0 expenses due` });
  const diameter = (element: HTMLElement) =>
    parseFloat(
      (element.querySelector(".upcoming-day-dot") as HTMLElement).style.width,
    );
  expect(diameter(two)).toBeGreaterThan(diameter(one));
  expect(diameter(one)).toBeGreaterThan(diameter(zero));
  expect(
    week.queryByRole("img", { name: new RegExp(today(7)) }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /4 upcoming/ })).toHaveTextContent(
    "$9,008.00",
  );
});
