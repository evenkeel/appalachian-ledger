import { useId, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  formatMoney,
  percentChange,
  subtractMoney,
  type Denomination,
} from "../lib/money";

// Floating point is confined to chart geometry and rounded shares, never balances.
const monthLabel = (month: string, long = false) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    year: long ? "numeric" : "2-digit",
  });

const compactTick = (n: number) =>
  Math.abs(n) >= 1e9
    ? `${+(n / 1e9).toFixed(1)}b`
    : Math.abs(n) >= 1e6
      ? `${+(n / 1e6).toFixed(1)}m`
      : Math.abs(n) >= 1e3
        ? `${+(n / 1e3).toFixed(1)}k`
        : String(n);

export interface TrendPoint {
  month: string;
  value: string | null;
}

/** A single-series area trend with a soft fill; exact values appear in the tooltip. */
export function TrendArea({
  points,
  unit,
  label,
  color = "var(--accent)",
  height = 150,
}: {
  points: TrendPoint[];
  unit: Denomination;
  label: string;
  color?: string;
  height?: number;
}) {
  const gradient = useId().replace(/:/g, "");
  const data = points.map((point) => ({
    ...point,
    y: point.value == null ? null : Number(point.value),
  }));
  const known = data.filter((point) => point.y !== null);
  if (known.length < 2)
    return (
      <div className="trend-area trend-area-empty" style={{ height }}>
        {known.length
          ? "A trend appears after a second month of history."
          : "No history to chart yet."}
      </div>
    );
  return (
    <div
      className="trend-area"
      style={{ height }}
      role="img"
      aria-label={`${label} from ${monthLabel(known[0].month, true)} to ${monthLabel(known.at(-1)!.month, true)}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 6, right: 4, bottom: 0, left: 4 }}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.36} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(month: string) => monthLabel(month)}
          />
          <YAxis
            hide
            domain={["auto", "auto"]}
            padding={{ top: 8, bottom: 8 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as TrendPoint | undefined;
              return active && point ? (
                <div className="chart-tooltip">
                  <strong>{monthLabel(point.month, true)}</strong>
                  <div>
                    <span>{label}</span>
                    <span>{formatMoney(point.value, unit)}</span>
                  </div>
                </div>
              ) : null;
            }}
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2.25}
            fill={`url(#${gradient})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Monthly totals as bars, with the reporting month emphasized. */
export function MonthBars({
  points,
  unit,
  label,
  highlight,
  color = "var(--accent)",
  height = 190,
}: {
  points: TrendPoint[];
  unit: Denomination;
  label: string;
  highlight?: string;
  color?: string;
  height?: number;
}) {
  const data = points.map((point) => ({
    ...point,
    y: point.value == null ? null : Number(point.value),
  }));
  if (!data.some((point) => point.y))
    return (
      <div className="trend-area trend-area-empty" style={{ height }}>
        Nothing recorded in these months yet.
      </div>
    );
  return (
    <div
      className="trend-area"
      style={{ height }}
      role="img"
      aria-label={`${label} by month`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(month: string) => monthLabel(month)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={48}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={compactTick}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-alt)", opacity: 0.5 }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as TrendPoint | undefined;
              return active && point ? (
                <div className="chart-tooltip">
                  <strong>{monthLabel(point.month, true)}</strong>
                  <div>
                    <span>{label}</span>
                    <span>{formatMoney(point.value, unit)}</span>
                  </div>
                </div>
              ) : null;
            }}
          />
          <Bar
            dataKey="y"
            radius={[5, 5, 0, 0]}
            maxBarSize={46}
            isAnimationActive={false}
          >
            {data.map((point) => (
              <Cell
                key={point.month}
                fill={color}
                fillOpacity={!highlight || point.month === highlight ? 1 : 0.4}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Axis-free line for a card: shape only, values are stated beside it. */
export function Sparkline({
  values,
  label,
  color = "var(--accent)",
}: {
  values: number[];
  label: string;
  color?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values),
    max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${((index / (values.length - 1)) * 100).toFixed(2)},${(28 - ((value - min) / span) * 24).toFixed(2)}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** “▲ $1,200.00 · 4.2% since Jun 2026”, where a rise may be good or bad. */
export function ChangeBadge({
  from,
  to,
  unit,
  since,
  goodWhen = "up",
}: {
  from: string | null | undefined;
  to: string | null | undefined;
  unit: Denomination;
  since?: string;
  goodWhen?: "up" | "down";
}) {
  const difference = subtractMoney(to, from);
  if (difference === null) return null;
  const percent = percentChange(from, to);
  const flat = /^-?0(\.0+)?$/.test(difference);
  const up = !difference.startsWith("-");
  const tone = flat ? "flat" : up === (goodWhen === "up") ? "good" : "bad";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`change-badge change-${tone}`}>
      {!flat && <Icon size={14} aria-hidden="true" />}
      <span>
        {flat
          ? "No change"
          : `${up ? "+" : ""}${formatMoney(difference, unit)}`}
        {percent !== null && !flat && ` · ${Math.abs(percent).toFixed(1)}%`}
      </span>
      {since && <small>since {since}</small>}
    </span>
  );
}

export interface BarListItem {
  key: string;
  label: ReactNode;
  /** Decimal string in `unit`; missing conversions stay unavailable. */
  value: string | null;
  color?: string;
  onSelect?: () => void;
}

/** Ranked horizontal bars: the quickest way to compare a handful of categories. */
export function BarList({
  items,
  unit,
  empty = "Nothing recorded for this period.",
  color = "var(--accent)",
  limit,
}: {
  items: BarListItem[];
  unit: Denomination;
  empty?: string;
  color?: string;
  limit?: number;
}) {
  const ranked = [...items].sort(
    (a, b) => Math.abs(Number(b.value ?? 0)) - Math.abs(Number(a.value ?? 0)),
  );
  const shown = limit ? ranked.slice(0, limit) : ranked;
  const total = ranked.reduce(
    (sum, item) => sum + Math.abs(Number(item.value ?? 0)),
    0,
  );
  const largest = Math.abs(Number(ranked[0]?.value ?? 0));
  if (!ranked.length) return <p className="bar-list-empty">{empty}</p>;
  return (
    <ol className="bar-list">
      {shown.map((item) => {
        const amount = Math.abs(Number(item.value ?? 0));
        const body = (
          <>
            <span className="bar-list-label">{item.label}</span>
            <span className="bar-list-value money">
              {formatMoney(item.value, unit)}
            </span>
            <span className="bar-list-share">
              {item.value != null && total > 0
                ? `${Math.round((amount / total) * 100)}%`
                : "—"}
            </span>
            <span className="bar-list-track" aria-hidden="true">
              <i
                style={{
                  width: `${largest > 0 ? Math.max((amount / largest) * 100, amount ? 1.5 : 0) : 0}%`,
                  background: item.color ?? color,
                }}
              />
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {item.onSelect ? (
              <button type="button" onClick={item.onSelect}>
                {body}
              </button>
            ) : (
              <div>{body}</div>
            )}
          </li>
        );
      })}
      {limit && ranked.length > limit && (
        <li className="bar-list-more">
          +{ranked.length - limit} smaller{" "}
          {ranked.length - limit === 1 ? "category" : "categories"}
        </li>
      )}
    </ol>
  );
}

export interface Segment {
  key: string;
  label: string;
  /** Magnitude used for the bar width only. */
  size: number;
  color: string;
  display: ReactNode;
}

/** One stacked bar with a legend: parts of a whole at a glance. */
export function SegmentBar({
  segments,
  label,
}: {
  segments: Segment[];
  label: string;
}) {
  const visible = segments.filter((segment) => segment.size > 0);
  const total = visible.reduce((sum, segment) => sum + segment.size, 0);
  return (
    <div className="segment-bar">
      <div
        className="segment-bar-track"
        role="img"
        aria-label={`${label}: ${visible
          .map(
            (segment) =>
              `${segment.label} ${Math.round((segment.size / total) * 100)}%`,
          )
          .join(", ")}`}
      >
        {visible.map((segment) => (
          <i
            key={segment.key}
            style={{
              width: `${(segment.size / total) * 100}%`,
              background: segment.color,
            }}
          />
        ))}
      </div>
      <ul className="segment-bar-legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <i style={{ background: segment.color }} aria-hidden="true" />
            <span>{segment.label}</span>
            <strong>{segment.display}</strong>
            <small>
              {total > 0 && segment.size > 0
                ? `${Math.round((segment.size / total) * 100)}%`
                : "—"}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatTile({
  label,
  children,
  hint,
  tone,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "bad" | "accent";
}) {
  return (
    <div className={`stat-tile${tone ? ` stat-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{children}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}
