import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Money } from "./Money";
import { formatChartTick } from "./Charts";
import { formatMoney } from "../lib/money";
import { TransactionTable } from "./TransactionTable";
import type { Transaction } from "../lib/types";

test("native bitcoin labels are unambiguous and preserve integers beyond JS safe range", () => {
  render(<Money value="9223372036854775807" />);
  expect(screen.getByText("₿9,223,372,036,854,775,807")).toBeInTheDocument();
  expect(screen.queryByText("bitcoin")).not.toBeInTheDocument();
  expect(
    screen.getByLabelText("9223372036854775807 bitcoin"),
  ).toBeInTheDocument();
});
test("legacy BTC and dollars have distinct exact formats", () => {
  expect(formatMoney("0.00125", "BTC")).toBe("0.00125000");
  expect(formatMoney("120000.12", "USD")).toBe("$120,000.12");
  expect(formatMoney("-17.01", "USD")).toBe("−$17.01");
});
test("missing conversion is unavailable, never zero", () => {
  render(<Money value={null} />);
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("bitcoin")).not.toBeInTheDocument();
});
test("transaction displays original amount and historical equivalent separately", () => {
  const transaction: Transaction = {
    id: 1,
    date: "2026-06-01",
    kind: "expense",
    description: "Groceries",
    notes: "",
    account_id: 1,
    account: "Checking",
    currency: "USD",
    amount: "12.00",
    destination_id: null,
    destination_amount: null,
    destination_currency: null,
    destination_account: null,
    usd: "12.00",
    category_id: 1,
    category: "Food",
    bitcoin: "10000",
    rate_snapshot: "120000",
    purchase_cost: {
      usd: "12.00",
      bitcoin: "10000",
      usd_per_btc: "120000",
      source: "Manual",
      method: "manual",
      observed_at: "2026-06-01",
    },
    valuation_basis: "historical purchasing power",
  };
  render(<TransactionTable rows={[transaction]} />);
  expect(screen.getByText("$12.00")).toBeInTheDocument();
  expect(screen.getByText("₿10,000")).toBeInTheDocument();
  expect(
    screen.getByText("saved purchase-date equivalent"),
  ).toBeInTheDocument();
});

test("chart scale distinguishes fractional millions and thousands", () => {
  expect(formatChartTick(1500000)).toBe("1.5m");
  expect(formatChartTick(2000000)).toBe("2m");
  expect(formatChartTick(1500)).toBe("1.5k");
  expect(formatChartTick(-1500000)).toBe("-1.5m");
});

test("bitcoin uses a prefix symbol while legacy BTC remains explicit", () => {
  expect(formatMoney("-125000", "BITCOIN")).toBe("−₿125,000");
  expect(formatMoney("0", "BITCOIN")).toBe("₿0");
  render(<Money value="0.00125" unit="BTC" />);
  expect(screen.getByText("BTC")).toBeInTheDocument();
  expect(screen.getByText("0.00125000")).toBeInTheDocument();
  expect(screen.queryByText(/₿/)).not.toBeInTheDocument();
});
