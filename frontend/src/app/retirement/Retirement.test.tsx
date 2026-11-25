import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { leverRunway, leverText, percent, readField, runwayText, span } from "./answer";
import type { Answer, RetirementSettings, RetirementView, Runway } from "./answer";

const calls: { path: string; method: string; body?: any }[] = [];
let stored: RetirementSettings;
let override: Partial<RetirementView> = {};
let fails = "";

const base: RetirementSettings = {
  birth_date: "2001-11-10",
  growth_pct: "15",
  last_age: 95,
  cost_rise_pct: "3",
  tax_pct: "10",
  other_income_usd: "0",
  other_income_age: 67,
  monthly_spending_usd: null,
  monthly_purchase_usd: null,
  use_record: true,
  measure_from: null,
  freed_to_bitcoin: true,
  category_shares: {},
  left_out_entries: [],
};
const answerFor = (settings: RetirementSettings, trying: string[]): Answer => {
  const age = settings.growth_pct === "20" ? 39 : trying.includes("buy") ? 45 : 46;
  const stop = (month: number, at: number, share: string) => ({ month, age: at, date: "2047-11-24", bitcoin: "97358113", need: "97105274", first_year_pct: share, first_month_bitcoin: "891214" });
  return {
    state: "not_yet",
    age_today: 25,
    first: stop(252, age, "10.4"),
    safe: stop(328, 52, "5.0"),
    chart: [
      { month: 0, age: "25.00", date: "2026-11-24", stack: "23529352", need: "900000000" },
      { month: 252, age: "46.00", date: "2047-11-24", stack: "97358113", need: "97105274" },
      { month: 328, age: "52.33", date: "2054-03-24", stack: "101426267", need: "48093926" },
    ],
    levers: [
      { id: "buy", label: "Buy $100 more bitcoin a month", applied: trying.includes("buy"), frees_money: false, runway_days: 0, runway_for_life: false, months_sooner: 15, reaches_age: null },
      { id: "bill-9", label: "Destroy Gym ($27 a month)", applied: false, frees_money: true, runway_days: 4, runway_for_life: false, months_sooner: 5, reaches_age: null },
    ],
    crashes: [
      { month: null, runway_months: 61, out_age: 51 },
      { month: "2017-12", runway_months: null, out_age: null },
    ],
    after: { out_age: null, points: [{ age: "46.00", bitcoin: "97358113" }, { age: "95.00", bitcoin: "0" }] },
    price_path: [{ age: "25.00", usd: "61189.97" }, { age: "95.00", usd: "137000000.00" }],
    price_in: [
      { years: 10, usd: "184199.00" },
      { years: 20, usd: "554489.00" },
      { years: 30, usd: "1669163.00" },
    ],
    projected_years: [{ year: 2027, usd: "46000.00" }],
  };
};
const runwayFor = (settings: RetirementSettings): Runway => ({
  months: settings.growth_pct === "20" ? 4 : 3,
  flat_months: 3,
  before: { date: "2025-11-24", months: 5, price_usd: "88000.00" },
  ...(settings.birth_date && {
    points: [
      { month: 0, age: "25.00", date: "2026-11-24", months: 3, exact_months: "3.4", left_months: 840 },
      { month: 246, age: "45.50", date: "2047-05-24", months: 306, exact_months: "306.2", left_months: 594 },
      { month: 252, age: "46.00", date: "2047-11-24", months: null, exact_months: null, left_months: 588 },
      { month: 276, age: "48.00", date: "2049-11-24", months: null, exact_months: null, left_months: 564 },
    ],
    milestones: [
      { months: 12, stop: { month: 62, age: 30 } },
      { months: 60, stop: { month: 170, age: 39 } },
    ],
  }),
});
function viewFor(settings: RetirementSettings, trying: string[] = []): RetirementView {
  const status = settings.birth_date === null ? "needs_birth_date" : settings.growth_pct === null ? "needs_growth" : "ready";
  return {
    as_of: "2026-11-24",
    status,
    settings,
    money_supply_pct: "6.0",
    bitcoin_record: { through: "2026-11", rows: [{ years: 5, pct: "0.5" }] },
    ledger: {
      bitcoin: "23529352",
      price_usd: "61189.97",
      rate_source: "Manual",
      rate_day: "2026-11-23",
      debts: [{ name: "Car loan", owed_usd: "6321.91", monthly_usd: "230.48" }],
      purchase_usd: "462.50",
      recorded_purchase_usd: "462.50",
      purchase_months: 12,
      spending_usd: "3454.16",
      recorded_spending_usd: "3454.16",
      spending_basis: settings.monthly_spending_usd === null ? "record" : "entered",
      spending_months: 12,
      spending_missing: 0,
      categories: [{ id: 7, name: "Health", monthly_usd: "35.59", share: settings.category_shares[7] ?? 100 }],
      one_offs: [{ id: 81, date: "2026-10-06", description: "Brakes, rotors and two tires", usd: "864.17", left_out: false }],
      years: [
        { year: 2025, start: "2024-11-01", end: "2025-10-31", usd: "37953.30", bitcoin: "38379650" },
        { year: 2026, start: "2025-11-01", end: "2026-10-31", usd: "41449.89", bitcoin: "54636757" },
      ],
      trend: { pct: "9.2", years: 2, from: 2025 },
    },
    today: { worth_usd: "14397.60", year_usd: "41449.89", year_bitcoin: "67739681", covered_months: 4, year_share_pct: "287.9", funded_pct: "2.5", hurdle_pct: null },
    runway: settings.growth_pct === null ? null : runwayFor(settings),
    answer: status === "ready" ? answerFor(settings, trying) : null,
    ...override,
  };
}
vi.mock("../lib/session", () => ({ useSession: () => ({ lens: "USD" }) }));
vi.mock("./Planner", () => ({ Planner: ({ onBack }: { onBack: () => void }) => <button onClick={onBack}>Planner here</button> }));
vi.mock("../../lib/api", () => ({
  api: vi.fn(async (path: string, method = "GET", body?: any) => {
    calls.push({ path, method, body });
    if (fails) throw new Error(fails);
    if (path === "/planning/retirement" && method === "GET") return viewFor(stored);
    if (path === "/planning/retirement/draft") return viewFor(body.settings, body.trying);
    if (path === "/planning/retirement" && method === "PUT") {
      stored = body;
      return viewFor(stored);
    }
    throw new Error(`unexpected ${method} ${path}`);
  }),
}));
import { Retirement } from "./Retirement";

