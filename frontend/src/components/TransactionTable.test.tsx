import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TransactionTable } from "./TransactionTable";
import type { Transaction } from "../lib/types";

const buy: Transaction = {
  id: 1,
  date: "2026-11-14",
  kind: "transfer",
  description: "Bitcoin buy",
  notes: "Exchange receipt saved",
  account_id: 1,
  account: "Checking",
  currency: "USD",
  amount: "100.99",
  destination_id: 2,
  destination_amount: "123456",
  destination_currency: "BITCOIN",
  destination_account: "Cold wallet",
  category_id: null,
  category: "Transfer",
  bitcoin: "999999",
  usd: "100.99",
  rate_snapshot: "100000",
  actual_exchange_price: "81801.29",
  valuation_basis: "historical purchasing power",
};
const expense: Transaction = {
  ...buy,
  id: 2,
  kind: "expense",
  description: "Groceries",
  notes: "Farmers market",
  amount: "12.00",
  destination_id: null,
  destination_amount: null,
  destination_currency: null,
  destination_account: null,
  category_id: 5,
  category: "Food",
  bitcoin: "10000",
  usd: "12.00",
  rate_snapshot: "120000",
  actual_exchange_price: null,
  purchase_cost: {
    usd: "12.00",
    bitcoin: "10000",
    usd_per_btc: "120000",
    source: "Manual",
    method: "manual",
    observed_at: "2026-11-14",
  },
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

test("journal uses actual BIP-177 bitcoin per dollar rather than the rounded USD price or reference rate", () => {
  render(<TransactionTable rows={[buy]} />);
  expect(
    screen.getByRole("columnheader", { name: "Conversion / ₿ per dollar" }),
  ).toBeInTheDocument();
  expect(screen.getByText("₿1,222.46 / $1")).toBeInTheDocument();
  expect(screen.getByText("actual exchange")).toBeInTheDocument();
  expect(screen.queryByText("$81,801.29")).not.toBeInTheDocument();
});

test("clicking an amount opens its read-only summary, closing then clicking another row shows that row", () => {
  render(<TransactionTable rows={[buy, expense]} />);
  fireEvent.click(screen.getByText("$100.99"));
  const dialog = screen.getByRole("dialog", { name: "Bitcoin buy" });
  const details = within(dialog).getByRole("region", {
    name: "Transaction details",
  });
  for (const value of [
    "$100.99",
    "₿123,456",
    "₿1,222.46 / $1",
    "Checking",
    "Cold wallet",
    "2026-11-14",
  ]) {
    expect(within(details).getByText(value)).toBeInTheDocument();
  }
  expect(
    within(dialog).getByText("Exchange receipt saved"),
  ).toBeInTheDocument();
  expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: /Confirm|Record/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Close" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "View Groceries transaction" }),
  );
  const groceries = screen.getByRole("dialog", { name: "Groceries" });
  expect(within(groceries).getByText("Food")).toBeInTheDocument();
  expect(within(groceries).getByText("Farmers market")).toBeInTheDocument();
  expect(within(groceries).getByText("₿833.33 / $1")).toBeInTheDocument();
  expect(within(groceries).getByText("₿10,000")).toBeInTheDocument();
  expect(
    within(groceries).getByText(/saved purchase-date reference/),
  ).toBeInTheDocument();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: false }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("compact rows expose summaries through a keyboard-accessible title button", () => {
  render(<TransactionTable rows={[buy]} compact />);
  const title = screen.getByRole("button", {
    name: "View Bitcoin buy transaction",
  });
  title.focus();
  expect(title).toHaveFocus();
  fireEvent.click(title);
  expect(
    screen.getByRole("dialog", { name: "Bitcoin buy" }),
  ).toBeInTheDocument();
});

test("Edit, Repeat and Reverse do not also open the summary", () => {
  const onEdit = vi.fn(),
    onDelete = vi.fn(),
    onRepeat = vi.fn();
  render(
    <TransactionTable
      rows={[expense]}
      onEdit={onEdit}
      onDelete={onDelete}
      onRepeat={onRepeat}
    />,
  );
  for (const action of ["Edit", "Repeat", "Reverse"])
    fireEvent.click(
      screen.getByRole("button", { name: `${action} Groceries` }),
    );
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(expense);
  expect(onRepeat).toHaveBeenCalledExactlyOnceWith(expense);
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(expense);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("bitcoin-to-dollar transfers calculate the same rate from the actual legs", () => {
  render(
    <TransactionTable
      rows={[
        {
          ...buy,
          currency: "BITCOIN",
          amount: "123456",
          destination_currency: "USD",
          destination_amount: "100.99",
        },
      ]}
    />,
  );
  expect(screen.getByText("₿1,222.46 / $1")).toBeInTheDocument();
});

test("same-currency transfers and missing references do not invent exchange rates", () => {
  render(
    <TransactionTable
      rows={[
        { ...buy, destination_currency: "USD", destination_amount: "100.99" },
        { ...expense, purchase_cost: null, rate_snapshot: null, bitcoin: null },
      ]}
    />,
  );
  expect(screen.getByText("Same-currency transfer")).toBeInTheDocument();
  expect(
    screen.getByText("Purchase-date reference pending"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/₿.*\/ \$1/)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "View Groceries transaction" }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Unavailable"),
  ).toBeInTheDocument();
});

test("current income estimates remain labeled as estimates in both journal and summary", () => {
  render(
    <TransactionTable
      rows={[
        {
          ...expense,
          kind: "income",
          description: "Salary",
          purchase_cost: null,
          conversion_basis: "current_estimate",
          conversion_rate: "100000.12345678",
        },
      ]}
    />,
  );
  expect(screen.getByText("≈ ₿1,000.00 / $1")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "View Salary transaction" }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("≈ ₿1,000.00 / $1"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("dialog")).getByText(/current quote estimate/),
  ).toBeInTheDocument();
});
