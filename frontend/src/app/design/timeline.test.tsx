import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MonthStepper, RangeControl, Scrub, addMonths, axisLabels, monthAt, monthsBetween, openingSpan, spansFor, useRange, windowOf } from "./timeline";
import type { Span } from "./timeline";

const fiveYears = monthsBetween("2021-11", "2026-10");

describe("months", () => {
  it("counts across year ends", () => {
    expect(addMonths("2021-11", 2)).toBe("2022-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2021-11", "2022-02")).toEqual(["2021-11", "2021-12", "2022-01", "2022-02"]);
    expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
    expect(fiveYears).toHaveLength(60);
  });
});

describe("the span a chart shows", () => {
  it("offers only spans the history is clearly longer than, and always all of it", () => {
    expect(spansFor(0)).toEqual(["all"]);
    expect(spansFor(6)).toEqual(["all"]);
    // Fourteen months is not worth a separate one-year view; fifteen is.
    expect(spansFor(14)).toEqual(["all"]);
    expect(spansFor(15)).toEqual([12, "all"]);
    expect(spansFor(60)).toEqual([12, 24, "all"]);
    expect(spansFor(61)).toEqual([12, 24, "all"]);
    expect(spansFor(75)).toEqual([12, 24, 60, "all"]);
    expect(spansFor(200)).toEqual([12, 24, 60, 120, "all"]);
  });

  it("opens on everything, or on five years of a longer ledger, unless a span it can fill is asked for", () => {
    expect(openingSpan(5)).toBe("all");
    expect(openingSpan(60)).toBe("all");
    expect(openingSpan(96)).toBe(60);
    expect(openingSpan(60, 12)).toBe(12);
    // One year cannot be told apart from all of a ten-month ledger.
    expect(openingSpan(10, 12)).toBe("all");
  });

  it("keeps the window inside the history however far it is moved", () => {
    expect(windowOf(60, "all", 0)).toEqual({ start: 0, end: 60, back: 0 });
    expect(windowOf(60, 12, 0)).toEqual({ start: 48, end: 60, back: 0 });
    expect(windowOf(60, 12, 12)).toEqual({ start: 36, end: 48, back: 12 });
    expect(windowOf(60, 24, 999)).toEqual({ start: 0, end: 24, back: 36 });
    expect(windowOf(60, 12, -5)).toEqual({ start: 48, end: 60, back: 0 });
    expect(windowOf(8, 12, 0)).toEqual({ start: 0, end: 8, back: 0 });
  });

  function Harness({ months, wish }: { months: string[]; wish?: Span }) {
    const range = useRange(months.length, wish);
    return (
      <>
        <RangeControl label="Cost of living" range={range} months={months} />
        <output>
          {months[range.start]} to {months[range.end - 1]}
        </output>
      </>
    );
  }

  it("moves a year at a time and stops at either end of the history", () => {
    render(<Harness months={fiveYears} />);
    const spans = within(screen.getByRole("group", { name: "Cost of living: how much history" }));
    expect(spans.getAllByRole("button").map((button) => button.textContent)).toEqual(["1Y", "2Y", "All"]);
    expect(spans.getByRole("button", { name: "All of it" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("2021-11 to 2026-10");
    // All of it has nowhere to move to, so there is no pager.
    expect(screen.queryByRole("button", { name: "Earlier year" })).toBeNull();
    expect(screen.getByText("Nov 2021 – Oct 2026")).toBeInTheDocument();

    fireEvent.click(spans.getByRole("button", { name: "One year" }));
    expect(screen.getByRole("status")).toHaveTextContent("2025-11 to 2026-10");
    expect(screen.getByRole("button", { name: "Later year" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Earlier year" }));
    expect(screen.getByRole("status")).toHaveTextContent("2024-11 to 2025-10");
    expect(screen.getByText("Nov 2024 – Oct 2025")).toBeInTheDocument();
    for (let step = 0; step < 6; step += 1) fireEvent.click(screen.getByRole("button", { name: "Earlier year" }));
    expect(screen.getByRole("status")).toHaveTextContent("2021-11 to 2022-10");
    expect(screen.getByRole("button", { name: "Earlier year" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Later year" }));
    expect(screen.getByRole("status")).toHaveTextContent("2022-11 to 2023-10");
    // A longer span from the same place stays inside the history.
    fireEvent.click(spans.getByRole("button", { name: "2 years" }));
    expect(screen.getByRole("status")).toHaveTextContent("2021-11 to 2023-10");
  });

  it("shows no control when there is only one span to offer", () => {
    const { container } = render(<Harness months={monthsBetween("2026-06", "2026-10")} />);
    expect(container.querySelector(".tl-range")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("2026-06 to 2026-10");
  });
});

describe("month stepper", () => {
  it("steps a month at a time and jumps to any month on record, each named with its year", () => {
    const months = monthsBetween("2025-11", "2026-11");
    const onChange = vi.fn();
    const { rerender } = render(<MonthStepper label="Money flow month" months={months} value="2026-11" current="2026-11" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Later month" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Earlier month" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-10");
    const jump = screen.getByRole("combobox", { name: "Money flow month: jump to a month" });
    const options = within(jump).getAllByRole("option").map((option) => option.textContent);
    expect(options[0]).toBe("November 2026 · so far");
    expect(options[options.length - 1]).toBe("November 2025");
    expect(within(jump).getAllByRole("group").map((group) => group.getAttribute("label"))).toEqual(["2026", "2025"]);
    fireEvent.change(jump, { target: { value: "2025-12" } });
    expect(onChange).toHaveBeenLastCalledWith("2025-12");
    rerender(<MonthStepper label="Money flow month" months={months} value="2025-11" current="2026-11" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Earlier month" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Later month" }));
    expect(onChange).toHaveBeenLastCalledWith("2025-12");
  });
});

describe("a month axis", () => {
  const texts = (months: string[], width: number) => {
    const x = (index: number) => (index / (months.length - 1)) * width;
    return axisLabels(months, x, { right: width }).map((label) => label.text);
  };

  it("marks every year over five years, and names no months", () => {
    const labels = axisLabels(fiveYears, (index) => (index / 59) * 600, { right: 600 });
    expect(labels.filter((label) => label.year).map((label) => label.text)).toEqual(["2022", "2023", "2024", "2025", "2026"]);
    expect(labels.every((label) => label.year)).toBe(true);
    // No two labels touch.
    labels.slice(1).forEach((label, index) => expect(label.x - labels[index].x).toBeGreaterThan(30));
  });

  it("names the first month with its year when there is room, and fills in months on a short span", () => {
    // The last month would run past the right edge of this chart, so it is left unnamed.
    expect(texts(monthsBetween("2025-11", "2026-10"), 600)).toEqual(["Nov 2025", "2026", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]);
    // With no January in view the first month still says which year this is.
    expect(texts(monthsBetween("2026-06", "2026-10"), 300)[0]).toBe("Jun 2026");
  });

  it("thins years out before they touch on a narrow chart", () => {
    const tenYears = monthsBetween("2016-01", "2026-10");
    // 2026 begins too close to the right edge to be written.
    expect(texts(tenYears, 240)).toEqual(["2016", "2018", "2020", "2022", "2024"]);
  });
});

describe("reading a chart month by month", () => {
  it("finds the month under the pointer for lines and for bars", () => {
    // Lines: months sit on the plot's edges and evenly between.
    expect(monthAt(40, 500, 61, 40, 60)).toBe(0);
    expect(monthAt(440, 500, 61, 40, 60)).toBe(60);
    expect(monthAt(240, 500, 61, 40, 60)).toBe(30);
    expect(monthAt(-20, 500, 61, 40, 60)).toBe(0);
    expect(monthAt(999, 500, 61, 40, 60)).toBe(60);
    // Bars: each month owns a column.
    expect(monthAt(0, 600, 12, 0, 0, true)).toBe(0);
    expect(monthAt(49, 600, 12, 0, 0, true)).toBe(0);
    expect(monthAt(50, 600, 12, 0, 0, true)).toBe(1);
    expect(monthAt(599, 600, 12, 0, 0, true)).toBe(11);
  });

  it("is one slider: arrow keys move a month, Page keys a year, and each month is spoken exactly", () => {
    function Chart() {
      const [at, setAt] = useState<number | null>(null);
      return (
        <Scrub label="Bitcoin held by month" count={60} at={at} onAt={setAt} text={(index) => `month ${fiveYears[index]}`}>
          <svg />
        </Scrub>
      );
    }
    render(<Chart />);
    const slider = screen.getByRole("slider", { name: "Bitcoin held by month" });
    // Before anything is chosen it reads the latest month.
    expect(slider).toHaveAttribute("aria-valuetext", "month 2026-10");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuetext", "month 2026-09");
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(slider).toHaveAttribute("aria-valuetext", "month 2025-09");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuetext", "month 2021-11");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "59");
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(slider).toHaveAttribute("aria-valuetext", "month 2026-10");
  });
});
