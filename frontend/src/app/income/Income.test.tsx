import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; method: string; body?: unknown }[] = [];
let answer: unknown;
vi.mock("../../lib/api", () => ({
  setCsrf: vi.fn(),
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    return method === "GET" ? answer : { ok: true };
  }),
}));
let lens: "USD" | "BITCOIN" = "USD";
vi.mock("../lib/session", () => ({ useSession: () => ({ lens }) }));

import { Income } from "./Income";
import type { IncomeData, Month } from "./Income";

const total = (usd: string | null, bitcoin: string | null, paychecks = 2) => ({
  usd,
  bitcoin,
  missing_usd: 0,
  missing_bitcoin: bitcoin === null ? 1 : 0,
  paychecks,
});
const month = (key: string, usd: string, bitcoin: string | null, rate: string | null): Month => ({
  month: key,
  ...total(usd, bitcoin),
  sources: { "1": total(usd, bitcoin) },
  saved_usd: "400.00",
  saved_bitcoin: "400000",
  stack_rate: rate,
});
const full: IncomeData = {
  today: "2026-11-26",
  status: "ready",
  months_of_history: 3,
  sources: [
    {
      id: 1,
      name: "Carver & Sons Electrical",
      ended_on: null,
      category: "Salary",
      currency: "USD",
      paychecks: 6,
      first_date: "2026-09-04",
      last_date: "2026-11-13",
      typical: "1818.40",
      year: total("10910.40", "11000000", 6),
      all_time: total("10910.40", "11000000", 6),
      expected: [
        {
          schedule: { id: 1, name: "Paycheck", amount: "1818.40", frequency: "biweekly", next_occurrence: "2026-11-27", currency: "USD" },
          paychecks: [
            { date: "2026-10-30", expected: "1818.40", actual: "1818.40", received_on: "2026-10-30", status: "received", days_late: 0, short_by: null },
            { date: "2026-11-13", expected: "1818.40", actual: "1500.00", received_on: "2026-11-13", status: "short", days_late: 0, short_by: "318.40" },
          ],
        },
      ],
    },
    { id: 2, name: "Old job", ended_on: "2026-08-28", category: "Salary", currency: "USD", paychecks: 0, first_date: null, last_date: null, typical: null, year: total("0.00", "0", 0), all_time: total("0.00", "0", 0), expected: [] },
  ],
  months: [month("2026-09", "3636.80", "3700000", "11.0"), month("2026-10", "3636.80", null, null), month("2026-11", "3318.40", "3400000", "12.1")],
  changes: [{ date: "2026-03-06", kind: "raise", source_id: 1, source: "Carver & Sons Electrical", direction: "up", text: "Pay went up 10% in March." }],
  problems: [],
  recent: [],
};

beforeEach(() => {
  calls.length = 0;
  lens = "USD";
  answer = full;
});

describe("Income", () => {
  it("shows the month, the sources, a raise in plain words and a short paycheck, in dollars", async () => {
    render(<Income go={vi.fn()} />);
    const now = await screen.findByRole("region", { name: "This month: November" });
    expect(within(now).getByText("$3,318.40")).toBeInTheDocument();
    expect(within(now).getByText("12.1%")).toBeInTheDocument();
    expect(screen.getByText("Pay went up 10% in March.")).toBeInTheDocument();
    const expected = screen.getByRole("region", { name: /Expected and actual/ });
    expect(within(expected).getByText("Short")).toBeInTheDocument();
    expect(within(expected).getByText("$318.40 under")).toBeInTheDocument();
    expect(screen.getByText("Ended Aug 28")).toBeInTheDocument();
  });

  it("switches the whole screen to bitcoin and never fills in a month whose price is missing", async () => {
    lens = "BITCOIN";
    render(<Income go={vi.fn()} />);
    const now = await screen.findByRole("region", { name: "This month: November" });
    expect(within(now).getByText("₿3,400,000")).toBeInTheDocument();
    // October has a paycheck with no saved price: the year has no bitcoin total, and its row says so.
    expect(within(now).queryByText(/₿7,100,000/)).not.toBeInTheDocument();
    expect(within(now).getByText("No price")).toBeInTheDocument();
    const saved = screen.getByRole("region", { name: /Share saved in bitcoin/ });
    const october = within(saved).getByText("Oct 2026").closest("tr")!;
    expect(within(october).getByText("No price")).toBeInTheDocument();
    expect(within(october).getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/1 month with a paycheck that has no saved bitcoin price/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sats/i);
  });

  it("renames, ends and merges a source through the server", async () => {
    render(<Income go={vi.fn()} />);
    const sources = await screen.findByRole("region", { name: /Where it comes from/ });
    fireEvent.click(within(sources).getAllByRole("button", { name: "Change" })[0]);
    const form = screen.getByRole("form", { name: "Change Carver & Sons Electrical" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Carver" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toContainEqual({ path: "/income/sources/1", method: "PUT", body: { name: "Carver", ended_on: null } }));
    fireEvent.click(within(sources).getAllByRole("button", { name: "Change" })[1]);
    const other = await screen.findByRole("form", { name: "Change Old job" });
    fireEvent.change(within(other).getByLabelText("Or merge into another source"), { target: { value: "1" } });
    fireEvent.click(within(other).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toContainEqual({ path: "/income/sources/2/merge", method: "POST", body: { into: 1 } }));
  });

  it("makes sense with one paycheck and with none", async () => {
    answer = { ...full, months_of_history: 1, months: [month("2026-11", "1500.00", "1500000", null)], changes: [], sources: [{ ...full.sources[0], expected: [], typical: null }] };
    const first = render(<Income go={vi.fn()} />);
    expect(await screen.findByText("$1,500.00", { selector: ".hero" })).toBeInTheDocument();
    expect(screen.getByText(/There is not enough history yet/)).toBeInTheDocument();
    expect(screen.getByText(/Trends show once there are a few months/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add the income you expect" })).toBeInTheDocument();
    first.unmount();
    answer = { ...full, status: "needs_income", sources: [], months: [], changes: [] };
    render(<Income go={vi.fn()} />);
    expect(await screen.findByText("Record your first paycheck and this screen starts working.")).toBeInTheDocument();
  });
});
