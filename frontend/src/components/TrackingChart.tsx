import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrackingMonth } from "../lib/types";
import { formatMoney, type Denomination } from "../lib/money";
import { formatChartTick } from "./Charts";

export type TrackingMetric = Exclude<
  keyof TrackingMonth,
  "month" | "date" | "estimated" | "purchase_count"
>;
export interface TrackingSeries {
  key: TrackingMetric;
  label: string;
  color: string;
  line?: boolean;
}
export function TrackingChart({
  rows,
  series,
  unit = "USD",
  title,
}: {
  rows: TrackingMonth[];
  series: TrackingSeries[];
  unit?: Denomination;
  title: string;
}) {
  // Only drawing coordinates use Number. Tooltips and tables retain exact server values.
  const data = rows.map((row) => ({
    month: row.month,
    exact: row,
    ...Object.fromEntries(
      series.map(({ key }) => [
        key,
        row[key] === null ? null : Number(row[key]),
      ]),
    ),
  }));
  return (
    <div className="chart tracking-chart" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 12, right: 12, bottom: 6, left: 0 }}
        >
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={(value: string) =>
              new Date(`${value}-15T12:00:00`).toLocaleDateString(undefined, {
                month: "short",
                year: "2-digit",
              })
            }
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={formatChartTick}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              const point = payload?.[0]?.payload as
                { exact: TrackingMonth } | undefined;
              return active && point ? (
                <div className="chart-tooltip">
                  <strong>{label}</strong>
                  {series.map((s) => (
                    <div key={s.key}>
                      <span>{s.label}</span>
                      <span>{formatMoney(point.exact[s.key], unit)}</span>
                    </div>
                  ))}
                </div>
              ) : null;
            }}
          />
          {series.map((s) =>
            s.line ? (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                radius={[3, 3, 0, 0]}
                maxBarSize={36}
                isAnimationActive={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
