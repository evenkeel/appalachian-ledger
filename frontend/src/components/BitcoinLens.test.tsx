import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { BitcoinLens, expenseIndex, isCompleteMonth } from "./BitcoinLens";
import type { History, Report } from "../lib/types";

const month = (
  key: string,
  date: string,
  usd: string,
  bitcoin: string,
  held: string,
) =>
  ({
    month: key,
    date,
    bitcoin_held: held,
    dual: {
      USD: { expenses: usd, income: "0", categories: [] },
      BITCOIN: { expenses: bitcoin, income: "0", categories: [] },
    },
  }) as unknown as History;

const history = [
  month("2026-06", "2026-06-30", "1000.00", "1000000", "5000000"),
  month("2026-07", "2026-07-31", "1050.00", "900000", "5400000"),
  // Partial current month: left out of the comparison.
  month("2026-08", "2026-08-15", "300.00", "200000", "5600000"),
];

test("only complete months are compared, indexed to the first", () => {
  expect(history.map(isCompleteMonth)).toEqual([true, true, false]);
  const points = expenseIndex(history);
  expect(points).toHaveLength(2);
  expect(points[1].bitcoinIndex).toBeCloseTo(90);
  expect(points[1].usdIndex).toBeCloseTo(105);
});

test("headline says expenses cost less bitcoin and more dollars", () => {
  render(
    <BitcoinLens
      report={
        {
          month: "2026-08",
          history,
          ownership: { bitcoin_held: "5600000" },
          stacked: {
            bitcoin: "200000",
            usd: "200.00",
            other_usd: "0.00",
            stack_rate: "10.0",
          },
        } as unknown as Report
      }
    />,
  );
  expect(screen.getByText("10% less bitcoin")).toBeInTheDocument();
  expect(screen.getByText(/5% more dollars/)).toBeInTheDocument();
  expect(screen.getByText("₿5,600,000")).toBeInTheDocument();
  expect(screen.getByText("+₿200,000")).toBeInTheDocument();
});
