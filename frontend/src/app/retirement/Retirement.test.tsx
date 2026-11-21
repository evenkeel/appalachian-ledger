import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastInput, ForecastResult, ProjectionPoint, Scenario } from "../../lib/planning";

const calls: { path: string; method: string; body?: unknown }[] = [];
let lens: "USD" | "BITCOIN" = "USD";
let accounts: unknown[] = [{ id: 1 }, { id: 3 }];
let saved: Scenario[] = [];
let projectFails = "";
let sustainable = true;

const position = {
  as_of: "2026-11-20",
  bitcoin: "23937800",
  cash_usd: "45350.19",
  other_assets_usd: "377500.00",
  liabilities_usd: "209920.00",
  price_usd: "118689.00",
  rate_source: "Fictional demo rate",
  rate_day: "2026-11-19",
  previous_month: "2026-10",
  previous_month_spending_usd: "1849.31",
  previous_month_income_usd: "7050.00",
  previous_month_entries: 31,
};
const fromLedger: ForecastInput = {
  as_of: "2026-11-20",
  current_age: 35,
  retirement_age: 65,
  planning_age: 90,
  bitcoin: "23937800",
  other_assets_usd: "377500.00",
  cash_usd: "45350.19",
  liabilities_usd: "209920.00",
  price_usd: "118689.00",
  monthly_savings_usd: "0",
  monthly_purchase_usd: "0",
  monthly_spending_usd: "0",
  monthly_spending_bitcoin: "0",
  monthly_retirement_income_usd: "0",
  end_balance_usd: "0",
  appreciation_pct: "0",
  other_return_pct: "0",
  usd_spending_change_pct: "0",
  bitcoin_cost_change_pct: "0",
  spending_model: "USD",
};
const point = (month: number, age: string, more: Partial<ProjectionPoint> = {}): ProjectionPoint => ({
  month,
  date: `${2026 + month / 12}-11-20`,
  age,
  bitcoin: "23937800",
  price_usd: "118689.00000000",
  other_assets_usd: "212930.19",
  cash_usd: "0.00",
  portfolio_usd: "241341.72",
  portfolio_bitcoin: "203339585",
  annual_spending_usd: "0.00",
  annual_spending_bitcoin: "0",
  withdrawals_usd: "209920.00",
  withdrawals_bitcoin: "0",
  shortfall_usd: "0.00",
  ...more,
});
const projection = (assumptions: ForecastInput): ForecastResult => ({
  assumptions,
  retirement: point(360, "65.00", { bitcoin: "31400000", annual_spending_usd: "48000.00", annual_spending_bitcoin: "40441827", portfolio_usd: "612000.50", portfolio_bitcoin: "515633715" }),
  end: point(660, "90.00", { bitcoin: "9120000", portfolio_usd: "88250.75", portfolio_bitcoin: "74354616", withdrawals_usd: "1409920.00" }),
  history: [
    point(0, "35.00"),
    point(360, "65.00", { bitcoin: "31400000", portfolio_usd: "612000.50", portfolio_bitcoin: "515633715", annual_spending_bitcoin: "40441827" }),
    point(480, "75.00", { bitcoin: "20100000", portfolio_usd: "301000.00", portfolio_bitcoin: "253604799", annual_spending_bitcoin: "40441827" }),
    point(660, "90.00", { bitcoin: "9120000", portfolio_usd: "88250.75", portfolio_bitcoin: "74354616", annual_spending_bitcoin: "40441827" }),
  ],
  sustainable,
  depletion_date: sustainable ? null : "2062-03-20",
  depletion_age: sustainable ? null : "70.33",
  shortfall_usd: sustainable ? "0.00" : "184000.00",
  target_surplus_usd: sustainable ? "88250.75" : "-184000.00",
  total_spending_usd: "1200000.00",
});
const scenario = (id: number, name: string, assumptions: ForecastInput = fromLedger): Scenario => ({ id, name, version: 1, assumptions, created_at: "2026-11-01T00:00:00+00:00", updated_at: "2026-11-01T00:00:00+00:00" });

vi.mock("../lib/session", () => ({ useSession: () => ({ lens }) }));
vi.mock("../../lib/api", () => ({
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path === "/planning/starting-position") return position;
    if (path === "/accounts") return accounts;
    if (path === "/planning/scenarios" && method === "GET") return saved;
    if (path === "/planning/scenarios" && method === "POST") return scenario(7, (body as { name: string }).name);
    if (path.startsWith("/planning/scenarios/") && method === "PUT") return scenario(Number(path.split("/").pop()), (body as { name: string }).name);
    if (path === "/planning/project") {
      if (projectFails) throw new Error(projectFails);
      return projection(body as ForecastInput);
    }
    if (path === "/planning/earliest-retirement") return { age: 58, date: "2049-11-20" };
    if (path === "/planning/compare") return (body as { ids: number[] }).ids.map((id) => ({ id, name: saved.find((row) => row.id === id)!.name, result: projection(fromLedger) }));
    return { ok: true };
  }),
}));

