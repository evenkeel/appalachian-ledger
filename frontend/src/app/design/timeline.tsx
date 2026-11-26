/* Moving through years of history: one span control, one month stepper and one way of reading a
   chart month by month, shared by every screen that draws history so they all behave alike. */
import { useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { longMonth, monthName, monthYear, shortMonthYear } from "../lib/format";
import "./timeline.css";

/** `YYYY-MM` moved by a number of months. */
export function addMonths(month: string, offset: number) {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `first` through `last`, oldest first. Empty when `first` is after `last`. */
export function monthsBetween(first: string, last: string) {
  const months: string[] = [];
  for (let month = first; month <= last && months.length < 120_000; month = addMonths(month, 1)) months.push(month);
  return months;
}

/** How many months a chart shows: a fixed number, or everything on record. */
export type Span = number | "all";
const PRESETS = [12, 24, 60, 120];
/** A span is offered only when the history is clearly longer than it; otherwise "All" already shows the same months. */
const SLACK = 2;
/** The long view opens on everything, up to this many months. */
const OPENING_CAP = 60;

export function spansFor(count: number): Span[] {
  return [...PRESETS.filter((months) => count > months + SLACK), "all"];
}
export const spanLabel = (span: Span) => (span === "all" ? "All" : `${span / 12}Y`);
const spanName = (span: Span) => (span === "all" ? "All of it" : span === 12 ? "One year" : `${span / 12} years`);

/** The span a chart opens on: everything, or the last five years of a longer ledger. A wish it cannot fill falls back to that. */
export function openingSpan(count: number, wish?: Span): Span {
  const offered = spansFor(count);
  if (wish !== undefined && offered.includes(wish)) return wish;
  return offered.includes(OPENING_CAP) ? OPENING_CAP : "all";
}

export interface Range {
  count: number;
  span: Span;
  spans: Span[];
  /** The window, as indexes into the months it was built for: `start` up to but not including `end`. */
  start: number;
  end: number;
  /** Whether the window can move a year earlier or later. */
  earlier: boolean;
  later: boolean;
  pick: (span: Span) => void;
  step: (direction: -1 | 1) => void;
}

/** Where a window of `size` months ending `back` months before the latest sits, kept inside the history. */
export function windowOf(count: number, span: Span, back: number) {
  const size = span === "all" ? count : Math.min(span, count);
  const shift = Math.max(0, Math.min(back, count - size));
  return { start: count - size - shift, end: count - shift, back: shift };
}

/** A span and a position over `count` months of history. The window moves a year at a time. */
export function useRange(count: number, wish?: Span): Range {
  const [chosen, setChosen] = useState<Span | null>(null);
  const [back, setBack] = useState(0);
  const spans = spansFor(count);
  // History that loads later, or grows, must never leave a span selected that is no longer offered.
  const span = chosen !== null && spans.includes(chosen) ? chosen : openingSpan(count, wish);
  const at = windowOf(count, span, back);
  return {
    count,
    span,
    spans,
    start: at.start,
    end: at.end,
    earlier: at.start > 0,
    later: at.back > 0,
    pick: (next) => setChosen(next),
    step: (direction) => setBack(windowOf(count, span, at.back - direction * 12).back),
  };
}

/** Previous and next, with what is showing between them. */
export function Pager({
  label,
  what,
  earlier,
  later,
  onStep,
  wide,
  children,
}: {
  /** What the buttons move, for their accessible names: "year", "month". */
  what: string;
  label?: string;
  earlier: boolean;
  later: boolean;
  onStep: (direction: -1 | 1) => void;
  /** Keeps the buttons still while a label of changing width sits between them. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`tl-pager${wide ? " tl-wide" : ""}`} role="group" aria-label={label}>
      <button type="button" className="tl-step" aria-label={`Earlier ${what}`} disabled={!earlier} onClick={() => onStep(-1)}>
        ‹
      </button>
      <span className="tl-when num">{children}</span>
      <button type="button" className="tl-step" aria-label={`Later ${what}`} disabled={!later} onClick={() => onStep(1)}>
        ›
      </button>
    </div>
  );
}

/** One of a few choices, as a row of buttons. */
export function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; name?: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="seg tl-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button type="button" key={option.value} aria-pressed={option.value === value} aria-label={option.name} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The span control: how much history a chart shows and, when that is not all of it, which years. */
export function RangeControl({ label, range, months }: { label: string; range: Range; months: string[] }) {
  if (range.spans.length < 2 || !months.length) return null;
  const first = months[range.start],
    last = months[range.end - 1];
  const moving = range.end - range.start < range.count;
  return (
    <div className="tl-range">
      {moving ? (
        <Pager label={`${label}: which months`} what="year" earlier={range.earlier} later={range.later} onStep={range.step} wide>
          {shortMonthYear(first)} – {shortMonthYear(last)}
        </Pager>
      ) : (
        <span className="tl-when num">
          {shortMonthYear(first)} – {shortMonthYear(last)}
        </span>
      )}
      <Choice
        label={`${label}: how much history`}
        options={range.spans.map((span) => ({ value: String(span), label: spanLabel(span), name: spanName(span) }))}
        value={String(range.span)}
        onChange={(value) => range.pick(value === "all" ? "all" : Number(value))}
      />
    </div>
  );
}

/** One month at a time, with a list to jump to any month on record. `months` is oldest first. */
export function MonthStepper({ label, months, value, current, onChange }: { label: string; months: string[]; value: string; current: string; onChange: (month: string) => void }) {
  const at = months.indexOf(value);
  const years = [...new Set(months.map((month) => month.slice(0, 4)))].reverse();
  return (
    <Pager label={label} what="month" earlier={at > 0} later={at >= 0 && at < months.length - 1} onStep={(direction) => onChange(months[at + direction])}>
      <select className="tl-select" aria-label={`${label}: jump to a month`} value={value} onChange={(event) => onChange(event.target.value)}>
        {years.map((year) => (
          <optgroup key={year} label={year}>
            {months
              .filter((month) => month.startsWith(year))
              .reverse()
              .map((month) => (
                <option key={month} value={month}>
                  {monthYear(month)}
                  {month === current ? " · so far" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </Pager>
  );
}

export interface AxisLabel {
  index: number;
  text: string;
  /** Where the text starts or is centred, in chart pixels. */
  x: number;
  anchor: "start" | "middle";
  /** A January: the start of a year, drawn with a line up the chart. */
  year: boolean;
}

const MONTHS_NAMED = 36;
/** Width of a 10px axis label, near enough to keep labels apart. */
const wide = (text: string) => text.length * 6.3;

/** Labels for a month axis that never collide. Each January is named by its year, written to the right of
    its line, and comes first; the first month and then other month names fill in where there is room.
    `x` is where a month sits; `yearX` is where a year begins (the left edge of January's column on a bar
    chart); nothing is written past `right`. */
export function axisLabels(
  months: string[],
  x: (index: number) => number,
  options: { yearX?: (index: number) => number; left?: number; right?: number; room?: number; startAtEdge?: boolean } = {},
): AxisLabel[] {
  const { yearX = x, left = -Infinity, right = Infinity, room = 30, startAtEdge = true } = options;
  const n = months.length;
  if (!n) return [];
  const per = n > 1 ? Math.abs(x(n - 1) - x(0)) / (n - 1) : Infinity;
  const labels: AxisLabel[] = [];
  const span = (label: Pick<AxisLabel, "x" | "anchor" | "text">) => (label.anchor === "start" ? [label.x, label.x + wide(label.text)] : [label.x - wide(label.text) / 2, label.x + wide(label.text) / 2]);
  const add = (wanted: AxisLabel) => {
    // A centred label that would run off the left edge starts at the edge instead.
    const label = span(wanted)[0] < left ? { ...wanted, x: left, anchor: "start" as const } : wanted;
    const [from, to] = span(label);
    if (to > right || labels.some((other) => from < span(other)[1] + 7 && span(other)[0] < to + 7)) return false;
    labels.push(label);
    return true;
  };
  // Years thin out to every second, fifth or tenth before they touch.
  const every = [1, 2, 5, 10].find((step) => per * 12 * step >= wide("2000") + 10) ?? 20;
  months.forEach((month, index) => {
    if (!month.endsWith("-01")) return;
    if (Number(month.slice(0, 4)) % every === 0) add({ index, text: month.slice(0, 4), x: yearX(index) + (index > 0 ? 4 : 0), anchor: "start", year: true });
  });
  if (!months[0].endsWith("-01")) {
    const at = { index: 0, x: x(0), anchor: startAtEdge ? ("start" as const) : ("middle" as const), year: false };
    // The first month says its year when it can; the year lines carry it otherwise.
    if (!add({ ...at, text: shortMonthYear(months[0]) }) && labels.length && n <= MONTHS_NAMED) add({ ...at, text: monthName(months[0]) });
  }
  // Past three years the years alone are the scale; month names between them would only be noise.
  const step = n <= MONTHS_NAMED ? [1, 2, 3, 6].find((count) => per * count >= room) : undefined;
  if (step)
    months.forEach((month, index) => {
      const number = Number(month.slice(5, 7));
      if (index === 0 || number === 1 || (number - 1) % step !== 0) return;
      add({ index, text: monthName(month), x: x(index), anchor: "middle", year: false });
    });
  return labels.sort((a, b) => a.index - b.index);
}

/** Which month a pointer is over. `left` and `right` are the plot's edges inside the chart; with `slots`
    each month owns an equal column (bars), otherwise months sit on the edges and between (lines). */
export function monthAt(px: number, width: number, count: number, left = 0, right = 0, slots = false) {
  if (count < 1) return 0;
  const span = Math.max(1, width - left - right);
  const index = slots ? Math.floor(((px - left) / span) * count) : Math.round(((px - left) / span) * (count - 1));
  return Math.max(0, Math.min(count - 1, index));
}

/** Reading a chart one month at a time: move the pointer over it, or focus it and use the arrow keys.
    The chart draws its own marker for `at`; this supplies the month and announces `text` for it. */
export function Scrub({
  label,
  count,
  at,
  onAt,
  text,
  left = 0,
  right = 0,
  slots = false,
  className = "",
  style,
  children,
}: {
  label: string;
  count: number;
  at: number | null;
  onAt: (index: number | null) => void;
  /** The exact reading for a month, spoken as the slider's value. */
  text: (index: number) => string;
  left?: number;
  right?: number;
  slots?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const last = count - 1;
  const shown = at === null ? last : Math.min(at, last);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onAt(monthAt(event.clientX - box.left, box.width, count, left, right, slots));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const move: Record<string, number> = { ArrowLeft: shown - 1, ArrowDown: shown - 1, ArrowRight: shown + 1, ArrowUp: shown + 1, PageDown: shown - 12, PageUp: shown + 12, Home: 0, End: last };
    if (event.key === "Escape") return onAt(null);
    if (!(event.key in move)) return;
    event.preventDefault();
    onAt(Math.max(0, Math.min(last, move[event.key])));
  };
  return (
    <div
      className={`tl-scrub ${className}`}
      style={style}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={shown}
      aria-valuetext={text(shown)}
      onPointerMove={point}
      onPointerDown={point}
      onPointerLeave={(event) => event.pointerType === "mouse" && onAt(null)}
      onKeyDown={key}
      onBlur={() => onAt(null)}
    >
      {children}
    </div>
  );
}

/** A year's months in words, for a year that is not whole: "November to December". */
export const partOfYear = (first: string, last: string) => (first === last ? longMonth(first) : `${longMonth(first)} to ${longMonth(last)}`);
