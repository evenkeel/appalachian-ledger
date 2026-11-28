/* Panels that need history: Cost of living, Spending bridge and Money flow.
   All sums stay in integers or decimal strings; numbers are for coordinates only. */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { analyzeSpending } from "../../lib/spendingAnalysis";
import type { SpendingAnalysis } from "../../lib/spendingAnalysis";
import type { Category, Report, Transaction } from "../../lib/types";
import { Scrub, axisLabels, monthsBetween, RangeControl, useRange } from "../design/timeline";
import type { Span } from "../design/timeline";
import { PrivateTspans, Private, Tip } from "../lib/privacy";
import { btc, cents, fromCents, longMonth, monthName, monthYear, plural, shortMonthYear, usd } from "../lib/format";
import type { Lens } from "../lib/session";
import { measureText, useFontsReady } from "../lib/measureText";
import { useSize } from "../lib/useSize";
import { Frame, NO_LAYOUT, shift } from "./charts";
import { PART_GAP, layoutFlow } from "./flowLayout";
import type { FlowPlaced } from "./flowLayout";
import { Collecting, Panel } from "./panels";
import type { DashboardData } from "./types";

export interface Period {
  period: string;
  usd: string | null;
  bitcoin: string | null;
  missing_bitcoin: number;
}
export interface SpendingData {
  transactions: Transaction[];
  categories: Category[];
  report: Report | null;
  /** Full months only, oldest first. */
  periods: Period[];
  error: string;
  reload: () => void;
}

