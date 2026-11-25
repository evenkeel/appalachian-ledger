import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { longPeriods, periods, reading, report } from "../test/fixture";
import { CostOfLivingPanel, MoneyFlowPanel, indexTicks } from "./history";
import type { Period } from "./history";

const show = (rows: Period[], span?: number) => {
  render(<CostOfLivingPanel data={reading} periods={rows} onWhy={() => {}} span={span} />);
  return screen.getByLabelText("Cost of living: the same life, priced two ways");
};
const spans = () => within(screen.getByRole("group", { name: "Cost of living: how much history" }));

describe("cost of living over years", () => {
  it("opens on all five years and names the first month with its year", () => {
    const panel = show(longPeriods);
    expect(panel).toHaveTextContent("Since November 2021, a month of your life costs +59.0% in dollars and −25.0% in bitcoin.");
    expect(spans().getByRole("button", { name: "All of it" })).toHaveAttribute("aria-pressed", "true");
    expect(panel).toHaveTextContent("Nov 2021 – Oct 2026");
    // The latest month is read out until another is chosen, each figure with its change since the first month.
    expect(panel).toHaveTextContent("October 2026 in dollars$3,180.00+59.0% since Nov 2021");
    expect(panel).toHaveTextContent("October 2026 in bitcoin₿3,000,000−25.0% since Nov 2021");
    // Sixty months: no dot per month, and every year marked on the axis.
    const chart = within(panel).getByRole("img");
    expect(chart.querySelectorAll("circle")).toHaveLength(0);
    expect([...chart.querySelectorAll("text.lbl")].map((node) => node.textContent)).toEqual(expect.arrayContaining(["2022", "2023", "2024", "2025", "2026"]));
    expect(chart.getAttribute("aria-label")).toBe("Monthly cost of living from November 2021 to October 2026, compared with November 2021: dollars +59.0%, bitcoin −25.0%.");
  });

  it("compares with the first month of whichever span is chosen", () => {
    const panel = show(longPeriods);
    fireEvent.click(spans().getByRole("button", { name: "One year" }));
    expect(panel).toHaveTextContent("Since November 2025, a month of your life costs +7.4% in dollars and −52.0% in bitcoin.");
    // Twelve months are few enough to mark each one.
    expect(within(panel).getByRole("img").querySelectorAll("circle")).toHaveLength(24);
    fireEvent.click(screen.getByRole("button", { name: "Earlier year" }));
    expect(panel).toHaveTextContent("From November 2024 to October 2025, the cost of a month of your life changed +8.1% in dollars and −29.7% in bitcoin.");
    expect(panel).toHaveTextContent("October 2025 in dollars$2,940.00+8.1% since Nov 2024");
  });

  it("can open on one year where a screen asks for it", () => {
    expect(show(longPeriods, 12)).toHaveTextContent("Since November 2025, a month of your life costs +7.4% in dollars and −52.0% in bitcoin.");
  });

  it("reads any month exactly from the keyboard", () => {
    const panel = show(longPeriods);
    const slider = within(panel).getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuetext", "October 2026: $3,180.00 in dollars, ₿3,000,000 in bitcoin");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuetext", "November 2021: $2,000.00 in dollars, ₿4,000,000 in bitcoin");
    for (let step = 0; step < 13; step += 1) fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "December 2022: $2,260.00 in dollars, ₿16,000,000 in bitcoin");
    expect(panel).toHaveTextContent("December 2022 in dollars$2,260.00+13.0% since Nov 2021");
    expect(panel).toHaveTextContent("December 2022 in bitcoin₿16,000,000+300.0% since Nov 2021");
  });

  it("keeps a month with a missing price out of the bitcoin line and says so when it is read", () => {
    const gappy = longPeriods.map((period, index) => (index === 30 ? { ...period, bitcoin: null, missing_bitcoin: 4 } : period));
    const panel = show(gappy);
    expect(panel).toHaveTextContent("1 month left out of the bitcoin line");
    const slider = within(panel).getByRole("slider");
    fireEvent.keyDown(slider, { key: "Home" });
    for (let step = 0; step < 30; step += 1) fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "May 2024: $2,600.00 in dollars, no saved bitcoin price");
    expect(panel).toHaveTextContent("May 2024 in bitcoinno price savedleft out of the bitcoin line");
    // The line is two strokes with the month between them left empty, never joined across.
    const bitcoinLine = within(panel).getByRole("img").querySelector('path[stroke="var(--btc)"]')!;
    expect(bitcoinLine.getAttribute("d")!.match(/M/g)).toHaveLength(2);
  });

  it("gives a month with no spending at all a place on the axis and a gap in both lines", () => {
    const skipped = longPeriods.filter((_, index) => index !== 20);
    const panel = show(skipped);
    const slider = within(panel).getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuemax", "59");
    fireEvent.keyDown(slider, { key: "Home" });
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "July 2023: nothing spent");
  });

  it("offers no span control for a short history, and still says the year", () => {
    const panel = show(periods);
    expect(panel).toHaveTextContent("Since June 2026, a month of your life costs +4.8% in dollars and −11.7% in bitcoin.");
    expect(screen.queryByRole("group", { name: "Cost of living: how much history" })).toBeNull();
  });

  it("chooses gridlines to suit the range: tens of percent for a calm year, doublings for a full cycle", () => {
    // A 150px chart fitted to the range, as the panel draws it.
    const ticks = (lo: number, hi: number) => indexTicks(lo, hi, (value) => 150 * (1 - Math.log(value / lo) / Math.log(hi / lo)));
    expect(ticks(98, 110)).toEqual([100, 105, 110]);
    expect(ticks(95, 112)).toEqual([100, 110]);
    expect(ticks(80, 130)).toEqual([80, 100, 125]);
    expect(ticks(85, 502)).toEqual([100, 200, 400]);
    expect(ticks(12, 110)).toEqual([12.5, 25, 50, 100]);
  });
});

describe("money flow for a chosen month", () => {
  const flow = (month?: string) => render(<MoneyFlowPanel data={reading} report={report} categories={[]} lens="USD" onDrill={() => {}} month={month} control={month ? <span>stepper</span> : undefined} />);

  it("names an earlier month with its year and does not call it the month so far", () => {
    flow("2023-03");
    const panel = screen.getByLabelText("Money flow: March 2023's income and where it went");
    expect(within(panel).getByRole("img").getAttribute("aria-label")).toMatch(/^Where March 2023's income went: Bitcoin stacked/);
    // Dollars left over in a month that has ended are not said to be in checking today.
    expect(panel).toHaveTextContent("Stayed in checking");
    expect(panel).not.toHaveTextContent("Still in checking");
    expect(panel.textContent).not.toMatch(/saved|surplus|savings rate/i);
  });

  it("keeps the current month's wording, with the year once the month can be chosen", () => {
    flow("2026-11");
    expect(screen.getByLabelText("Money flow: November 2026's income and where it went · month so far")).toHaveTextContent("Still in checking");
  });

  it("says so when an earlier month had no income, with the stepper still there", () => {
    render(<MoneyFlowPanel data={reading} report={{ ...report, dual: { USD: { income_categories: [], categories: [] }, BITCOIN: { income_categories: [], categories: [] } } } as never} categories={[]} lens="USD" onDrill={() => {}} month="2022-02" control={<span>stepper</span>} />);
    const panel = screen.getByLabelText("Money flow: February 2022's income and where it went");
    expect(panel).toHaveTextContent("No income was recorded in February 2022, so there is no flow to draw.");
    expect(panel).toHaveTextContent("stepper");
  });
});
