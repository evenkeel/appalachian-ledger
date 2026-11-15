import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RetirementPlanner } from "./RetirementPlanner";
import { api } from "../lib/api";
import {
  emptyPlan,
  type ForecastInput,
  type ForecastResult,
  type Scenario,
} from "../lib/planning";
import { MonetaryLensProvider } from "../lib/monetaryLens";

vi.mock("../lib/api", () => ({ api: vi.fn() }));
vi.mock("./ProjectionChart", () => ({
  ProjectionChart: ({ title, unit }: { title: string; unit: string }) => (
    <div role="img" aria-label={`${title} · ${unit}`} />
  ),
}));
const savedInputs = {
  ...emptyPlan("2026-01-01"),
  price_usd: "100000",
  bitcoin: "100000000",
};
const point = {
  month: 0,
  date: "2056-01-01",
  age: "65.00",
  bitcoin: "100000000",
  price_usd: "100000",
  other_assets_usd: "0.00",
  cash_usd: "0.00",
  portfolio_usd: "100000.00",
  portfolio_bitcoin: "100000000",
  annual_spending_usd: "0.00",
  annual_spending_bitcoin: "0",
  withdrawals_usd: "0.00",
  withdrawals_bitcoin: "0",
  shortfall_usd: "0.00",
};
const forecast = (assumptions: ForecastInput): ForecastResult => ({
  assumptions,
  retirement: point,
  end: point,
  history: [point],
  sustainable: true,
  depletion_date: null,
  depletion_age: null,
  shortfall_usd: "0.00",
  target_surplus_usd: "100000.00",
  total_spending_usd: "0.00",
});
let saved: Scenario[];
beforeEach(() => {
  vi.clearAllMocks();
  saved = [
    {
      id: 1,
      name: "Stored case",
      version: 1,
      assumptions: savedInputs,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  ];
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path === "/planning/starting-position")
      return {
        as_of: "2026-11-11",
        bitcoin: "123456789",
        cash_usd: "100.00",
        other_assets_usd: null,
        liabilities_usd: "0.00",
        price_usd: null,
        rate_source: null,
        rate_day: null,
        previous_month: "2026-10",
        previous_month_spending_usd: "200.00",
        previous_month_income_usd: "500.00",
        previous_month_entries: 4,
      };
    if (path === "/planning/scenarios" && method !== "POST") return saved;
    if (path === "/planning/project") return forecast(body as ForecastInput);
    if (path === "/planning/earliest-retirement")
      return { age: 40, date: "2031-11-11" };
    if (path === "/planning/compare")
      return saved.map((s) => ({
        id: s.id,
        name: s.name,
        result: forecast(s.assumptions),
      }));
    if (path === "/planning/scenarios" && method === "POST") {
      const data = body as { name: string; assumptions: ForecastInput };
      const row = {
        id: 2,
        version: 1,
        ...data,
        created_at: "now",
        updated_at: "now",
      };
      saved = [...saved, row];
      return row;
    }
    return { ok: true };
  });
});

test("manual planning exposes zero-return assumptions and hides stale results during recalculation", async () => {
  render(<RetirementPlanner />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Enter a starting price",
  );
  expect(
    screen.getByLabelText("Bitcoin appreciation against USD · %"),
  ).toHaveValue("0");
  fireEvent.change(
    screen.getByLabelText("Starting price · USD per legacy BTC"),
    { target: { value: "100000" } },
  );
  await screen.findByText(
    "Spending and end-balance target funded through planning age",
  );
  fireEvent.change(
    screen.getByLabelText("Bitcoin appreciation against USD · %"),
    { target: { value: "-10" } },
  );
  expect(
    screen.queryByText(
      "Spending and end-balance target funded through planning age",
    ),
  ).not.toBeInTheDocument();
  await screen.findByText(
    "Spending and end-balance target funded through planning age",
  );
  expect(api).toHaveBeenLastCalledWith(
    "/planning/project",
    "POST",
    expect.objectContaining({
      appreciation_pct: "-10",
      spending_model: "USD",
      bitcoin_cost_change_pct: "0",
    }),
  );
  fireEvent.change(screen.getByLabelText("Spending model"), {
    target: { value: "BITCOIN" },
  });
  expect(
    screen.getByLabelText("Annual bitcoin lifestyle-cost change · %"),
  ).toHaveValue("0");
  expect(
    screen.queryByLabelText("Annual USD spending change · %"),
  ).not.toBeInTheDocument();
});

test("ledger prefill preserves unavailable fields and copies spending only on request", async () => {
  render(<RetirementPlanner />);
  const copy = screen.getByRole("button", { name: "Use ledger balances" });
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Other financial assets · USD"), {
    target: { value: "500" },
  });
  fireEvent.click(copy);
  expect(screen.getByLabelText("Bitcoin holdings · ₿")).toHaveValue(
    "123456789",
  );
  expect(screen.getByLabelText("Other financial assets · USD")).toHaveValue(
    "500",
  );
  expect(
    screen.getByLabelText("Starting price · USD per legacy BTC"),
  ).toHaveValue("");
  expect(
    screen.getByLabelText("Monthly lifestyle cost today · USD"),
  ).toHaveValue("0");
  fireEvent.click(
    screen.getByRole("button", { name: "Use 2026-10 recorded expenses" }),
  );
  expect(
    screen.getByLabelText("Monthly lifestyle cost today · USD"),
  ).toHaveValue("200.00");
  expect(
    screen.getByText(/Copied recorded 2026-10 expenses/),
  ).toHaveTextContent("may not represent a complete or typical month");
});

test("saved scenarios retain snapshots, duplicate, compare in the selected lens and solve on demand", async () => {
  render(
    <MonetaryLensProvider unit="BITCOIN">
      <RetirementPlanner />
    </MonetaryLensProvider>,
  );
  await screen.findByRole("option", { name: "Stored case" });
  fireEvent.change(screen.getByLabelText("Saved scenario"), {
    target: { value: "1" },
  });
  expect(screen.getByLabelText("Starting date")).toHaveValue("2026-01-01");
  await screen.findByText(
    "Spending and end-balance target funded through planning age",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save copy" }));
  await screen.findByRole("option", { name: "Stored case copy" });
  expect(api).toHaveBeenCalledWith("/planning/scenarios", "POST", {
    name: "Stored case copy",
    assumptions: savedInputs,
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Stored case" }));
  await screen.findByRole("img", {
    name: "Scenario portfolio comparison · BITCOIN",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Find earliest funded retirement age" }),
  );
  expect(
    await screen.findByText(/Earliest funded annual-age candidate: 40/),
  ).toBeInTheDocument();
});

test("projection failure shows a visible error without reusing a previous result", async () => {
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, ...args) => {
    if (path === "/planning/project")
      throw new Error("Scenario exceeds the supported projection range");
    return implementation(path, ...args);
  });
  render(<RetirementPlanner />);
  fireEvent.change(
    screen.getByLabelText("Starting price · USD per legacy BTC"),
    { target: { value: "100000" } },
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "supported projection range",
  );
  expect(
    screen.queryByRole("button", {
      name: "Find earliest funded retirement age",
    }),
  ).not.toBeInTheDocument();
});
