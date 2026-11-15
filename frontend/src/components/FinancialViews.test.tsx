import { test, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { OverviewView, OwnershipCards, ReportsView } from "./FinancialViews";
import { TransactionTable } from "./TransactionTable";
import { EntryDialog } from "./EntryDialog";
import { DenominationTrends, ToggleAmounts } from "./WealthOverview";
import type { Account, Report, Transaction } from "../lib/types";

vi.mock("./Charts", () => ({
  HistoryChart: ({
    history,
    unit,
    flows,
  }: {
    history: { income: string; expenses: string; net_worth: string }[];
    unit: string;
    flows: boolean;
  }) => (
    <div data-testid={flows ? "flow-chart" : "value-chart"}>
      {unit}:{JSON.stringify(history)}
    </div>
  ),
}));
vi.mock("./DualHistoryChart", () => ({
  DualHistoryChart: ({
    history,
    title,
  }: {
    history: unknown;
    title: string;
  }) => <div data-testid={`dual-${title}`}>{JSON.stringify(history)}</div>,
}));
const ownership = {
  equivalents: {
    bitcoin: { BITCOIN: "2500000", USD: "2500.00" },
    dollars: { BITCOIN: "2000000", USD: "2000.00" },
    valued_asset: { BITCOIN: "1080000000", USD: "1080000.00" },
    debt: { BITCOIN: "501234567", USD: "501234.57" },
  },
  native_other_assets: { USD: "1000000.00", BITCOIN: "80000000" },
  native_liabilities: { USD: "500000.00", BITCOIN: "1234567" },
  bitcoin_held: "2500000",
  usd_held: "2000.00",
  valued_assets_usd: "1000000.00",
  liabilities_usd: "500000.00",
};
const emptyFlow = {
  income: "0",
  expenses: "0",
  savings_rate: null,
  categories: [],
};
const dollarFlow = {
  income: "500.00",
  expenses: "100.00",
  savings_rate: "80.0",
  categories: [{ name: "Food", value: "100.00" }],
};
const nativeFlows = {
  USD: dollarFlow,
  BITCOIN: { ...emptyFlow, expenses: "5000" },
};
const account: Account = {
  id: 1,
  name: "Investment portfolio",
  kind: "brokerage",
  role: "asset",
  currency: "USD",
  balance: "1300.00",
  balance_minor: "130000",
  bitcoin: "650000",
  usd: "1300.00",
  value: "1300.00",
  holding_type: "valued_asset",
  archived: false,
  rate_day: "2026-02-28",
  rate_source: "manual",
};
const report: Report = {
  month: "2026-02",
  denomination: "USD",
  ownership,
  accounts: [account],
  assets: "1300.00",
  liabilities: "0",
  net_worth: "1300.00",
  ...dollarFlow,
  expenses: null,
  flows: { USD: dollarFlow, BITCOIN: { ...emptyFlow, expenses: null } },
  native_flows: nativeFlows,
  performance: [
    {
      account_id: 1,
      start_date: "2026-01-31",
      end_date: "2026-02-28",
      start_value: "1000.00",
      end_value: "1300.00",
      net_additions: "200.00",
      value_change: "100.00",
    },
  ],
  history: [
    {
      month: "2026-02",
      date: "2026-02-28",
      rate_day: "2026-02-28",
      net_worth: "1300.00",
      ...dollarFlow,
      expenses: null,
      accounts: [account],
      flows: { USD: dollarFlow, BITCOIN: { ...emptyFlow, expenses: null } },
      native_flows: nativeFlows,
    },
  ],
  recent: [],
  rate: null,
  missing_rates: false,
  valuation_basis: "dated historical rate",
};

test("missing conversions keep recorded balances prominent and recover in bitcoin", () => {
  const { rerender } = render(
    <ToggleAmounts label="debt" values={{ BITCOIN: null, USD: "750.64" }} />,
  );
  expect(
    screen.getByText("$750.64").closest(".overview-primary"),
  ).not.toBeNull();
  expect(
    screen.getByRole("button", { name: "Show debt in bitcoin" }),
  ).toBeDisabled();
  rerender(
    <ToggleAmounts
      label="debt"
      values={{ BITCOIN: "750640", USD: "750.64" }}
    />,
  );
  expect(
    screen.getByText("₿750,640").closest(".overview-primary"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show debt in dollars" }));
  expect(
    screen.getByText("$750.64").closest(".overview-primary"),
  ).not.toBeNull();
});

test("overview preserves balance toggles and shows all trends in both currencies", () => {
  const dual = {
    BITCOIN: {
      ...emptyFlow,
      assets: "650000",
      liabilities: "0",
      net_worth: "650000",
      expenses: "50000",
    },
    USD: {
      ...dollarFlow,
      assets: "1300.00",
      liabilities: "0",
      net_worth: "1300.00",
    },
  };
  const onIncome = vi.fn();
  const onPeriod = vi.fn();
  render(
    <OverviewView
      report={{
        ...report,
        dual,
        lifestyle_baseline: "2026-02",
        history: report.history.map((h) => ({
          ...h,
          dual,
          lifestyle: { BITCOIN: "50000", USD: "100.00" },
        })),
      }}
      period="6"
      onPeriod={onPeriod}
      onTransactions={() => {}}
      onUnit={() => {}}
      loading={false}
      onIncome={onIncome}
    />,
  );
  const hero = screen.getByRole("region", { name: "Total net worth" });
  expect(within(hero).getAllByText("₿650,000")[0]).toBeInTheDocument();
  expect(within(hero).getAllByText("$1,300.00")[0]).toBeInTheDocument();
  const trends = screen.getByRole("region", { name: "Trends" });
  expect(within(trends).getAllByRole("article")).toHaveLength(5);
  expect(screen.getByTestId("dual-Expenses")).toHaveTextContent(
    '"USD":"100.00","BITCOIN":"50000"',
  );
  expect(screen.getByTestId("dual-Debt")).toHaveTextContent(
    '"USD":"0","BITCOIN":"0"',
  );
  fireEvent.click(
    within(hero).getByRole("button", { name: "Show net worth in dollars" }),
  );
  expect(
    within(hero).getAllByText("$1,300.00")[0].closest(".overview-primary"),
  ).not.toBeNull();
  const activity = screen.getByRole("region", { name: "Monthly activity" });
  const expenses = within(activity).getByRole("group", { name: "Expenses" });
  const income = within(activity).getByRole("group", { name: "Income" });
  fireEvent.click(
    within(expenses).getByRole("button", { name: "Show expenses in dollars" }),
  );
  expect(
    within(expenses).getByText("$100.00").closest(".overview-primary"),
  ).not.toBeNull();
  expect(
    within(income).getByRole("button", { name: "Show income in dollars" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("dual-Expenses")).toHaveTextContent(
    '"USD":"100.00","BITCOIN":"50000"',
  );
  expect(
    within(hero).getAllByText("$1,300.00")[0].closest(".overview-primary"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "1Y" }));
  expect(onPeriod).toHaveBeenCalledWith("12");
  expect(screen.getByText(/The dollar cost of your/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show monthly values" }));
  expect(
    screen.getByRole("columnheader", { name: "Month" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("₿2,500,000").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Income · manage/ }));
  expect(onIncome).toHaveBeenCalledOnce();
});

test("overview keeps unavailable conversions and empty history unavailable after swapping", () => {
  render(
    <OverviewView
      report={{ ...report, history: [] }}
      period="6"
      onPeriod={() => {}}
      onTransactions={() => {}}
      onUnit={() => {}}
      loading={false}
    />,
  );
  const hero = screen.getByRole("region", { name: "Total net worth" });
  const balance = hero.querySelector(".net-worth-balance") as HTMLElement;
  expect(within(balance).getAllByText("Unavailable")).toHaveLength(2);
  fireEvent.click(
    within(hero).getByRole("button", { name: "Show net worth in dollars" }),
  );
  expect(within(balance).getAllByText("Unavailable")).toHaveLength(2);
  expect(screen.getByTestId("dual-Expenses")).toHaveTextContent("[]");
  expect(screen.getByTestId("dual-Same lifestyle")).toHaveTextContent("[]");
});

test("simultaneous trends preserve missing conversions and genuine zero values", () => {
  const data = {
    ...report,
    history: [
      {
        ...report.history[0],
        month: "2026-02",
        dual: {
          USD: {
            ...emptyFlow,
            expenses: null,
            income: "0",
            assets: "0",
            liabilities: "0",
            net_worth: null,
          },
          BITCOIN: {
            ...emptyFlow,
            expenses: "125000",
            income: null,
            assets: "0",
            liabilities: "0",
            net_worth: "500000",
          },
        },
        lifestyle: { USD: "100.00", BITCOIN: null },
      },
    ],
  };
  const onPeriod = vi.fn();
  render(<DenominationTrends report={data} period="6" onPeriod={onPeriod} />);
  expect(screen.getByTestId("dual-Expenses")).toHaveTextContent(
    '"USD":null,"BITCOIN":"125000"',
  );
  expect(screen.getByTestId("dual-Income")).toHaveTextContent(
    '"USD":"0","BITCOIN":null',
  );
  expect(screen.getByTestId("dual-Same lifestyle")).toHaveTextContent(
    '"USD":"100.00","BITCOIN":null',
  );
  fireEvent.click(screen.getByRole("button", { name: "2Y" }));
  expect(onPeriod).toHaveBeenCalledWith("24");
});

test("asset and liability cards show separate original currencies", () => {
  render(<OwnershipCards ownership={ownership} asOf="2026-02-28" />);
  const assets = screen
    .getByRole("heading", { name: "Other assets" })
    .closest("article")!;
  expect(within(assets).getByText("$1,000,000.00")).toBeInTheDocument();
  expect(within(assets).getByText("₿80,000,000")).toBeInTheDocument();
  const debt = screen
    .getByRole("heading", { name: "Liabilities" })
    .closest("article")!;
  expect(within(debt).getByText("$500,000.00")).toBeInTheDocument();
  expect(within(debt).getByText("₿1,234,567")).toBeInTheDocument();
  for (const [name, target, amount] of [
    ["Bitcoin holdings", "dollars", "$2,500.00"],
    ["USD cash", "bitcoin", "₿2,000,000"],
    ["Other assets", "dollars", "$1,080,000.00"],
    ["Liabilities", "dollars", "$501,234.57"],
  ]) {
    const card = screen.getByRole("article", { name });
    fireEvent.click(
      within(card).getByRole("button", {
        name: `Show ${name.toLowerCase()} in ${target}`,
      }),
    );
    expect(
      within(card).getByText(amount).closest(".overview-primary"),
    ).not.toBeNull();
  }
  fireEvent.click(
    within(assets).getByRole("button", {
      name: "Show other assets in bitcoin",
    }),
  );
  expect(
    within(assets).getByText("₿1,080,000,000").closest(".overview-primary"),
  ).not.toBeNull();
  expect(
    within(debt).getByText("$501,234.57").closest(".overview-primary"),
  ).not.toBeNull();
});

test("activity filter selects original-currency flow data and retains missing conversions", () => {
  render(
    <ReportsView
      report={report}
      period="6"
      onPeriod={() => {}}
      onExport={() => {}}
    />,
  );
  expect(screen.getByTestId("flow-chart")).toHaveTextContent('"expenses":null');
  fireEvent.change(
    screen.getByRole("combobox", { name: "Activity currency" }),
    { target: { value: "USD" } },
  );
  expect(screen.getByTestId("flow-chart")).toHaveTextContent(
    '"expenses":"100.00"',
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Activity currency" }),
    { target: { value: "BITCOIN" } },
  );
  expect(screen.getByTestId("flow-chart")).toHaveTextContent('"expenses":null');
  expect(
    screen.getByText("Valuation & exchange-rate change"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/not an investment return percentage/),
  ).toBeInTheDocument();
});

test("compact transaction view shows actual amounts sent and received, never a theoretical purchase", () => {
  const tx: Transaction = {
    id: 1,
    date: "2026-02-05",
    kind: "transfer",
    description: "Bitcoin buy",
    notes: "",
    account_id: 1,
    account: "Checking",
    currency: "USD",
    amount: "100",
    destination_id: 2,
    destination_amount: "95000",
    destination_currency: "BITCOIN",
    destination_account: "Wallet",
    category_id: null,
    category: "Transfer",
    bitcoin: "100000",
    usd: "100",
    rate_snapshot: "100000",
    valuation_basis: "historical purchasing power",
  };
  render(<TransactionTable rows={[tx]} compact />);
  expect(screen.getByText("$100.00")).toBeInTheDocument();
  expect(screen.getByText("₿95,000")).toBeInTheDocument();
  expect(screen.queryByText("₿100,000")).not.toBeInTheDocument();
});

test("budget editor accepts a USD plan without inventing a conversion for a legacy plan", () => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  const props = {
    accounts: [],
    assets: [],
    categories: [{ id: 1, name: "Food", kind: "expense" as const }],
    month: "2026-02",
    onClose: () => {},
    onSaved: () => {},
  };
  const { rerender } = render(
    <EntryDialog
      {...props}
      state={{
        type: "budget",
        budget: {
          category_id: 1,
          category: "Food",
          budget_id: null,
          planned_usd: null,
          spent_usd: "100",
          spent_bitcoin: "100000",
          remaining_usd: null,
          percent: null,
        },
      }}
    />,
  );
  expect(screen.getByLabelText("USD budget")).toHaveValue("");
  expect(screen.queryByLabelText("Budget currency")).not.toBeInTheDocument();
  rerender(
    <EntryDialog
      key="existing"
      {...props}
      state={{
        type: "budget",
        budget: {
          category_id: 1,
          category: "Food",
          budget_id: 2,
          planned_usd: "180.00",
          spent_usd: "100.00",
          spent_bitcoin: "100000",
          remaining_usd: "80.00",
          percent: "55.6",
        },
      }}
    />,
  );
  expect(screen.getByLabelText("USD budget")).toHaveValue("180.00");
});

test("workspace lens changes primary summaries while retaining exact amounts and local swaps", async () => {
  const { MonetaryLensProvider } = await import("../lib/monetaryLens");
  const { rerender, container } = render(
    <MonetaryLensProvider unit="USD">
      <ToggleAmounts
        label="assets"
        values={{ USD: "90071992547409.91", BITCOIN: "9007199254740991" }}
      />
    </MonetaryLensProvider>,
  );
  expect(container.querySelector(".overview-primary")).toHaveTextContent(
    "$90,071,992,547,409.91",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Show assets in bitcoin" }),
  );
  expect(container.querySelector(".overview-primary")).toHaveTextContent(
    "₿9,007,199,254,740,991",
  );
  rerender(
    <MonetaryLensProvider unit="BITCOIN">
      <ToggleAmounts
        label="assets"
        values={{ USD: "90071992547409.91", BITCOIN: "9007199254740991" }}
      />
    </MonetaryLensProvider>,
  );
  rerender(
    <MonetaryLensProvider unit="USD">
      <ToggleAmounts
        label="assets"
        values={{ USD: "90071992547409.91", BITCOIN: "9007199254740991" }}
      />
    </MonetaryLensProvider>,
  );
  expect(container.querySelector(".overview-primary")).toHaveTextContent(
    "$90,071,992,547,409.91",
  );
});
