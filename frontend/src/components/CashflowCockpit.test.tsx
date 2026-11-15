import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashflowCockpit, LifestyleGauge } from "./CashflowCockpit";
import type { Report } from "../lib/types";

function report(income: string | null, expenses: string | null): Report {
  return {
    month: "2026-01",
    dual: {
      USD: {
        income,
        expenses,
        spending: {
          fixed: "60",
          essential: "20",
          discretionary: "20",
          unclassified: "0",
        },
      },
    },
  } as Report;
}

test("spending above income remains visible beyond the needle scale", () => {
  render(<LifestyleGauge ratio={153.2} />);
  expect(screen.getByRole("img")).toHaveAccessibleName(
    "Spending Pressure: 153.2% of income spent",
  );
  expect(screen.getByText("153.2%")).toBeInTheDocument();
});

test("spending pressure uses both-currency USD totals; stacking replaces dollar savings", () => {
  render(
    <CashflowCockpit
      report={{
        ...report("80", "100"),
        stacked: {
          bitcoin: "250000",
          usd: "20.00",
          other_usd: "0.00",
          stack_rate: "25.0",
        },
      }}
      categories={[]}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByText("125.0%")).toBeInTheDocument();
  expect(screen.getByText("Bitcoin stacked")).toBeInTheDocument();
  expect(screen.getByText("₿250,000")).toBeInTheDocument();
  expect(screen.getByText("25.0%")).toBeInTheDocument();
  expect(screen.queryByText(/Savings rate|Cash surplus/)).toBeNull();
  expect(screen.queryByText("Spending Mix")).not.toBeInTheDocument();
});

test.each(["0", null])(
  "zero or missing income produces no misleading percentage: %s",
  (income) => {
    render(
      <CashflowCockpit
        report={report(income, "100")}
        categories={[]}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "Spending Pressure: reading unavailable",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
  },
);

test("missing expense conversions suppress the heat reading", () => {
  render(
    <CashflowCockpit
      report={report("100", null)}
      categories={[]}
      onSaved={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("img", { name: "Spending Pressure: reading unavailable" }),
  ).toBeInTheDocument();
});

test("burn rate excludes the partial current month and annualizes complete months", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 1, 15));
  try {
    const data = report("100", "10");
    data.month = "2026-02";
    data.history = [
      { month: "2025-12", dual: { USD: { expenses: "100" } } },
      { month: "2026-01", dual: { USD: { expenses: "200" } } },
      { month: "2026-02", dual: { USD: { expenses: "10" } } },
    ] as Report["history"];
    render(<CashflowCockpit report={data} categories={[]} onSaved={vi.fn()} />);
    expect(screen.getByText("$150.00")).toBeInTheDocument();
    expect(screen.getByText("$1,800.00")).toBeInTheDocument();
    expect(screen.getByText(/2 completed months/)).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  [59.9, "#84b69d", "Controlled"],
  [60, "#d4b558", "Elevated"],
  [80, "#e89a4b", "High"],
  [100, "#e46861", "Critical"],
  [120, "#e46861", "Critical"],
])("spending pressure at %s uses the matching band", (ratio, color, status) => {
  render(<LifestyleGauge ratio={ratio} />);
  expect(screen.getByText(status)).toHaveAttribute("fill", color);
  expect(screen.getByText(`${ratio.toFixed(1)}%`)).toHaveAttribute(
    "fill",
    color,
  );
});