const go = vi.fn();
async function open() {
  render(<Retirement go={go} />);
  await screen.findByText("Where you stand today");
}
const big = () => document.querySelector(".ret-big")!.textContent;
const ages = () => document.querySelector(".ret-ages b")!.textContent;
const draftCalls = () => calls.filter((call) => call.path.endsWith("/draft"));

beforeEach(() => {
  calls.length = 0;
  stored = { ...base };
  override = {};
  fails = "";
  go.mockClear();
});

describe("retirement age", () => {
  it("leads with runway, then the one age it reaches the rest of life", async () => {
    await open();
    expect(big()).toBe("3 months");
    expect(ages()).toBe("46");
    expect(screen.getByText("Not yet", { selector: ".tag" })).toBeInTheDocument();
    expect(screen.getByText(/growing 15% a year less your expenses, 10% tax on each sale and paying off what you owe\. A year ago it was 5 months, with ₿100,000,000 at \$88,000/)).toBeInTheDocument();
    expect(screen.getByText(/You can retire in November 2047, 21 years from now: your runway lasts the rest of your life, to 95\. The first year takes 10\.4%/)).toBeInTheDocument();
    expect(screen.getByLabelText("Bitcoin grows each year by")).toHaveValue("15");
    expect(screen.getByText(/worth \$184,199 in 10 years, \$554,489 in 20 years and \$1,669,163 in 30 years/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Runway by the age you stop. It is 3 months today and reaches the rest of your life at 46." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Your stack and the stack you need, by age. They cross at 46." })).toBeInTheDocument();
    const year = screen.getByText("1 year", { selector: "td" }).closest("tr")!;
    expect(within(year).getByText("At 30")).toBeInTheDocument();
    // Opening the screen asks once and drafts nothing.
    expect(calls).toHaveLength(1);
  });

  it("keeps the crash check in its own panel, in plain words", async () => {
    await open();
    expect(screen.queryByText(/bad start/i)).toBeNull();
    const panel = screen.getByText("If bitcoin crashes after you stop").closest("section, .panel, div")!.parentElement!;
    expect(within(panel as HTMLElement).getByText("5 years 1 month, to 51")).toBeInTheDocument();
    expect(screen.getByText("repeats what it did after December 2017").closest("tr")).toHaveTextContent("for life, to 95");
    expect(screen.getByText("Working until 52 instead would carry you through all of these.")).toBeInTheDocument();
  });

  it("works out a new rate without saving it, then saves on request", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Bitcoin grows each year by"), { target: { value: "20" } });
    await waitFor(() => expect(ages()).toBe("39"));
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save my choices" }));
    expect(await screen.findByText("Saved. Your ledger was not changed.")).toBeInTheDocument();
    expect(stored.growth_pct).toBe("20");
    expect(screen.queryByRole("button", { name: "Save my choices" })).toBeNull();
  });

  it("asks for a rate when the field is blank, and refuses a bad one", async () => {
    await open();
    const rate = screen.getByLabelText("Bitcoin grows each year by");
    fireEvent.change(rate, { target: { value: "" } });
    await waitFor(() => expect(big()).toBe("–"));
    expect(screen.getAllByText(/Enter how much you think bitcoin grows each year/).length).toBeGreaterThan(0);
    const before = draftCalls().length;
    fireEvent.change(rate, { target: { value: "500" } });
    expect(screen.getByText("Enter a number from -20 to 100")).toBeInTheDocument();
    await act(async () => new Promise((done) => setTimeout(done, 400)));
    expect(draftCalls()).toHaveLength(before);
    expect(screen.getByRole("button", { name: "Save my choices" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(rate).toHaveValue("15");
    await waitFor(() => expect(big()).toBe("3 months"));
  });

  it("starts with only a birth date to give", async () => {
    stored = { ...base, birth_date: null };
    await open();
    // Runway needs no birth date, so it is there before one is given.
    expect(big()).toBe("3 months");
    expect(screen.getByText(/With your birth date this also shows the age you can retire/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "2001-11-10" } });
    await waitFor(() => expect(ages()).toBe("46"));
    expect(draftCalls().at(-1)!.body.settings.birth_date).toBe("2001-11-10");
  });

  it("tries a lever without saving anything", async () => {
    await open();
    expect(screen.getByText("1 year 3 months sooner")).toBeInTheDocument();
    expect(screen.getByText("4 days more runway now")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Buy \$100 more bitcoin/));
    await waitFor(() => expect(ages()).toBe("45"));
    expect(draftCalls().at(-1)!.body.trying).toEqual(["buy"]);
    expect(screen.queryByRole("button", { name: "Save my choices" })).toBeNull();
  });

  it("shows the owner's own trend and what each choice uses", async () => {
    await open();
    expect(screen.getByText(/Using that for the next 2, through 2028, then 3%/)).toBeInTheDocument();
    expect(screen.getByText(/A stock investor plans with the S&P 500's long-run average/)).toBeInTheDocument();
    expect(screen.getByText(/Car loan \$6,321\.91, paid at \$230\.48 a month/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /As fast as new dollars/ }));
    await waitFor(() => expect(draftCalls().at(-1)!.body.settings.cost_rise_pct).toBe("6.0"));
    fireEvent.click(screen.getByRole("button", { name: "The standard rise" }));
    await waitFor(() => expect(draftCalls().at(-1)!.body.settings.use_record).toBe(false));
    fireEvent.change(screen.getByLabelText("Measure my costs from"), { target: { value: "2025" } });
    await waitFor(() => expect(draftCalls().at(-1)!.body.settings.measure_from).toBe(2025));
  });

  it("leaves out one-off costs and changes what continues, and undoes both", async () => {
    await open();
    fireEvent.click(screen.getByLabelText(/Brakes, rotors/));
    const health = () => screen.getByLabelText("Health, percent that continues");
    fireEvent.change(health(), { target: { value: "150" } });
    fireEvent.blur(health());
    await waitFor(() => expect(draftCalls().at(-1)!.body.settings).toMatchObject({ left_out_entries: [81], category_shares: { 7: 150 } }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(health()).toHaveValue(100);
    expect(screen.getByLabelText(/Brakes, rotors/)).not.toBeChecked();
  });

  it("treats a blank spending field as the record", async () => {
    await open();
    const field = screen.getByLabelText("Spending a month ($)");
    expect(field).toHaveAttribute("placeholder", "3454.16");
    fireEvent.change(field, { target: { value: "$4,000" } });
    await waitFor(() => expect(draftCalls().at(-1)!.body.settings.monthly_spending_usd).toBe("4000"));
    fireEvent.change(field, { target: { value: "" } });
    await waitFor(() => expect(screen.getByText(/Spending is your last 12 full months/)).toBeInTheDocument());
  });

  it("only says a stack could last for good when a year costs less than all of it", async () => {
    await open();
    expect(screen.queryByText(/your stack never runs out/)).toBeNull();
    override = { today: { ...viewFor(base).today!, year_share_pct: "7.2" } };
    document.body.innerHTML = "";
    render(<Retirement go={go} />);
    expect(await screen.findByText(/your stack never runs out/)).toBeInTheDocument();
  });

  it("opens the detailed planner and comes back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Open the detailed planner" }));
    fireEvent.click(screen.getByText("Planner here"));
    expect(await screen.findByText("Where you stand today")).toBeInTheDocument();
  });

  it("says so when the ledger cannot be read", async () => {
    fails = "The server is busy";
    render(<Retirement go={go} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The server is busy");
  });

  it("says when the stack never covers the years left", async () => {
    override = { answer: { ...answerFor(base, []), first: null, safe: null, after: null, crashes: [] } };
    await open();
    expect(ages()).toBe("–");
    expect(screen.getByText(/does not reach the rest of your life before 95/, { selector: ".ret-ages span" })).toBeInTheDocument();
    expect(screen.getByText("Nothing to check until there is a retirement age.")).toBeInTheDocument();
  });
});

