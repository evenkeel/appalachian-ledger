import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatChartTick } from "./Charts";
import { formatMoney } from "../lib/money";

export interface DualHistoryPoint {
  month: string;
  USD: string | null;
  BITCOIN: string | null;
}

export function DualHistoryChart({
  history,
  title,
}: {
  history: DualHistoryPoint[];
  title: string;
}) {
  const data = history.map((point) => ({
    ...point,
    usd: point.USD == null ? null : Number(point.USD),
    bitcoin: point.BITCOIN == null ? null : Number(point.BITCOIN),
  }));
  if (
    !data.length ||
    data.every((point) => point.usd === null && point.bitcoin === null)
  ) {
    return (
      <div
        className="dual-history-chart dual-history-empty"
        role="img"
        aria-label={`${title} in dollars and bitcoin over time`}
      >
        {data.length ? "Conversions unavailable" : "No history recorded"}
      </div>
    );
  }
  const domain = [
    (min: number) => Math.min(0, min),
    (max: number) => Math.max(0, max),
  ] as [(min: number) => number, (max: number) => number];
  return (
    <div
      className="dual-history-chart"
      role="img"
      aria-label={`${title} in dollars and bitcoin over time`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            minTickGap={25}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(month: string) =>
              new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, {
                month: "short",
                year: "2-digit",
              })
            }
          />
          <YAxis
            yAxisId="USD"
            domain={domain}
            width={51}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--blue)", fontSize: 12 }}
            tickFormatter={(n: number) => `$${formatChartTick(n)}`}
          />
          <YAxis
            yAxisId="BITCOIN"
            domain={domain}
            orientation="right"
            width={57}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--accent)", fontSize: 12 }}
            tickFormatter={(n: number) => `₿${formatChartTick(n)}`}
          />
          <Tooltip
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as
                DualHistoryPoint | undefined;
              return active && point ? (
                <div className="chart-tooltip">
                  <strong>{point.month}</strong>
                  <div>
                    USD <span>{formatMoney(point.USD, "USD")}</span>
                  </div>
                  <div>
                    bitcoin <span>{formatMoney(point.BITCOIN, "BITCOIN")}</span>
                  </div>
                </div>
              ) : null;
            }}
          />
          <Line
            yAxisId="USD"
            dataKey="usd"
            name="USD"
            stroke="var(--blue)"
            strokeWidth={2}
            dot={data.length === 1 ? { r: 3 } : false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="BITCOIN"
            dataKey="bitcoin"
            name="bitcoin"
            stroke="var(--accent)"
            strokeDasharray="5 3"
            strokeWidth={2}
            dot={data.length === 1 ? { r: 3 } : false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
