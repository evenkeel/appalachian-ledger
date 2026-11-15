import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ReferenceLine,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import type { Account, Category, Transaction } from "../lib/types";
import {
  analyzeSpending,
  categoryKey,
  chartAmount,
  decimalAmount,
  type Amount,
  type AnalysisUnit,
  type SpendingTotal,
} from "../lib/spendingAnalysis";
import { formatMoney } from "../lib/money";
import { today, type DialogState } from "./EntryDialog";
import { TransactionTable } from "./TransactionTable";
import { Button } from "./ui/button";

const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
const rangeLabel = (month: string, day: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatRange(
    new Date(`${month}-01T12:00:00`),
    new Date(`${month}-${String(Math.max(1, day)).padStart(2, "0")}T12:00:00`),
  );
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
const absolute = (n: Amount) => (n === null ? null : n < 0n ? -n : n);
type Selection = {
  label: string;
  keys?: string[];
  date?: string;
  comparison?: boolean;
};

export function SpendingAnalysis({
  month,
  onMonth,
  accounts,
  categories,
  transactions,
  onAdd,
  actions,
  monetaryLens = "USD",
  now = new Date(),
}: {
  month: string;
  onMonth?: (month: string) => void;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  onAdd: (state: DialogState) => void;
  actions?: ReactNode;
  monetaryLens?: "USD" | "BITCOIN" | "BTC";
  now?: Date;
}) {
  // A local selection overrides the workspace lens until that lens changes.
  const [override, setOverride] = useState<{
    lens: typeof monetaryLens;
    unit: AnalysisUnit | null;
  }>({ lens: monetaryLens, unit: null });
  if (override.lens !== monetaryLens)
    setOverride({ lens: monetaryLens, unit: null });
  const unit: AnalysisUnit =
    override.lens === monetaryLens && override.unit
      ? override.unit
      : monetaryLens === "USD"
        ? "USD"
        : "BITCOIN";
  const setUnit = (unit: AnalysisUnit) =>
    setOverride({ lens: monetaryLens, unit });
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [explorer, setExplorer] = useState<"trends" | "map">("trends");
  const [showAll, setShowAll] = useState(false);
  const [historyCategory, setHistoryCategory] = useState("");
  const [showConversions, setShowConversions] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const analysis = useMemo(
    () =>
      analyzeSpending({
        month,
        categories,
        transactions,
        unit,
        account,
        category,
        now,
      }),
    [month, categories, transactions, unit, account, category, dateKey],
  ); // Daily cutoffs use the viewer's local calendar.
  const buildingBaseline = !transactions.some(
    (row) =>
      row.kind === "expense" &&
      row.date.startsWith(`${analysis.previousMonth}-`),
  );
  const money = (value: Amount) =>
    formatMoney(decimalAmount(value, unit), unit);
  const signed = (value: Amount) =>
    `${value !== null && value > 0n ? "+" : ""}${money(value)}`;
  const exactTotal = (total: SpendingTotal) =>
    `${money(total.value)}${total.missing ? ` · ${total.missing} missing reference${total.missing === 1 ? "" : "s"}` : ""}`;
  function select(next: Selection) {
    setSelection(next);
    requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView?.({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
    });
  }
  const contextKey = `${month}:${unit}:${account}:${category}`;
  const [selectionContext, setSelectionContext] = useState(contextKey);
  // Reset drill-down when shared filters change, including the reporting month.
  if (selectionContext !== contextKey) {
    setSelectionContext(contextKey);
    setSelection(null);
  }
  const detailRows = selection
    ? [...analysis.rows, ...(selection.comparison ? analysis.previousRows : [])]
        .filter(
          (row) =>
            (!selection.keys || selection.keys.includes(categoryKey(row))) &&
            (!selection.date || row.date === selection.date),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    : [];
  const selectedLabel = rangeLabel(month, analysis.cutoff),
    previousLabel = rangeLabel(analysis.previousMonth, analysis.previousCutoff);
  const currentDate = `${month}-${String(analysis.cutoff).padStart(2, "0")}`;
  const headline =
    analysis.change === null
      ? "Comparison unavailable"
      : analysis.change === 0n
        ? "Same recorded spending as last month"
        : `${money(absolute(analysis.change))} ${analysis.change < 0n ? "less" : "more"} spent${month === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` ? ` through ${dayLabel(currentDate)}` : " than last month"}`;
  const maxTrendExact = analysis.categories
    .flatMap((c) => c.history.map((h) => h.total.value ?? 0n))
    .reduce(
      (max, value) => (value > max ? value : max),
      unit === "USD" ? 100n : 1n,
    );
  const maxTrend = chartAmount(maxTrendExact, unit)!;
  const selectedHistory =
    analysis.categories.find((c) => c.key === historyCategory) ??
    analysis.categories[0];
  const mapCategories = analysis.categories
    .filter((c) => c.current.value !== null && c.current.value > 0n)
    .sort((a, b) =>
      a.current.value === b.current.value
        ? a.name.localeCompare(b.name)
        : a.current.value! > b.current.value!
          ? -1
          : 1,
    );
  const share = (value: Amount) =>
    value === null ||
    analysis.current.value === null ||
    analysis.current.value <= 0n
      ? "Unavailable"
      : `${Number((value * 1000n) / analysis.current.value) / 10}%`;
  const mapReady = analysis.current.value !== null;
  const maxDay = Math.max(
    1,
    ...analysis.calendar.map((d) => chartAmount(d.total.value, unit) ?? 0),
  );
  const waterfallMax = Math.max(
    1,
    chartAmount(analysis.current.value, unit) ?? 0,
    chartAmount(analysis.previous.value, unit) ?? 0,
    ...analysis.waterfall.flatMap((step) => [
      chartAmount(step.start, unit)!,
      chartAmount(step.end, unit)!,
    ]),
  );
  const position = (amount: bigint) =>
    (chartAmount(amount, unit)! / waterfallMax) * 100;
  const selectedMonthName = new Date(`${month}-01T12:00:00`).toLocaleDateString(
    undefined,
    { month: "long" },
  );
  const previousMonthName = new Date(
    `${analysis.previousMonth}-01T12:00:00`,
  ).toLocaleDateString(undefined, { month: "long" });
  const previousFullTotal =
    analysis.pace[analysis.previousDays - 1]?.previous ?? null;
  const pacePoints = [{ day: 0, current: 0n, previous: 0n }, ...analysis.pace];
  const categoryOptions = [
    { key: "uncategorized", name: "Uncategorized" },
    ...categories
      .filter((c) => c.kind === "expense")
      .map((c) => ({ key: String(c.id), name: c.name })),
  ];
  // Include archived / historical categories if they are absent from the manager.
  for (const row of transactions.filter((t) => t.kind === "expense"))
    if (!categoryOptions.some((c) => c.key === categoryKey(row)))
      categoryOptions.push({ key: categoryKey(row), name: row.category });

  return (
    <div className="spending-analysis">
      <div className="filter-bar analysis-controls">
        {onMonth && (
          <input
            type="month"
            aria-label="Reporting month"
            value={month}
            max={today().slice(0, 7)}
            onChange={(event) => {
              if (event.target.value) onMonth(event.target.value);
            }}
          />
        )}
        <select
          aria-label="Analysis account"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="Analysis category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All expense categories</option>
          {categoryOptions.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
        <div
          className="analysis-switch"
          role="group"
          aria-label="Analysis currency"
        >
          {(["USD", "BITCOIN"] as const).map((u) => (
            <Button
              key={u}
              size="sm"
              variant={unit === u ? "default" : "ghost"}
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
            >
              {u === "USD" ? "Dollars" : "Bitcoin"}
            </Button>
          ))}
        </div>
        {actions && <div className="analysis-actions">{actions}</div>}
      </div>
      {analysis.future ? (
        <section className="panel empty-inline">
          Analysis is available for the current month and earlier recorded
          months.
        </section>
      ) : (
        <>
          {buildingBaseline && (
            <aside className="analysis-calibration" role="status">
              <strong>Building Your Baseline</strong>
              <span>
                Track expenses for a full calendar month to calibrate your
                month-over-month comparisons. No expenses are recorded for{" "}
                {monthLabel(analysis.previousMonth)} yet.
              </span>
            </aside>
          )}
          <section className="panel analysis-pace" aria-labelledby="pace-title">
            <h2 id="pace-title" className="pace-title">
              Spending Pace
            </h2>
            <div className="pace-reading">
              <strong>{exactTotal(analysis.current)}</strong>
              <span>
                {selectedMonthName}
                {analysis.cutoff < analysis.currentDays
                  ? " so far"
                  : " spending"}
              </span>
            </div>
            <p className="pace-comparison">{headline}</p>
            <div className="pace-previous-label">
              <span aria-hidden="true" />
              {previousMonthName} · {money(previousFullTotal)}
            </div>
            <div
              className="analysis-pace-chart"
              role="img"
              aria-label="Cumulative spending by day of month, selected month and previous month"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={pacePoints}
                  margin={{ top: 10, right: 12, bottom: 12, left: 10 }}
                >
                  <XAxis
                    hide
                    type="number"
                    dataKey="day"
                    domain={[
                      0,
                      Math.max(analysis.currentDays, analysis.previousDays),
                    ]}
                  />
                  <YAxis hide domain={[0, "auto"]} />
                  {previousFullTotal !== null && (
                    <ReferenceLine
                      y={chartAmount(previousFullTotal, unit)!}
                      stroke="var(--pace-previous)"
                      strokeDasharray="3 4"
                    />
                  )}
                  <Tooltip
                    content={({ active, payload, label }) => {
                      const point = payload?.[0]?.payload as
                        (typeof analysis.pace)[number] | undefined;
                      return active && point ? (
                        <div className="chart-tooltip">
                          <strong>Day {label}</strong>
                          <div>
                            <span>{monthLabel(month)}</span>
                            <span>
                              {Number(label) > analysis.cutoff
                                ? "Not elapsed"
                                : money(point.current)}
                            </span>
                          </div>
                          <div>
                            <span>{monthLabel(analysis.previousMonth)}</span>
                            <span>
                              {Number(label) > analysis.previousDays
                                ? "Outside month"
                                : money(point.previous)}
                            </span>
                          </div>
                        </div>
                      ) : null;
                    }}
                  />
                  <Line
                    dataKey={(d) => chartAmount(d.previous, unit)}
                    name="Previous month"
                    stroke="var(--pace-previous)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey={(d) => chartAmount(d.current, unit)}
                    name="Selected month"
                    stroke="var(--accent)"
                    strokeWidth={3}
                    dot={(point) =>
                      point.index === analysis.cutoff &&
                      analysis.current.value !== null ? (
                        <g key="pace-endpoint">
                          <circle
                            cx={point.cx}
                            cy={point.cy}
                            r={10}
                            fill="var(--accent)"
                            opacity={0.18}
                          />
                          <circle
                            cx={point.cx}
                            cy={point.cy}
                            r={4}
                            fill="var(--accent)"
                          />
                        </g>
                      ) : (
                        <g key={point.index} />
                      )
                    }
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <details className="analysis-values">
              <summary>Daily figures</summary>
              <p className="hint">
                Comparison: {selectedLabel} vs {previousLabel}. The gray line
                shows the full previous month; the orange line stops at the
                selected period. Missing purchase-date references leave gaps.
              </p>
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">Cumulative spending</caption>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>{monthLabel(month)}</th>
                      <th>{monthLabel(analysis.previousMonth)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.pace.map((d) => (
                      <tr key={d.day}>
                        <th scope="row">{d.day}</th>
                        <td>
                          {d.day > analysis.cutoff
                            ? "Not elapsed"
                            : money(d.current)}
                        </td>
                        <td>
                          {d.day > analysis.previousDays
                            ? "Outside month"
                            : money(d.previous)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <section
            className="panel analysis-bridge"
            aria-labelledby="waterfall-title"
          >
            <div className="analysis-heading">
              <div>
                <span className="analysis-eyebrow">What changed?</span>
                <h2 id="waterfall-title">Spending Bridge</h2>
              </div>
              <strong>{signed(analysis.change)}</strong>
            </div>
            <p className="hint">
              {previousLabel} → {selectedLabel}. Select a category to inspect
              both periods.
            </p>
            <div className="analysis-bridge-legend" aria-label="Bridge colors">
              <span>
                <i className="increase" />
                Increase
              </span>
              <span>
                <i className="decrease" />
                Decrease
              </span>
            </div>
            {analysis.change === null ? (
              <p className="empty-inline">
                The bridge needs complete purchase-date references in both
                periods. Category details remain available below.
              </p>
            ) : (
              <>
                <div
                  className="analysis-waterfall-scroll"
                  tabIndex={0}
                  role="group"
                  aria-label="Spending Bridge chart"
                >
                  <div
                    className="analysis-waterfall"
                    aria-label="Waterfall of category spending changes"
                  >
                    <div className="analysis-waterfall-step analysis-waterfall-total">
                      <span
                        className="analysis-waterfall-label"
                        title="Previous period"
                      >
                        Prior
                      </span>
                      <div
                        className="analysis-waterfall-track"
                        style={
                          {
                            "--bar-end": `${position(analysis.previous.value!)}%`,
                          } as React.CSSProperties
                        }
                      >
                        <span
                          style={
                            {
                              "--bar-start": "0%",
                              "--bar-size": `${position(analysis.previous.value!)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </div>
                      <strong>{money(analysis.previous.value)}</strong>
                    </div>
                    {analysis.waterfall.map((step) => (
                      <button
                        type="button"
                        key={step.key}
                        className={`analysis-waterfall-step ${step.change < 0n ? "decrease" : "increase"}`}
                        onClick={() =>
                          select({
                            label: step.name,
                            keys: step.keys,
                            comparison: true,
                          })
                        }
                      >
                        <span
                          className="analysis-waterfall-label"
                          title={step.name}
                        >
                          {step.name}
                        </span>
                        <div
                          className="analysis-waterfall-track"
                          style={
                            {
                              "--bar-end": `${position(step.end)}%`,
                            } as React.CSSProperties
                          }
                        >
                          <span
                            style={
                              {
                                "--bar-start": `${Math.min(position(step.start), position(step.end))}%`,
                                "--bar-size": `${Math.abs(position(step.end) - position(step.start))}%`,
                              } as React.CSSProperties
                            }
                          />
                        </div>
                        <strong>{signed(step.change)}</strong>
                      </button>
                    ))}
                    <div className="analysis-waterfall-step analysis-waterfall-total">
                      <span
                        className="analysis-waterfall-label"
                        title="Selected period"
                      >
                        Current
                      </span>
                      <div className="analysis-waterfall-track">
                        <span
                          style={
                            {
                              "--bar-start": "0%",
                              "--bar-size": `${position(analysis.current.value!)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </div>
                      <strong>{money(analysis.current.value)}</strong>
                    </div>
                  </div>
                </div>
                {!analysis.waterfall.length && (
                  <p className="hint">No category spending changes recorded.</p>
                )}
                <details className="analysis-values">
                  <summary>Bridge figures</summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>Change</th>
                          <th>Running total</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">Previous period</th>
                          <td>—</td>
                          <td>{money(analysis.previous.value)}</td>
                        </tr>
                        {analysis.waterfall.map((s) => (
                          <tr key={s.key}>
                            <th scope="row">{s.name}</th>
                            <td>{signed(s.change)}</td>
                            <td>{money(s.end)}</td>
                          </tr>
                        ))}
                        <tr>
                          <th scope="row">Selected period</th>
                          <td>{signed(analysis.change)}</td>
                          <td>{money(analysis.current.value)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </section>

          <section
            className="panel analysis-categories"
            aria-labelledby="category-title"
          >
            <div className="analysis-heading">
              <div>
                <span className="analysis-eyebrow">Where you spent</span>
                <h2 id="category-title">Category Explorer</h2>
              </div>
              <div
                className="analysis-switch"
                role="group"
                aria-label="Category presentation"
              >
                {(["trends", "map"] as const).map((view) => (
                  <Button
                    key={view}
                    size="sm"
                    variant={explorer === view ? "default" : "ghost"}
                    aria-pressed={explorer === view}
                    onClick={() => setExplorer(view)}
                  >
                    {view === "trends" ? "Trends" : "Map"}
                  </Button>
                ))}
              </div>
            </div>
            {explorer === "trends" ? (
              <>
                <p className="hint">
                  Largest absolute changes first · six months on a shared scale
                  · latest month through day {analysis.cutoff}. Earlier trend
                  months are complete.
                </p>
                <div
                  className="analysis-trends"
                  style={
                    {
                      "--trend-columns":
                        Math.min(
                          showAll
                            ? analysis.categories.length
                            : Math.min(6, analysis.categories.length),
                          4,
                        ) || 1,
                    } as React.CSSProperties
                  }
                >
                  {(showAll
                    ? analysis.categories
                    : analysis.categories.slice(0, 6)
                  ).map((c) => (
                    <button
                      type="button"
                      className="analysis-trend-card"
                      key={c.key}
                      onClick={() =>
                        select({
                          label: c.name,
                          keys: [c.key],
                          comparison: true,
                        })
                      }
                    >
                      <span className="analysis-trend-name">{c.name}</span>
                      <strong>{exactTotal(c.current)}</strong>
                      <span className="analysis-trend-change">
                        {signed(c.change)} vs previous period
                      </span>
                      <div className="analysis-sparkline" aria-hidden="true">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={c.history.map((h) => ({
                              value: chartAmount(h.total.value, unit),
                            }))}
                            margin={{ top: 5, bottom: 5, left: 3, right: 3 }}
                          >
                            <YAxis hide domain={[0, maxTrend]} />
                            <Line
                              dataKey="value"
                              stroke="var(--analysis-accent)"
                              strokeWidth={2}
                              dot={{ r: 2 }}
                              connectNulls={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <span className="analysis-trend-dates">
                        {monthLabel(c.history[0].month)}
                        <span>{monthLabel(month)}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {analysis.categories.length > 6 && (
                  <Button
                    className="analysis-show-all"
                    variant="ghost"
                    onClick={() => setShowAll(!showAll)}
                  >
                    {showAll
                      ? "Show fewer categories"
                      : `Show all ${analysis.categories.length} categories`}
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="hint">
                  Block area shows each category’s share of spending ·{" "}
                  {selectedLabel}. Select a block or category below.
                </p>
                {!mapReady ? (
                  <p className="empty-inline">
                    Complete purchase-date references to compare category
                    shares. Exact amounts and transaction details remain
                    available below.
                  </p>
                ) : mapCategories.length ? (
                  <div
                    className="analysis-map"
                    aria-label="Spending category map"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <Treemap
                        data={mapCategories.map((c) => ({
                          name: c.name,
                          value: chartAmount(c.current.value, unit)!,
                          category: c,
                        }))}
                        dataKey="value"
                        aspectRatio={1.6}
                        isAnimationActive={false}
                        content={(props) => {
                          const node = props as unknown as {
                            x: number;
                            y: number;
                            width: number;
                            height: number;
                            depth: number;
                            category?: (typeof mapCategories)[number];
                          };
                          const c = node.category;
                          if (!c || node.depth !== 1) return <g />;
                          const full = `${c.name}: ${money(c.current.value)}, ${share(c.current.value)}`;
                          return (
                            <g
                              role="button"
                              tabIndex={0}
                              aria-label={full}
                              className="analysis-map-node"
                              onClick={() =>
                                select({ label: c.name, keys: [c.key] })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  select({ label: c.name, keys: [c.key] });
                                }
                              }}
                            >
                              <title>{full}</title>
                              <rect
                                x={node.x + 2}
                                y={node.y + 2}
                                width={Math.max(0, node.width - 4)}
                                height={Math.max(0, node.height - 4)}
                                rx={5}
                                fill="var(--analysis-map-fill)"
                              />
                              {node.width > 95 && node.height > 58 && (
                                <>
                                  <text
                                    x={node.x + 12}
                                    y={node.y + 25}
                                    fill="var(--text)"
                                    fontSize={12}
                                  >
                                    {c.name.length >
                                    Math.floor((node.width - 24) / 7)
                                      ? `${c.name.slice(0, Math.max(3, Math.floor((node.width - 24) / 7) - 1))}…`
                                      : c.name}
                                  </text>
                                  <text
                                    x={node.x + 12}
                                    y={node.y + 45}
                                    fill="var(--text)"
                                    fontSize={11}
                                  >
                                    {node.width > 155
                                      ? `${money(c.current.value)} · `
                                      : ""}
                                    {share(c.current.value)}
                                  </text>
                                </>
                              )}
                            </g>
                          );
                        }}
                      />
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="empty-inline">No recorded spending to map.</p>
                )}
                <div className="analysis-map-key">
                  {analysis.categories
                    .filter((c) => c.current.count > 0)
                    .map((c) => (
                      <button
                        type="button"
                        key={c.key}
                        onClick={() => select({ label: c.name, keys: [c.key] })}
                      >
                        <span>{c.name}</span>
                        <strong>{exactTotal(c.current)}</strong>
                        <span>{share(c.current.value)}</span>
                      </button>
                    ))}
                </div>
              </>
            )}
            {!analysis.categories.length && (
              <p className="empty-inline">
                No recorded expenses match these filters. An empty recorded
                month does not establish that no spending occurred.
              </p>
            )}
            <details className="analysis-values">
              <summary>Category figures and six-month history</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Spent</th>
                      <th>Prior</th>
                      <th>Change</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.categories.map((c) => (
                      <tr key={c.key}>
                        <th scope="row">
                          <button
                            type="button"
                            className="analysis-table-link"
                            onClick={() =>
                              select({
                                label: c.name,
                                keys: [c.key],
                                comparison: true,
                              })
                            }
                          >
                            {c.name}
                          </button>
                        </th>
                        <td>{exactTotal(c.current)}</td>
                        <td>{exactTotal(c.previous)}</td>
                        <td>{signed(c.change)}</td>
                        <td>{share(c.current.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedHistory && (
                <div className="analysis-history-inspector">
                  <label>
                    Six-month history
                    <select
                      aria-label="History category"
                      value={selectedHistory.key}
                      onChange={(e) => setHistoryCategory(e.target.value)}
                    >
                      {analysis.categories.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="table-scroll">
                    <table>
                      <caption className="sr-only">
                        {selectedHistory.name}: six-month spending history
                      </caption>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Spent</th>
                          <th>Entries</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedHistory.history.map((h) => (
                          <tr key={h.month}>
                            <th scope="row">
                              {monthLabel(h.month)}
                              {h.month === month
                                ? ` (1–${analysis.cutoff})`
                                : ""}
                            </th>
                            <td>{exactTotal(h.total)}</td>
                            <td>{h.total.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </details>
          </section>

          <details className="panel analysis-calendar">
            <summary>
              When You Spent <span>{monthLabel(month)}</span>
            </summary>
            <p className="hint">
              Darker dates mean more recorded spending. Dashes mark dates not
              yet elapsed; ? marks a missing reference.
            </p>
            <div
              className="analysis-calendar-grid"
              role="group"
              aria-label="Daily spending calendar"
            >
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <span className="analysis-weekday" key={d}>
                  {d}
                </span>
              ))}
              {Array.from(
                { length: new Date(`${month}-01T12:00:00`).getDay() },
                (_, i) => (
                  <span key={`blank-${i}`} />
                ),
              )}
              {analysis.calendar.map((day) => (
                <button
                  type="button"
                  key={day.date}
                  disabled={day.future}
                  className={`analysis-calendar-day ${day.future ? "future" : ""} ${day.total.missing ? "missing" : ""}`}
                  style={{
                    background:
                      !day.future &&
                      day.total.value !== null &&
                      day.total.value > 0n
                        ? `color-mix(in srgb, var(--analysis-accent) ${15 + (chartAmount(day.total.value, unit)! / maxDay) * 35}%, var(--surface))`
                        : undefined,
                  }}
                  aria-label={`${dayLabel(day.date)}: ${day.future ? "Not elapsed" : exactTotal(day.total)}${!day.future ? `, ${day.total.count} recorded expenses` : ""}`}
                  onClick={() =>
                    select({ label: dayLabel(day.date), date: day.date })
                  }
                >
                  <span>{day.day}</span>
                  <small>
                    {day.future
                      ? "—"
                      : day.total.missing
                        ? "?"
                        : day.total.count
                          ? money(day.total.value)
                          : "0"}
                  </small>
                </button>
              ))}
            </div>
            <details className="analysis-values">
              <summary>Calendar figures</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Spending</th>
                      <th>Recorded expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.calendar.map((day) => (
                      <tr key={day.date}>
                        <th scope="row">{day.date}</th>
                        <td>
                          {day.future ? "Not elapsed" : exactTotal(day.total)}
                        </td>
                        <td>{day.future ? "—" : day.total.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </details>

          {selection && (
            <section
              className="panel analysis-detail"
              tabIndex={-1}
              ref={detailRef}
              aria-label="Analysis transactions"
            >
              <div className="analysis-heading">
                <div>
                  <h2>{selection.label}</h2>
                  <p className="hint">
                    {selection.date
                      ? selection.date
                      : `${selectedLabel}${selection.comparison ? ` and ${previousLabel}` : ""}`}{" "}
                    · {unit === "USD" ? "USD" : "bitcoin"}
                    {account
                      ? ` · ${accounts.find((a) => String(a.id) === account)?.name ?? "Selected account"}`
                      : " · All accounts"}
                    {category
                      ? ` · ${categoryOptions.find((c) => c.key === category)?.name ?? "Selected category"}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={showConversions}
                  onClick={() => setShowConversions(!showConversions)}
                >
                  {showConversions ? "Hide conversions" : "Show conversions"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelection(null)}
                >
                  Close details
                </Button>
              </div>
              <TransactionTable
                rows={detailRows}
                showConversions={showConversions}
                onRepeat={(transaction) =>
                  onAdd({
                    type: "transaction",
                    kind: "expense",
                    repeat: transaction,
                  })
                }
                onEdit={(transaction) =>
                  onAdd({ type: "transaction", transaction })
                }
                onDelete={(transaction) =>
                  onAdd({ type: "deleteTransaction", transaction })
                }
              />
            </section>
          )}
          <p className="hint analysis-footnote">
            Recorded expenses only. Empty dates may reflect missing entries.
            Bitcoin equivalents use saved purchase-date references; missing
            conversions are unavailable.
          </p>
        </>
      )}
    </div>
  );
}
