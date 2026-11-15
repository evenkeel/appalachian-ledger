import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HistoricalSpending } from "./HistoricalSpending";
import { api } from "../lib/api";
import { MonetaryLensProvider } from "../lib/monetaryLens";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
vi.mock("./ProjectionChart", () => ({ ProjectionChart: () => null }));
const totals = {
  count: 2,
  usd: "150.00",
  bitcoin: "30075000",
  hypothetical_value_usd: "30075.00",
  missing_usd: 0,
  missing_bitcoin: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({
    totals,
    periods: [{ period: "2026-01", ...totals }],
    categories: [],
    transactions: [],
    transactions_truncated: false,
    current_reference: {
      price_usd: "100000",
      source: "Manual",
      day: "2026-01-06",
      older: true,
    },
  });
});
test("history exposes annual/custom ranges and keeps hypothetical value optional and labeled", async () => {
  render(
    <MonetaryLensProvider unit="BITCOIN">
      <HistoricalSpending accounts={[]} categories={[]} revision={0} />
    </MonetaryLensProvider>,
  );
  await screen.findByLabelText("Historical spending totals");
  expect(screen.getAllByLabelText("30075000 bitcoin").length).toBeGreaterThan(
    0,
  );
  expect(
    screen.queryByText(/This comparison does not mean/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText(/This comparison does not mean/)).toHaveTextContent(
    "older reference",
  );
  fireEvent.change(screen.getByLabelText("History range"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("History start"), {
    target: { value: "2015-01-01" },
  });
  fireEvent.change(screen.getByLabelText("Group spending by"), {
    target: { value: "year" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      expect.stringContaining("start=2015-01-01"),
    ),
  );
  expect(vi.mocked(api).mock.lastCall?.[0]).toContain("interval=year");
});
test("missing conversions stay unavailable and request failures remain visible", async () => {
  vi.mocked(api).mockResolvedValue({
    totals: { ...totals, bitcoin: null, missing_bitcoin: 1 },
    periods: [],
    categories: [],
    transactions: [],
    current_reference: null,
  });
  const { rerender } = render(
    <MonetaryLensProvider unit="BITCOIN">
      <HistoricalSpending accounts={[]} categories={[]} revision={0} />
    </MonetaryLensProvider>,
  );
  await screen.findByText("Unavailable");
  vi.mocked(api).mockRejectedValue(new Error("Choose a date range"));
  rerender(
    <MonetaryLensProvider unit="BITCOIN">
      <HistoricalSpending accounts={[]} categories={[]} revision={1} />
    </MonetaryLensProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose a date range",
  );
});