export const lastDay = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}`;
};

/** Everything the history panels and the Spending screen read, in three requests. */
export function useSpendingData(data: DashboardData | null): SpendingData {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const month = data?.month,
    first = data?.first_entry_date ?? null;
  useEffect(() => {
    if (!month) return;
    let alive = true;
    const previous = shift(month, -1);
    // The first full month is the one the ledger started in only if it started on the 1st.
    const start = first && (first.endsWith("-01") ? first.slice(0, 7) : shift(first.slice(0, 7), 1));
    (async () => {
      try {
        const [rows, cats, monthReport] = await Promise.all([
          api<Transaction[]>(`/transactions?start=${previous}-01`),
          api<Category[]>("/categories"),
          api<Report>(`/reports?month=${month}&months=1&denomination=USD`),
        ]);
        if (!alive) return;
        setTransactions(rows);
        setCategories(cats);
        setReport(monthReport);
        if (start && start <= previous) {
          // Every full month on record, as sums only: the panel chooses its own span from these.
          const history = await api<{ periods: Period[] }>(`/spending-history?start=${start}-01&end=${lastDay(previous)}&interval=month&summary=true`);
          if (alive) setPeriods(history.periods);
        } else setPeriods([]);
        setError("");
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month, first, tick, data?.bills.paid_this_month.count]);
  return { transactions, categories, report, periods, error, reload: () => setTick((n) => n + 1) };
}

const signed = (percent: number) => `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`;

/** Gridlines for an index drawn on a proportional scale, as index values (100 is the start). The steps
    widen with the range, so a calm year gets tens of percent and a full cycle gets doublings and halvings. */
export function indexTicks(lo: number, hi: number, y: (value: number) => number, gap = 24) {
  const ratio = hi / lo;
  const changes =
    ratio >= 4
      ? [-93.75, -87.5, -75, -50, 100, 300, 700, 1500, 3100]
      : ratio >= 2
        ? [-75, -50, -25, 50, 100, 200, 300, 500]
        : ratio >= 1.4
          ? [-40, -20, 25, 50, 75, 100]
          : ratio >= 1.15
            ? [-30, -20, -10, 10, 20, 30, 40, 50]
            : [-10, -5, 5, 10, 15];
  const kept = [100];
  // Nearest the start first, so a crowded chart keeps the lines that are easiest to read against.
  for (const value of changes.map((change) => 100 + change).sort((a, b) => Math.abs(Math.log(a / 100)) - Math.abs(Math.log(b / 100))))
    if (value >= lo && value <= hi && kept.every((other) => Math.abs(y(other) - y(value)) >= gap)) kept.push(value);
  return kept.sort((a, b) => a - b);
}
const tickText = (value: number) => (value === 100 ? "0%" : `${value > 100 ? "+" : "−"}${Number(Math.abs(value - 100).toFixed(2))}%`);

/** The same monthly cost of living, indexed to the first full month of the span shown, in both units. */
export function CostOfLivingPanel({
  className,
  data,
  periods,
  onWhy,
  span,
}: {
  className?: string;
  data: DashboardData;
  periods: Period[];
  onWhy: () => void;
  /** The span to open on, where the history can fill it. Without one: everything, up to five years. */
  span?: Span;
}) {
  // One entry per calendar month, so that a year is the same width wherever it falls. A month with no row spent nothing.
  const calendar = useMemo(() => {
    if (!periods.length) return [];
    const known = new Map(periods.map((period) => [period.period, period]));
    return monthsBetween(periods[0].period, periods[periods.length - 1].period).map((month) => known.get(month) ?? { period: month, usd: "0.00", bitcoin: "0", missing_bitcoin: 0 });
  }, [periods]);
  const range = useRange(calendar.length, span);
  const [at, setAt] = useState<number | null>(null);
  const name = "Cost of living",
    plain = "the same life, priced two ways";
  const spent = (p: Period) => p.usd !== null && cents(p.usd) > 0n;
  const priced = (p: Period) => spent(p) && p.bitcoin !== null && p.missing_bitcoin === 0;
  if (calendar.filter(spent).length < 2 || calendar.filter(priced).length < 2)
    return (
      <Collecting
        className={className}
        name={name}
        plain={plain}
        have={data.days_of_history}
        need={60}
        note={
          calendar.filter(spent).length >= 2
            ? "Two full months are recorded, but their expenses have no saved bitcoin prices yet. Choose a price source to price them."
            : "Needs two full months and a price source."
        }
      />
    );
  const control = <RangeControl label={name} range={range} months={calendar.map((p) => p.period)} />;
  const shown = calendar.slice(range.start, range.end);
  // The span starts at its first month that is priced in both units; every month after it is compared with that one.
  const base = shown.find(priced);
  const months = base ? shown.slice(shown.indexOf(base)) : [];
  const last = [...months].reverse().find(spent),
    lastPriced = [...months].reverse().find(priced);
  if (!base || !last || !lastPriced || last === base || lastPriced === base)
    return (
      <Panel className={className} name={name} plain={plain} link={{ label: "Why", onClick: onWhy }}>
        {control}
        <div className="sub">These months do not have two with spending and saved bitcoin prices, so there is nothing to compare. Choose a longer span.</div>
      </Panel>
    );
  const n = months.length;
  const indexUsd = months.map((p) => (spent(p) ? (Number(p.usd) / Number(base.usd)) * 100 : null));
  const indexBtc = months.map((p) => (priced(p) ? (Number(p.bitcoin) / Number(base.bitcoin)) * 100 : null));
  const dollars = indexUsd[months.indexOf(last)]! - 100;
  const bitcoin = indexBtc[months.indexOf(lastPriced)]! - 100;
  const partial = months.filter((p) => spent(p) && !priced(p)).length;
  const active = at === null ? null : months[Math.min(at, n - 1)];
  const since = shortMonthYear(base.period);
  const change = (values: (number | null)[], month: Period) => {
    const value = values[months.indexOf(month)];
    return value === null ? null : `${signed(value - 100)} since ${since}`;
  };
  const reading = (index: number) => {
    const p = months[index];
    return `${monthYear(p.period)}: ${spent(p) ? `${usd(p.usd)} in dollars` : "nothing spent"}${spent(p) ? `, ${priced(p) ? `${btc(p.bitcoin)} in bitcoin` : "no saved bitcoin price"}` : ""}`;
  };
  const inDollars = active ?? last,
    inBitcoin = active ?? lastPriced;
  const all = [...indexUsd, ...indexBtc].filter((v): v is number => v !== null);
  const low = Math.min(...all),
    high = Math.max(...all);
  const pad = { l: 42, r: 60, t: 14, b: 20 };
  return (
    <Panel className={className} name={name} plain={plain} link={{ label: "Why", onClick: onWhy }}>
      <div className="lead">
        {range.later ? (
          <>
            From {monthYear(base.period)} to {monthYear(last.period)}, the cost of a month of your life changed
          </>
        ) : (
          <>Since {monthYear(base.period)}, a month of your life costs</>
        )}{" "}
        <b className="num">{signed(dollars)}</b> in dollars and <b className="num btc">{signed(bitcoin)}</b> in bitcoin.
      </div>
      {control}
      <Scrub
        label={`Cost of living by month, ${monthYear(base.period)} to ${monthYear(last.period)}. Arrow keys read each month.`}
        count={n}
        at={at === null ? null : Math.min(at, n - 1)}
        onAt={setAt}
        text={reading}
        left={pad.l}
        right={pad.r}
        style={{ flex: 1, minHeight: 190 }}
      >
        <Frame
          style={{ flex: 1, minHeight: 190 }}
          label={`Monthly cost of living from ${monthYear(base.period)} to ${monthYear(last.period)}, compared with ${monthYear(base.period)}: dollars ${signed(dollars)}, bitcoin ${signed(bitcoin)}.`}
        >
          {(W, H) => {
            // A proportional scale: doubling and halving are the same distance from the start, so a fall reads as large as a rise.
            const room = Math.max(1.05, (high / low) ** 0.07);
            const bottom = Math.log(low / room),
              top = Math.log(high * room);
            const x = (i: number) => pad.l + (n > 1 ? i / (n - 1) : 0) * (W - pad.l - pad.r);
            const y = (v: number) => pad.t + (1 - (Math.log(v) - bottom) / (top - bottom)) * (H - pad.t - pad.b);
            const line = (values: (number | null)[]) => {
              let pen = false;
              return values
                .map((v, i) => {
                  if (v === null) {
                    pen = false;
                    return "";
                  }
                  const segment = `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
                  pen = true;
                  return segment;
                })
                .join("");
            };
            // With a dot on every month a long span turns to beads; then only a month with no neighbour needs one to be seen.
            const dots = (values: (number | null)[]) => values.map((v, i) => v !== null && (n <= 13 || ((values[i - 1] ?? null) === null && (values[i + 1] ?? null) === null)));
            const usdDots = dots(indexUsd),
              btcDots = dots(indexBtc);
            const labels = axisLabels(
              months.map((p) => p.period),
              x,
              { right: W - 4 },
            );
            const ends = [
              { key: "usd", name: "Dollars", text: signed(dollars), index: months.indexOf(last), value: dollars + 100, fill: "var(--usd)", weight: 400 },
              { key: "btc", name: "Bitcoin", text: signed(bitcoin), index: months.indexOf(lastPriced), value: bitcoin + 100, fill: "var(--btc)", weight: 700 },
            ].map((end) => ({ ...end, at: y(end.value) }));
            // Two-line labels need 28px each; when the lines end close together the labels part evenly around them.
            const [upper, lower] = [...ends].sort((a, b) => a.at - b.at);
            const short = 28 - (lower.at - upper.at);
            if (short > 0) {
              upper.at -= short / 2;
              lower.at += short / 2;
            }
            const floor = H - pad.b - 12;
            if (lower.at > floor) {
              upper.at -= lower.at - floor;
              lower.at = floor;
            }
            if (upper.at < pad.t) {
              lower.at += pad.t - upper.at;
              upper.at = pad.t;
            }
            const mark = at === null ? null : Math.min(at, n - 1);
            return (
              <>
                {indexTicks(low, high, y).map((value) => (
                  <g key={value}>
                    <line x1={pad.l} x2={W - pad.r} y1={y(value)} y2={y(value)} stroke={value === 100 ? "var(--bezel)" : "var(--hairline)"} strokeDasharray={value === 100 ? "3 4" : undefined} />
                    <text x={pad.l - 6} y={y(value) + 3.5} textAnchor="end" className={value === 100 ? "lbl" : undefined}>
                      {tickText(value)}
                    </text>
                  </g>
                ))}
                {months.map((p, i) => p.period.endsWith("-01") && i > 0 && <line key={p.period} x1={x(i)} x2={x(i)} y1={pad.t - 6} y2={H - pad.b + 12} stroke="var(--hairline)" />)}
                {labels.map((label) => (
                  <text key={label.index} x={label.x} y={H - 4} textAnchor={label.anchor} className={label.year ? "lbl" : undefined}>
                    {label.text}
                  </text>
                ))}
                <path d={line(indexUsd)} fill="none" stroke="var(--usd)" strokeWidth="2" strokeLinejoin="round" />
                <path d={line(indexBtc)} fill="none" stroke="var(--btc)" strokeWidth="2.4" strokeLinejoin="round" />
                {months.map((p, i) => (
                  <g key={p.period}>
                    {usdDots[i] && <circle cx={x(i)} cy={y(indexUsd[i]!)} r="3" fill="var(--usd)" />}
                    {btcDots[i] && <circle cx={x(i)} cy={y(indexBtc[i]!)} r="3" fill="var(--btc)" />}
                  </g>
                ))}
                {ends.map((end) => (
                  <text key={end.key} x={x(end.index) + 8} y={end.at} style={{ fill: end.fill, fontSize: 11, fontWeight: end.weight }}>
                    <tspan x={x(end.index) + 8}>{end.name}</tspan>
                    <tspan x={x(end.index) + 8} dy="12">
                      {end.text}
                    </tspan>
                  </text>
                ))}
                {mark !== null && (
                  <g>
                    <line x1={x(mark)} x2={x(mark)} y1={pad.t - 6} y2={H - pad.b} stroke="var(--ink-2)" />
                    {indexUsd[mark] !== null && <circle cx={x(mark)} cy={y(indexUsd[mark]!)} r="4" fill="var(--usd)" stroke="var(--panel)" strokeWidth="1.5" />}
                    {indexBtc[mark] !== null && <circle cx={x(mark)} cy={y(indexBtc[mark]!)} r="4" fill="var(--btc)" stroke="var(--panel)" strokeWidth="1.5" />}
                  </g>
                )}
              </>
            );
          }}
        </Frame>
      </Scrub>
      <div className="kv">
        <div>
          <span>{monthYear(inDollars.period)} in dollars</span>
          <b>{spent(inDollars) ? usd(inDollars.usd) : "Nothing spent"}</b>
          <small>{change(indexUsd, inDollars) ?? "—"}</small>
        </div>
        <div>
          <span>{monthYear(inBitcoin.period)} in bitcoin</span>
          <b className="btc">{priced(inBitcoin) ? <Private>{btc(inBitcoin.bitcoin)}</Private> : spent(inBitcoin) ? <span className="tag miss">no price saved</span> : "—"}</b>
          <small>{change(indexBtc, inBitcoin) ?? (spent(inBitcoin) ? "left out of the bitcoin line" : "—")}</small>
        </div>
      </div>
      <div className="hint">
        Full months only. Each expense is priced in bitcoin on the day it was paid. It can go the other way; this shows what happened.
        {high / low >= 2 && " The scale is proportional: +100% and −50% sit the same distance from the start."}
        {partial > 0 && ` ${plural(partial, "month")} left out of the bitcoin line: some expenses have no saved price.`}
      </div>
    </Panel>
  );
}

