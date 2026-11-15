import { beforeEach, expect, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { AllocationOverview } from "./AllocationOverview";
import { BitcoinDominance } from "./BitcoinDominance";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
import type { Allocation, Report } from "../lib/types";

// Geometry is verified in the browser; here we verify the financial labels and states.
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: () => null,
}));

const allocation: Allocation = {
  bitcoin_usd: "200.00",
  dollars_usd: "100.00",
  other_assets_usd: "100.00",
  assets_usd: "400.00",
  liabilities_usd: "300.00",
  net_worth_usd: "100.00",
  asset_percentages: { bitcoin: "50.0", dollars: "25.0", valued_asset: "25.0" },
  bitcoin_dominance: "200.0",
  status: "ready",
};
const flow = { income: "0", expenses: "0", savings_rate: null, categories: [] };
const report: Report = {
  month: "2026-03",
  denomination: "BITCOIN",
  ...flow,
  accounts: [],
  recent: [],
  performance: [],
  rate: null,
  missing_rates: false,
  valuation_basis: "dated historical rate",
  assets: "400000",
  liabilities: "300000",
  net_worth: "100000",
  flows: { USD: flow, BITCOIN: flow },
  native_flows: { USD: flow, BITCOIN: flow },
  ownership: {
    allocation,
    bitcoin_held: "200000",
    usd_held: "100.00",
    valued_assets_usd: "100.00",
    liabilities_usd: "300.00",
    native_other_assets: { USD: "100.00", BITCOIN: "0" },
    native_liabilities: { USD: "300.00", BITCOIN: "0" },
  },
  history: ["2026-01", "2026-02", "2026-03"].map((month, index) => ({
    month,
    date: `${month}-28`,
    rate_day: null,
    ...flow,
    net_worth: null,
    accounts: [],
    flows: { USD: flow, BITCOIN: flow },
    native_flows: { USD: flow, BITCOIN: flow },
    allocation: {
      ...allocation,
      bitcoin_dominance: index === 1 ? null : "200.0",
    },
  })),
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({
    period: "6m",
    resolution: "monthly",
    start: "2026-01-01",
    end: "2026-03-28",
    points: report.history.map((point) => ({
      date: point.date,
      bitcoin_dominance: point.allocation?.bitcoin_dominance ?? null,
    })),
  });
});

test("top-level dominance uses the six requested periods independently of asset shares", async () => {
  render(
    <>
      <AllocationOverview report={report} />
      <BitcoinDominance report={report} />
    </>,
  );
  const pie = screen.getByRole("article", { name: "Asset allocation" });
  expect(within(pie).getByText("₿200,000")).toBeInTheDocument();
  expect(within(pie).queryByText(/%/)).not.toBeInTheDocument();
  expect(
    within(pie).getByRole("img", { name: "Bitcoin, USD cash, Other assets" }),
  ).toBeInTheDocument();
  for (const label of ["Bitcoin", "USD cash", "Other assets"]) {
    expect(within(pie).getByText(label)).toBeInTheDocument();
  }
  expect(within(pie).getByText("$300.00")).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
  expect(
    screen.getByRole("img", { name: "Bitcoin dominance thermometer: 200.0%" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Bitcoin dominance · view history" }),
  );
  const dominance = screen.getByRole("dialog", {
    name: "Bitcoin dominance history",
  });
  await waitFor(() =>
    expect(within(dominance).getAllByText("200.0%")).toHaveLength(3),
  );
  expect(within(dominance).getByText("Unavailable")).toBeInTheDocument();
  const select = screen.getByLabelText("Dominance history period");
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["1 week", "1 month", "6 months", "1 year", "5 years", "Max"]);
  vi.mocked(api).mockResolvedValueOnce({
    period: "1w",
    resolution: "daily",
    start: "2026-03-22",
    end: "2026-03-28",
    points: [],
  });
  fireEvent.change(select, { target: { value: "1w" } });
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith("/dominance?month=2026-03&period=1w"),
  );
  expect(await screen.findByText("Daily values")).toBeInTheDocument();
});

test("missing values suppress partial allocation and keep the history state explicit", async () => {
  vi.mocked(api).mockResolvedValueOnce({
    period: "6m",
    resolution: "monthly",
    points: [],
  });
  const missing: Allocation = {
    ...allocation,
    status: "missing_values",
    bitcoin_usd: null,
    assets_usd: null,
    net_worth_usd: null,
    bitcoin_dominance: null,
    asset_percentages: { bitcoin: null, dollars: null, valued_asset: null },
  };
  const empty = {
    ...report,
    ownership: { ...report.ownership, allocation: missing },
    history: [],
  };
  render(
    <>
      <AllocationOverview report={empty} />
      <BitcoinDominance report={empty} />
    </>,
  );
  expect(
    screen.queryByRole("img", { name: "Bitcoin, USD cash, Other assets" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Bitcoin dominance unavailable" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("Exchange rate needed")).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", { name: "Bitcoin dominance · view history" }),
  );
  expect(await screen.findByText("No history available")).toBeInTheDocument();
});

test("nonpositive net worth keeps asset allocation but leaves dominance unavailable", async () => {
  const zero = {
    ...report,
    ownership: {
      ...report.ownership,
      allocation: {
        ...allocation,
        net_worth_usd: "0",
        bitcoin_dominance: null,
      },
    },
  };
  render(
    <>
      <AllocationOverview report={zero} />
      <BitcoinDominance report={zero} />
    </>,
  );
  expect(
    screen.getByRole("img", { name: "Bitcoin, USD cash, Other assets" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Net worth must be above zero")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Bitcoin dominance · view history" }),
  );
  await screen.findByText("Monthly values");
});

test("history errors show a retry control instead of a misleading empty chart", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("History unavailable"));
  render(<BitcoinDominance report={report} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Bitcoin dominance · view history" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "History unavailable",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Monthly values")).toBeInTheDocument();
});

test("thermometer opens history and closing restores the compact card", async () => {
  render(<BitcoinDominance report={report} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Bitcoin dominance · view history" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Bitcoin dominance history" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Close dominance history" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Bitcoin dominance · view history" }),
  ).toHaveFocus();
  expect(
    screen.getByRole("img", { name: "Bitcoin dominance thermometer: 200.0%" }),
  ).toBeInTheDocument();
});

test.each(["0.0", "100.0"])(
  "thermometer keeps the %s%% endpoint explicit",
  (value) => {
    render(
      <BitcoinDominance
        report={{
          ...report,
          ownership: {
            ...report.ownership,
            allocation: { ...allocation, bitcoin_dominance: value },
          },
        }}
      />,
    );
    expect(
      screen.getByRole("img", {
        name: `Bitcoin dominance thermometer: ${value}%`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("0% Net Worth")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: `Bitcoin dominance thermometer: ${value}%`,
      }),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  },
);