describe("reading and wording", () => {
  it("reads what people type", () => {
    expect(readField("growth_pct", " 15 % ")).toEqual({ value: "15" });
    expect(readField("growth_pct", "")).toEqual({ value: null });
    expect(readField("tax_pct", "")).toEqual({ error: "Enter a number" });
    expect(readField("last_age", "95")).toEqual({ value: 95 });
    expect(readField("last_age", "95.5")).toEqual({ error: "Enter a whole age from 50 to 115" });
    expect(readField("monthly_spending_usd", "1.234")).toEqual({ error: "Use dollars and cents, like 1250.00" });
    expect(readField("growth_pct", "−5")).toEqual({ value: "-5" });
  });
  it("writes times and percentages plainly", () => {
    expect(span(43)).toBe("3 years 7 months");
    expect(span(1)).toBe("1 month");
    expect(span(0)).toBe("less than a month");
    expect(percent("5.0")).toBe("5%");
    expect(percent("10")).toBe("10%");
    expect(percent("100")).toBe("100%");
    const lever = { id: "x", label: "x", applied: false, frees_money: false, reaches_age: null, runway_days: 0, runway_for_life: false };
    expect(leverText({ ...lever, months_sooner: 0 })).toBe("no change");
    expect(leverText({ ...lever, months_sooner: -1 })).toBe("1 month later");
    expect(leverText({ ...lever, months_sooner: null, reaches_age: 61 })).toBe("to 61");
    const still = { ...lever, months_sooner: 0 };
    expect(leverRunway(still)).toBe("");
    expect(leverRunway({ ...still, runway_days: 1 })).toBe("1 day more runway now");
    expect(leverRunway({ ...still, runway_days: -100 })).toBe("3 months less runway now");
    expect(leverRunway({ ...still, runway_days: null, runway_for_life: true })).toBe("runway for life");
    expect(runwayText(null)).toBe("For life");
    expect(runwayText(0)).toBe("Under a month");
    expect(runwayText(70)).toBe("5 years 10 months");
  });
});