export function useAnalysis(spending: SpendingData, data: DashboardData, lens: Lens): SpendingAnalysis {
  return useMemo(
    () => analyzeSpending({ transactions: spending.transactions, categories: spending.categories, month: data.month, unit: lens, now: new Date(`${data.today}T12:00:00`) }),
    [spending.transactions, spending.categories, data.month, data.today, lens],
  );
}

/** Which categories carry last month's total to this month's, over the same days. */
export function BridgePanel({
  className,
  data,
  analysis,
  lens,
  selected,
  onDrill,
  onExplore,
}: {
  className?: string;
  data: DashboardData;
  analysis: SpendingAnalysis;
  lens: Lens;
  selected?: string | null;
  onDrill: (categoryKey: string) => void;
  onExplore?: () => void;
}) {
  const prior = longMonth(analysis.previousMonth);
  const money = (value: bigint) => (lens === "USD" ? usd(fromCents(value)) : btc(value.toString()));
  const hadPrevious = analysis.previousRows.length > 0;
  if (!hadPrevious)
    return <Collecting className={className} name="Spending bridge" plain="what changed since last month" have={data.days_of_history} need={30} note="Needs spending in the previous month to compare against." />;
  const name = "Spending bridge",
    plain = `what changed since ${prior}`;
  if (analysis.current.value === null || analysis.previous.value === null) {
    const missing = analysis.current.missing + analysis.previous.missing;
    return (
      <Panel className={className} name={name} plain={plain}>
        <div className="sub">
          <span className="tag miss">partial</span> {plural(missing, "expense")} in these two months {missing === 1 ? "has" : "have"} no saved bitcoin price, so the bitcoin
          bridge cannot be drawn. Nothing is guessed. Switch to <b>$</b> to see it in dollars.
        </div>
      </Panel>
    );
  }
  const steps = analysis.waterfall;
  const colour = lens === "USD" ? "var(--usd)" : "var(--btc)";
  const range = `1–${analysis.previousCutoff}`;
  return (
    <Panel className={className} name={name} plain={plain} link={onExplore && { label: "Explore", onClick: onExplore }}>
      {steps.length === 0 ? (
        <div className="sub">
          Spending matches {prior} to the {lens === "USD" ? "cent" : "bitcoin"}: <Private when={lens === "BITCOIN"}>{money(analysis.current.value)}</Private>.
        </div>
      ) : (
        <Frame
          height={22 + 24 * steps.length + 26}
          label={`Change from ${prior} to ${longMonth(analysis.month)} over the same days, by category. Total ${money(analysis.current.value - analysis.previous.value)}.`}
        >
          {(W) => {
            const rowH = 24,
              top = 22,
              label = Math.min(120, W * 0.3),
              valueW = 92;
            const ends = steps.flatMap((s) => [s.start, s.end]).concat(analysis.previous.value!, analysis.current.value!).map(Number);
            const lo = Math.min(...ends),
              hi = Math.max(...ends),
              padV = (hi - lo) * 0.12 || 1;
            const x = (v: bigint | number) => label + ((Number(v) - (lo - padV)) / (hi - lo + padV * 2)) * (W - label - valueW);
            const endY = top + steps.length * rowH;
            const px = x(analysis.previous.value!),
              cx = x(analysis.current.value!);
            return (
              <>
                <line x1={px} x2={px} y1={top - 6} y2={top + 5} stroke="var(--ink-2)" strokeWidth="2" />
                <text x={px} y={top - 10} textAnchor={px > W / 2 ? "end" : "start"}>
                  {monthName(analysis.previousMonth)} {range} · <PrivateTspans text={money(analysis.previous.value!)} />
                </text>
                {steps.map((step, i) => {
                  const yy = top + i * rowH,
                    up = step.change > 0n,
                    size = up ? step.change : -step.change;
                  const x0 = x(step.start < step.end ? step.start : step.end),
                    w = Math.max(2, Math.abs(x(step.end) - x(step.start)));
                  const active = selected != null && step.keys.includes(selected);
                  return (
                    <g
                      key={step.key}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      aria-label={`${step.name}: ${money(size)} ${up ? "more" : "less"} than ${prior}. Show its transactions.`}
                      onClick={() => onDrill(step.keys[0])}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onDrill(step.keys[0]);
                        }
                      }}
                    >
                      <rect x="0" y={yy} width={W} height={rowH} fill={active ? "var(--panel-2)" : "transparent"} />
                      <text className="lbl" x="0" y={yy + 15} style={{ fontFamily: "var(--font-ui)", fontSize: 12 }}>
                        {step.name}
                      </text>
                      <rect x={x0} y={yy + 5} width={w} height={rowH - 10} rx="2" fill={up ? colour : "none"} stroke={colour} strokeWidth="1.4" strokeDasharray={up ? undefined : "3 2"} />
                      <text x={W} y={yy + 15} textAnchor="end" className="lbl">
                        <PrivateTspans text={`${up ? "+" : "−"}${money(size)}`} />
                      </text>
                    </g>
                  );
                })}
                <line x1={cx} x2={cx} y1={endY - 5} y2={endY + 8} stroke={colour} strokeWidth="2.5" />
                <text x={cx} y={endY + 21} textAnchor={cx > W / 2 ? "end" : "start"} className="lbl" style={{ fontWeight: 700 }}>
                  {monthName(analysis.month)} 1–{analysis.cutoff} · <PrivateTspans text={money(analysis.current.value!)} />
                </text>
              </>
            );
          }}
        </Frame>
      )}
      <div className="key">
        <span>
          <i style={{ background: colour }} />
          Spent more
        </span>
        <span>
          <i style={{ border: `1.4px dashed ${colour}` }} />
          Spent less
        </span>
        <span className="dim">Same days of each month</span>
      </div>
    </Panel>
  );
}

