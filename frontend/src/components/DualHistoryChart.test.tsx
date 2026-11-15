import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { DualHistoryChart } from "./DualHistoryChart";

test("empty history and missing conversions have distinct states", () => {
  const { rerender } = render(
    <DualHistoryChart history={[]} title="Expenses" />,
  );
  expect(screen.getByText("No history recorded")).toBeInTheDocument();
  rerender(
    <DualHistoryChart
      history={[{ month: "2026-01", USD: null, BITCOIN: null }]}
      title="Expenses"
    />,
  );
  expect(screen.getByText("Conversions unavailable")).toBeInTheDocument();
  expect(screen.queryByText("No history recorded")).not.toBeInTheDocument();
});
