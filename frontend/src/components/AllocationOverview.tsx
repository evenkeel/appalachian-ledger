import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Report } from "../lib/types";
import { Money } from "./Money";

const categories = [
  {
    key: "bitcoin",
    field: "bitcoin_usd",
    label: "Bitcoin",
    color: "var(--accent)",
  },
  {
    key: "dollars",
    field: "dollars_usd",
    label: "USD cash",
    color: "var(--allocation-cash)",
  },
  {
    key: "valued_asset",
    field: "other_assets_usd",
    label: "Other assets",
    color: "var(--allocation-other)",
  },
] as const;

export function AllocationOverview({ report }: { report: Report }) {
  const allocation = report.ownership.allocation;
  if (!allocation) return null;
  const rows = categories.map((category) => ({
    ...category,
    exact: allocation[category.field],
    // Floating point is only used for chart geometry.
    value: Number(allocation[category.field] ?? 0),
  }));
  const allocationMessage = {
    ready: "",
    empty: "No assets yet",
    missing_values: "Exchange rate needed",
    negative_assets: "Negative balances · chart unavailable",
  }[allocation.status];
  const asOf = report.history.at(-1)?.date ?? report.month;
  return (
    <section className="allocation-only" aria-label="Asset allocation">
      <article className="panel allocation-panel" aria-label="Asset allocation">
        <div className="panel-heading">
          <div>
            <h2>Asset Allocation</h2>
            <small>Share of total assets</small>
          </div>
        </div>
        <div className="allocation-content">
          {allocation.status === "ready" ? (
            <div
              className="allocation-chart"
              role="img"
              aria-label={rows
                .map((row) => row.label)
                .join(", ")}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={rows.filter((row) => row.value > 0)}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="66%"
                    outerRadius="90%"
                    stroke="var(--surface)"
                    strokeWidth={3}
                    isAnimationActive={false}
                  >
                    {rows
                      .filter((row) => row.value > 0)
                      .map((row) => (
                        <Cell key={row.key} fill={row.color} />
                      ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      const row = payload?.[0]?.payload as
                        (typeof rows)[number] | undefined;
                      return active && row ? (
                        <div className="chart-tooltip">
                          <strong>{row.label}</strong>
                          <Money value={row.exact} unit="USD" />
                        </div>
                      ) : null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="allocation-center" aria-hidden="true">
                <span>Assets</span>
                <Money value={allocation.assets_usd} unit="USD" />
              </div>
            </div>
          ) : (
            <div className="allocation-empty">{allocationMessage}</div>
          )}
          <div className="asset-allocation-legend">
            {rows.map((row) => (
              <div className="asset-allocation-item" key={row.key}>
                <i style={{ background: row.color }} aria-hidden="true" />
                <div>
                  <span>{row.label}</span>
                  <Money
                    value={
                      row.key === "bitcoin"
                        ? report.ownership.bitcoin_held
                        : row.exact
                    }
                    unit={row.key === "bitcoin" ? "BITCOIN" : "USD"}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="allocation-debt">
          <span>Liabilities</span>
          <Money value={allocation.liabilities_usd} unit="USD" />
        </div>
        <small className="allocation-asof">Estimated · {asOf}</small>
      </article>
    </section>
  );
}