interface Stream {
  key: string;
  name: string;
  value: string;
  label?: string;
  kind: "stack" | "spend" | "move" | "rest";
  drill?: string;
}

/** One month, source to destination. Bitcoin stacked is first and is the only bright stream. */
export function MoneyFlowPanel({
  className,
  data,
  report,
  categories,
  lens,
  onDrill,
  onExplore,
  month = data.month,
  control,
  loading,
}: {
  className?: string;
  data: DashboardData;
  report: Report | null;
  categories: Category[];
  lens: Lens;
  onDrill: (categoryKey: string) => void;
  onExplore?: () => void;
  /** The month `report` is for, where the screen lets it be chosen. Then it is always named with its year. */
  month?: string;
  /** The control that chooses the month, shown under the heading in every state. */
  control?: ReactNode;
  loading?: boolean;
}) {
  const current = month === data.month;
  const named = control ? monthYear(month) : longMonth(month);
  const name = "Money flow",
    plain = `${named}'s income and where it went${current ? " · month so far" : ""}`;
  const flow = report?.dual?.[lens];
  const money = lens === "USD" ? usd : btc;
  const positive = (rows: { name: string; value: string | null }[] = []) => rows.filter((row): row is { name: string; value: string } => row.value !== null && Number(row.value) > 0);
  const sources = positive(flow?.income_categories),
    spending = positive(flow?.categories).sort((a, b) => Number(b.value) - Number(a.value));
  const left = (flow?.income_categories?.length ?? 0) + (flow?.categories.length ?? 0) - sources.length - spending.length;
  if (loading)
    return (
      <Panel className={className} name={name} plain={plain}>
        {control}
        <div className="meter" aria-busy="true">
          <i style={{ width: "100%", opacity: 0.25 }} />
        </div>
      </Panel>
    );
  if (!flow || !sources.length)
    return (
      <Panel className={className} name={name} plain={plain} inop={current}>
        {control}
        <div className="sub">
          {current
            ? "Record this month's income and one expense, and this shows where the income went: bitcoin stacked first, then spending, then what is still in checking."
            : `No income was recorded in ${named}, so there is no flow to draw.`}
        </div>
      </Panel>
    );
  const stacked = report!.stacked;
  const stackValue = lens === "USD" ? (stacked?.usd ?? "0") : (stacked?.bitcoin ?? "0");
  // Other moves are recorded in dollars; in the bitcoin view they are left out rather than converted at a guessed price.
  const moved = lens === "USD" ? (stacked?.other_usd ?? "0") : "0";
  // Exact minor units: cents, or whole bitcoin.
  const units = (value: string) => (lens === "USD" ? cents(value) : BigInt(value.split(".")[0]));
  const income = sources.reduce((sum, row) => sum + units(row.value), 0n);
  const dests: Stream[] = [];
  if (Number(stackValue) > 0)
    dests.push({ key: "stack", name: "Bitcoin stacked", value: stackValue, kind: "stack", label: lens === "USD" ? `${btc(stacked!.bitcoin)} · ${usd(stackValue)}` : btc(stackValue) });
  for (const row of spending) dests.push({ key: `c-${row.name}`, name: row.name, value: row.value, kind: "spend", drill: String(categories.find((c) => c.name === row.name && c.kind === "expense")?.id ?? "") });
  if (Number(moved) > 0) dests.push({ key: "moved", name: "Other moves out", value: moved, kind: "move" });
  const out = dests.reduce((sum, d) => sum + units(d.value), 0n);
  const rest = income - out;
  const restText = lens === "USD" ? fromCents(rest < 0n ? -rest : rest) : (rest < 0n ? -rest : rest).toString();
  // A month that is over cannot say where its dollars are today, only that they were not spent or stacked then.
  if (rest > 0n) dests.push({ key: "rest", name: current ? "Still in checking" : "Stayed in checking", value: restText, kind: "rest" });
  // Largest income first; money drawn from cash on hand goes last.
  const origins = [...sources].sort((a, b) => Number(b.value) - Number(a.value));
  if (rest < 0n) origins.push({ name: "From cash on hand", value: restText });
  return (
    <Panel className={className} name={name} plain={plain} link={onExplore && { label: "Explore", onClick: onExplore }}>
      {control}
      <FlowChart
        label={`Where ${named}'s income went: ${dests.map((d) => `${d.name} ${d.label ?? money(d.value)}`).join(", ")}.`}
        origins={origins}
        dests={dests}
        money={money}
        size={(value) => Number(units(value))}
        onDrill={onDrill}
        restNote={current ? "Not assigned yet: dollars waiting, not savings." : "Dollars that were not spent or stacked that month: waiting, not savings."}
      />
      {(left > 0 || (lens === "BITCOIN" && Number(stacked?.other_usd ?? "0") > 0)) && (
        <div className="hint">
          {left > 0 && `${plural(left, "category")} left out because a conversion is unavailable. `}
          {lens === "BITCOIN" && Number(stacked?.other_usd ?? "0") > 0 && "Moves to other dollar accounts are shown in the dollar view only; they are not converted at a guessed price."}
        </div>
      )}
    </Panel>
  );
}

