import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { formatMoney, type Denomination } from "../lib/money";
import { formatChartTick } from "./Charts";

export function ProjectionChart({
  title,
  unit,
  points,
  series,
}: {
  title: string;
  unit: Denomination;
  points: { label: string; values: Record<string, string | null> }[];
  series: { key: string; label: string; color: string }[];
}) {
  const data = points.map((point) => ({
    label: point.label,
    exact: point.values,
    ...Object.fromEntries(
      series.map(({ key }) => [
        key,
        point.values[key] == null ? null : Number(point.values[key]),
      ]),
    ),
  }));
  return (
    <div
      className="chart"
      role="img"
      aria-label={`${title} · ${unit === "USD" ? "USD" : "bitcoin"}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={formatChartTick}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            width={65}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              !active || !payload?.length ? null : (
                <div className="chart-tooltip">
                  <strong>{label}</strong>
                  {payload.map((item) => (
                    <div key={String(item.dataKey)}>
                      <span>{item.name}</span>
                      <span>
                        {formatMoney(
                          item.payload.exact[item.dataKey as string],
                          unit,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }
          />
          {series.length > 1 && <Legend />}
          {series.map(({ key, label, color }) => (
            <Line
              key={key}
              dataKey={key}
              name={label}
              stroke={color}
              dot={points.length === 1 ? { r: 4 } : false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