import { Retirement } from "./Retirement";

const go = vi.fn();
const projects = () => calls.filter((call) => call.path === "/planning/project");
const writes = () => calls.filter((call) => call.method !== "GET" && call.path.startsWith("/planning/scenarios"));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const show = async () => {
  render(<Retirement go={go} />);
  await screen.findByRole("heading", { name: "Retirement" });
};
const outlook = () => screen.getByLabelText(/^Outlook/);
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  calls.length = 0;
  lens = "USD";
  accounts = [{ id: 1 }, { id: 3 }];
  saved = [];
  projectFails = "";
  sustainable = true;
  go.mockClear();
});

describe("retirement", () => {
  it("starts from the ledger and posts the assumptions in the shape the server expects", async () => {
    await show();
    await waitFor(() => expect(projects()).toHaveLength(1));
    expect(projects()[0]).toEqual({ path: "/planning/project", method: "POST", body: fromLedger });
    expect(screen.getByText(/^Started from your ledger balances/)).toBeInTheDocument();

    // Symbols and separators are stripped; the amount itself is sent exactly as typed.
    type(/^Bitcoin bought/, "$1,250.00");
    fireEvent.click(screen.getByRole("button", { name: "In bitcoin" }));
    type(/^A month, today \(₿\)/, "₿3,400,000");
    type(/^Change a year/, "−2.5");
    await waitFor(() => expect(projects().length).toBeGreaterThan(1));
    await waitFor(() =>
      expect(projects()[projects().length - 1].body).toEqual({
        ...fromLedger,
        monthly_purchase_usd: "1250.00",
        spending_model: "BITCOIN",
        monthly_spending_bitcoin: "3400000",
        bitcoin_cost_change_pct: "-2.5",
      }),
    );
  });

  it("shows the outlook with its key figures and a labelled chart", async () => {
    await show();
    await waitFor(() => expect(outlook()).toHaveTextContent("Funded through age 90 under these assumptions."));
    expect(outlook()).toHaveTextContent("Bitcoin at retirement₿31,400,000");
    expect(outlook()).toHaveTextContent("Cost of living a year, at retirement$48,000.00");
    expect(outlook()).toHaveTextContent("Portfolio at age 90$88,250.75");
    expect(outlook()).toHaveTextContent("Above your end amount by$88,250.75");
    expect(outlook()).toHaveTextContent("Treat this as a way to compare assumptions, not as advice or a forecast");
    expect(screen.getByRole("img", { name: /^Projected portfolio by age, from \$241,341\.72 at age 35 to \$88,250\.75 at age 90\. Retirement at age 65\./ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Projected bitcoin held by age, from ₿23,937,800 at age 35 to ₿9,120,000 at age 90\./ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Assumed bitcoin price by age.*This is your assumption, not a forecast\./ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show the table" }));
    const table = within(screen.getByLabelText(/^Year by year/)).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(table).toHaveTextContent("75₿20,100,000");
  });

  it("prices the portfolio in bitcoin when the lens is bitcoin", async () => {
    lens = "BITCOIN";
    await show();
    await waitFor(() => expect(outlook()).toHaveTextContent("Portfolio at age 90₿74,354,616"));
    expect(outlook()).toHaveTextContent("Cost of living a year, at retirement₿40,441,827");
    expect(screen.getByRole("img", { name: /^Projected portfolio by age, from ₿203,339,585/ })).toBeInTheDocument();
  });

  it("says plainly when the plan runs short", async () => {
    sustainable = false;
    await show();
    await waitFor(() => expect(outlook()).toHaveTextContent("Runs short from age 70, in March 2062, under these assumptions."));
    expect(outlook()).toHaveTextContent("Unfunded over the plan$184,000.00");
    expect(outlook()).toHaveTextContent("Below your end amount by$184,000.00");
    expect(screen.getByRole("img", { name: /Runs short at age 70\.$/ })).toBeInTheDocument();
  });

  it("refuses an out-of-range assumption before sending it, and draws nothing from the earlier figures", async () => {
    await show();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(0));
    const before = projects().length;

    type(/^Bitcoin price change/, "1500");
    expect(screen.getByText("Enter a yearly rate from −99 to 1000 percent")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Bitcoin price change/)).toHaveAttribute("aria-invalid", "true");
    expect(outlook()).toHaveTextContent("Fix the marked assumptions");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();

    type(/^Bitcoin price change/, "5");
    type(/^Retire at age/, "30");
    expect(screen.getByText("Retirement age cannot be below your age now")).toBeInTheDocument();
    type(/^Retire at age/, "65");
    type(/^Cash/, "12.345");
    expect(screen.getByText("Enter dollars and cents, zero or more, like 1250.00")).toBeInTheDocument();
    type(/^Bitcoin you hold/, "0.5");
    expect(screen.getByText("Enter whole bitcoin units, zero or more, like 125000")).toBeInTheDocument();

    await pause(450);
    expect(projects()).toHaveLength(before);
  });

  it("shows a server error and nothing from the earlier figures", async () => {
    await show();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(0));
    projectFails = "Scenario exceeds the supported projection range";
    type(/^Bitcoin price change/, "900");
    expect(await within(outlook()).findByRole("alert")).toHaveTextContent("Scenario exceeds the supported projection range");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(outlook()).not.toHaveTextContent("Funded through");
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
  });

  it("saves, renames and deletes a plan, and deleting needs a second press", async () => {
    await show();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save plan" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: "/planning/scenarios", method: "POST", body: { name: "My plan", assumptions: fromLedger } });
    expect(await screen.findByText("Saved My plan with its starting date and price.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "  Early exit " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({ path: "/planning/scenarios/7", method: "PUT", body: { name: "Early exit", assumptions: fromLedger } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Save a copy" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes()[2]).toMatchObject({ path: "/planning/scenarios", method: "POST", body: { name: "Early exit copy" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // A double-click lands on the same button; it must not count as the confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    expect(writes()).toHaveLength(3);
    await pause(450);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => expect(writes()).toHaveLength(4));
    expect(writes()[3]).toEqual({ path: "/planning/scenarios/7", method: "DELETE", body: undefined });
  });

  it("opens a saved plan with its own date and price, and compares up to four", async () => {
    saved = [scenario(1, "Steady", { ...fromLedger, as_of: "2026-01-05", price_usd: "97000.00" }), scenario(2, "Lean years", { ...fromLedger, monthly_spending_usd: "2500.00" })];
    await show();
    await screen.findByRole("option", { name: "Steady" });
    fireEvent.change(screen.getByLabelText("Saved plans"), { target: { value: "1" } });
    expect(screen.getByLabelText("Starting date")).toHaveValue("2026-01-05");
    expect(screen.getByLabelText(/^Bitcoin price \(\$ per BTC\)/)).toHaveValue("97000.00");
    expect(screen.getByText(/^Opened Steady with its saved date and price/)).toBeInTheDocument();

    const compare = within(screen.getByLabelText(/^Compare saved plans/));
    fireEvent.click(compare.getByLabelText("Steady"));
    fireEvent.click(compare.getByLabelText("Lean years"));
    await waitFor(() => expect(calls.filter((call) => call.path === "/planning/compare").pop()?.body).toEqual({ ids: [1, 2] }));
    expect(await compare.findByRole("img", { name: /^Projected portfolio for Steady, ending at \$88,250\.75; Lean years, ending at/ })).toBeInTheDocument();
    const rows = within(compare.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("1. Steady");
    expect(rows[2]).toHaveTextContent("Never, in this plan");
    // The legend names each line by number, matching the number at the line's end.
    expect(compare.getByText("2. Lean years", { selector: ".key span" })).toBeInTheDocument();
  });

  it("finds the earliest funded retirement age from the same assumptions", async () => {
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Find the earliest funded retirement age" }));
    await waitFor(() => expect(calls.find((call) => call.path === "/planning/earliest-retirement")).toEqual({ path: "/planning/earliest-retirement", method: "POST", body: fromLedger }));
    expect(await screen.findByText("Earliest funded age: 58, in November 2049.")).toBeInTheDocument();
  });

  it("copies last month's recorded spending only when asked", async () => {
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Use October's recorded spending, $1,849.31" }));
    expect(screen.getByLabelText(/^A month, today \(\$\)/)).toHaveValue("1849.31");
    expect(screen.getByText(/^Copied what you recorded in October/)).toBeInTheDocument();
  });

  it("on an empty ledger, asks for an account first and draws nothing", async () => {
    accounts = [];
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Add an account" }));
    expect(go).toHaveBeenCalledWith("accounts", "add");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Assumptions/)).not.toBeInTheDocument();
    // Planning from figures typed by hand is still possible.
    fireEvent.click(screen.getByRole("button", { name: /^Enter figures by hand instead/ }));
    expect(screen.getByLabelText(/^Assumptions/)).toBeInTheDocument();
  });

  it("says it is a what-if that never changes the ledger, and never uses the banned unit names", async () => {
    await show();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(0));
    expect(document.body).toHaveTextContent("It is not a prediction, and nothing here changes your ledger.");
    expect(document.body.textContent).not.toMatch(/\bsats?\b|satoshi/i);
    expect(calls.every((call) => call.method === "GET" || call.path.startsWith("/planning/"))).toBe(true);
  });
});