const ribbon = (x0: number, a0: number, a1: number, x1: number, b0: number, b1: number) => {
  const mid = (x0 + x1) / 2;
  return `M${x0},${a0}C${mid},${a0} ${mid},${b0} ${x1},${b0}L${x1},${b1}C${mid},${b1} ${mid},${a1} ${x0},${a1}Z`;
};

/** Label rows as SVG text. Positions and sizes come from the layout; this only adds colour. */
function FlowLabel({ placed, fill }: { placed: FlowPlaced; fill: (kind: "name" | "value") => string }) {
  return (
    <>
      {placed.rows.map((row, index) => (
        <text key={index} x={placed.x} y={row.y} textAnchor={placed.anchor}>
          {row.parts.map((part, at) => (
            <tspan
              key={part.kind}
              dx={at ? PART_GAP : undefined}
              style={{ fontFamily: part.kind === "name" ? "var(--font-ui)" : "var(--font-num)", fontSize: part.size, fontWeight: part.weight, fill: fill(part.kind) }}
            >
              {part.kind === "value" ? <PrivateTspans text={part.text} /> : part.text}
            </tspan>
          ))}
        </text>
      ))}
    </>
  );
}

/** The flow drawing. It measures its own width so that it can choose its height and label columns before drawing. */
function FlowChart({
  label,
  origins,
  dests,
  money,
  size,
  onDrill,
  restNote,
}: {
  label: string;
  origins: { name: string; value: string }[];
  dests: Stream[];
  money: (value: string) => string;
  size: (value: string) => number;
  onDrill: (categoryKey: string) => void;
  restNote: string;
}) {
  const [ref, measured] = useSize<HTMLDivElement>();
  useFontsReady();
  const width = measured.width || (NO_LAYOUT ? 600 : 0);
  const layout =
    width > 0
      ? layoutFlow({
          width,
          measure: measureText,
          sources: origins.map((o) => ({ name: o.name, value: money(o.value), size: size(o.value), valueSize: 10 })),
          dests: dests.map((d) => ({
            name: d.name,
            value: d.label ?? money(d.value),
            size: size(d.value),
            ...(d.kind === "stack" ? { nameSize: 12.5, nameWeight: 700, valueSize: 11, roomy: true } : d.kind === "rest" ? { nameSize: 11.5 } : {}),
          })),
        })
      : null;
  return (
    <div ref={ref} className="chart" style={{ height: layout?.height ?? 250 }}>
      {layout && (
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={label} preserveAspectRatio="none">
          {origins.map((origin, index) => {
            const at = layout.sources[index];
            return (
              <g key={`s-${origin.name}`}>
                <Tip text={`${origin.name} ${money(origin.value)}`} />
                <path d={ribbon(layout.sourceX + layout.node, at.y, at.y + at.height, layout.hubX, at.hubY, at.hubY + at.height)} fill="var(--usd)" opacity=".13" />
                <rect x={layout.sourceX} y={at.y} width={layout.node} height={at.height} rx="2" fill="var(--usd)" />
                <FlowLabel placed={at} fill={(kind) => (kind === "name" ? "var(--ink-2)" : "var(--ink-3)")} />
              </g>
            );
          })}
          <rect x={layout.hubX} y={layout.hub.y} width={layout.node} height={layout.hub.height} rx="2" fill="var(--ink-3)" />
          {dests.map((d, index) => {
            const at = layout.dests[index];
            const fill = d.kind === "stack" ? "var(--btc)" : d.kind === "rest" ? "var(--ink-3)" : "var(--usd)";
            const opacity = d.kind === "stack" ? 0.6 : d.kind === "rest" ? 0.1 : 0.2;
            const drill = d.drill ? () => onDrill(d.drill!) : undefined;
            return (
              <g
                key={d.key}
                role={drill ? "button" : undefined}
                tabIndex={drill ? 0 : undefined}
                style={drill ? { cursor: "pointer" } : undefined}
                aria-label={drill ? `${d.name} ${money(d.value)}. Show its transactions.` : undefined}
                onClick={drill}
                onKeyDown={(event) => {
                  if (drill && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    drill();
                  }
                }}
              >
                <Tip text={`${d.name} ${d.label ?? money(d.value)}${d.kind === "rest" ? `. ${restNote}` : ""}`} />
                <path d={ribbon(layout.hubX + layout.node, at.hubY, at.hubY + at.height, layout.destX, at.y, at.y + at.height)} fill={fill} opacity={opacity} />
                <rect x={layout.destX} y={at.y} width={layout.node} height={at.height} rx="2" fill={fill} />
                <FlowLabel placed={at} fill={(kind) => (d.kind === "stack" ? "var(--btc)" : kind === "name" && d.kind !== "rest" ? "var(--ink-2)" : "var(--ink-3)")} />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
