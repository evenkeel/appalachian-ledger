import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { History } from "../lib/types";
import { formatMoney, type Denomination } from "../lib/money";
// Floating point is confined to chart coordinates, never balances or financial calculations.
export const formatChartTick = (n: number) =>
  Math.abs(n) >= 1000000
    ? `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}m`
    : Math.abs(n) >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
      : String(n);
export function HistoryChart({
  history,
  unit,
  flows = false,
  title,
}: {
  history: Pick<History, "month" | "net_worth" | "income" | "expenses">[];
  unit: Denomination;
  flows?: boolean;
  title?: string;
}) {
  const data = history.map((row) => ({
    name: new Date(row.month + "-15T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
    }),
    exact: { net: row.net_worth, income: row.income, expense: row.expenses },
    net: row.net_worth == null ? null : Number(row.net_worth),
    income: row.income == null ? null : Number(row.income),
    expense: row.expenses == null ? null : Number(row.expenses),
  }));
  const common = (
    <>
      <CartesianGrid stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey="name"
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted)", fontSize: 11 }}
        dy={8}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tickFormatter={formatChartTick}
        tick={{ fill: "var(--muted)", fontSize: 11 }}
        width={52}
      />
      <Tooltip
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          return (
            <div className="chart-tooltip">
              <strong>{label}</strong>
              {payload.map((item) => {
                const point = item.payload as (typeof data)[number];
                const key = item.dataKey as keyof typeof point.exact;
                return (
                  <div key={String(item.dataKey)}>
                    <span>
                      {item.name === "net" ? "Estimated value" : item.name}
                    </span>
                    <span>
                      {formatMoney(point.exact[key], unit)}
                      {unit === "BTC" ? " BTC" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        }}
      />
    </>
  );
  return (
    <div
      className="chart"
      role="img"
      aria-label={
        title ??
        (flows ? "Monthly income and expenses chart" : "Account history chart")
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        {flows ? (
          <BarChart data={data}>
            {common}
            <Bar
              isAnimationActive={false}
              dataKey="income"
              name="Income"
              fill="var(--blue)"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="expense"
              name="Expenses"
              fill="var(--accent)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        ) : (
          <AreaChart data={data}>
            {common}
            <Area
              type="linear"
              dataKey="net"
              name="Value"
              stroke="var(--blue)"
              strokeWidth={2}
              fill="var(--blue)"
              fillOpacity={0.18}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
