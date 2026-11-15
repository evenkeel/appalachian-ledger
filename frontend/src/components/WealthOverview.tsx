import { useReportingUnit } from "../lib/monetaryLens";
import { conversionNote } from "../lib/conversionNote";
import { Fragment as ReactFragment, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownUp } from "lucide-react";
import type { Report } from "../lib/types";
import { Money } from "./Money";
import { DualHistoryChart } from "./DualHistoryChart";
import { Button } from "./ui/button";
import { ChangeBadge, TrendArea } from "./Visuals";

export type OverviewUnit = "BITCOIN" | "USD";

export function ToggleAmounts({
  values,
  label,
  initialUnit = "BITCOIN",
}: {
  values: Record<OverviewUnit, string | null>;
  label: string;
  initialUnit?: OverviewUnit;
}) {
  const preferred = useReportingUnit(initialUnit);
  const [selection, setSelection] = useState({ preferred, unit: preferred });
  if (selection.preferred !== preferred)
    setSelection({ preferred, unit: preferred });
  const unit = selection.preferred === preferred ? selection.unit : preferred;
  const setUnit = (next: (unit: OverviewUnit) => OverviewUnit) =>
    setSelection({ preferred, unit: next(unit) });
  return (
    <CurrencyAmounts
      values={values}
      label={label}
      unit={unit}
      onToggle={() =>
        setUnit((current) => (current === "BITCOIN" ? "USD" : "BITCOIN"))
      }
    />
  );
}

function CurrencyAmounts({
  values,
  unit,
  onToggle,
  label,
}: {
  values: Record<OverviewUnit, string | null>;
  unit: OverviewUnit;
  onToggle: () => void;
  label: string;
}) {
  const alternative = unit === "BITCOIN" ? "USD" : "BITCOIN";
  const displayed =
    values[unit] == null && values[alternative] != null ? alternative : unit;
  const secondary = displayed === "BITCOIN" ? "USD" : "BITCOIN";
  return (
    <div className="currency-amounts">
      <div className="overview-primary" aria-live="polite" aria-atomic="true">
        <Money value={values[displayed]} unit={displayed} />
        {displayed === "USD" && values[displayed] != null && (
          <span className="overview-unit">USD</span>
        )}
      </div>
      <div className="overview-secondary">
        <Money value={values[secondary]} unit={secondary} />
        {values[secondary] != null && (
          <span>{secondary === "USD" ? "USD" : "bitcoin"}</span>
        )}
        <button
          type="button"
          className="amount-swap"
          disabled={values[secondary] == null}
          onClick={onToggle}
          aria-label={`Show ${label} in ${secondary === "USD" ? "dollars" : "bitcoin"}`}
          title={`Switch to ${secondary === "USD" ? "dollars" : "bitcoin"}`}
        >
          <ArrowDownUp size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function NetWorth({
  report,
  dominance,
  debtGauge,
}: {
  report: Report;
  dominance?: ReactNode;
  debtGauge?: ReactNode;
}) {
  const unit = useReportingUnit("USD");
  const trend = report.history.map((point) => ({
    month: point.month,
    value: point.dual?.[unit].net_worth ?? null,
  }));
  const known = trend.filter((point) => point.value !== null);
  return (
    <section className="panel net-worth" aria-label="Total net worth">
      <div className="net-worth-top">
        <div className="net-worth-balance">
          <h2>Total Net Worth</h2>
          <ToggleAmounts
            values={{
              BITCOIN: report.dual?.BITCOIN.net_worth ?? null,
              USD: report.dual?.USD.net_worth ?? null,
            }}
            label="net worth"
          />
          <div className="net-worth-meta">
            {known.length > 1 && (
              <ChangeBadge
                from={known[0].value}
                to={known.at(-1)!.value}
                unit={unit}
                since={new Date(
                  `${known[0].month}-15T12:00:00`,
                ).toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                })}
              />
            )}
            <small className="valuation-date">
              Estimated · {report.history.at(-1)?.date ?? report.month}
            </small>
          </div>
        </div>
        {dominance}
      </div>
      <TrendArea
        points={trend}
        unit={unit}
        label="Net worth"
        color={unit === "USD" ? "var(--blue)" : "var(--accent)"}
        height={132}
      />
      <div className="net-worth-bottom">
        <div className="net-worth-context">
          <div className="net-worth-breakdown">
            <div>
              <span>Assets</span>
              <ToggleAmounts
                label="total assets"
                values={{
                  BITCOIN: report.dual?.BITCOIN.assets ?? null,
                  USD: report.dual?.USD.assets ?? null,
                }}
              />
            </div>
            <div>
              <span>Debt</span>
              <ToggleAmounts
                label="total debt"
                values={{
                  BITCOIN: report.dual?.BITCOIN.liabilities ?? null,
                  USD: report.dual?.USD.liabilities ?? null,
                }}
              />
            </div>
          </div>
          <details className="valuation-details">
            <summary>
              Valuation details{report.rate?.stale ? " · older rate" : ""}
            </summary>
            <small>
              Everything you own, less everything you owe. Includes latest
              recorded asset values. Missing conversions stay unavailable.
            </small>
            <small>
              {report.rate
                ? `${report.rate.source} Bitcoin rate · ${report.rate.observed_at ? new Date(report.rate.observed_at).toLocaleString() : report.rate.day}${report.rate.stale ? " · older rate" : ""}`
                : "Add or sync Bitcoin rates to complete conversions."}
            </small>
          </details>
        </div>
        {debtGauge}
      </div>
    </section>
  );
}

const metrics = {
  expenses: "Expenses",
  income: "Income",
  liabilities: "Debt",
  net_worth: "Net worth",
  lifestyle: "Same lifestyle",
} as const;
type Metric = keyof typeof metrics;
export function DenominationTrends({
  report,
  period,
  onPeriod,
}: {
  report: Report;
  period: string;
  onPeriod: (value: string) => void;
}) {
  const [table, setTable] = useState(false);
  function value(
    point: Report["history"][number],
    currency: OverviewUnit,
    metric: Metric,
  ) {
    if (metric === "lifestyle") return point.lifestyle?.[currency] ?? null;
    return point.dual?.[currency][metric] ?? null;
  }
  const latest = report.history.at(-1);
  return (
    <section
      className="panel denomination-trends all-trends"
      aria-label="Trends"
    >
      <div className="panel-heading">
        <div>
          <h2>Trends</h2>
          <small>Both currencies · all five views</small>
        </div>
        <div className="trend-periods" role="group" aria-label="History period">
          {[
            ["6", "6M"],
            ["12", "1Y"],
            ["24", "2Y"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={period === value}
              onClick={() => onPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="dual-trend-legend">
        <span>
          <i className="usd-line" />
          USD · left axis
        </span>
        <span>
          <i className="bitcoin-line" />
          bitcoin · right axis
        </span>
        <small>Independent scales · current month is partial</small>
      </div>
      <div className="all-trends-grid">
        {(Object.entries(metrics) as [Metric, string][]).map(
          ([metric, label]) => (
            <article
              className={`dual-trend-card trend-${metric}`}
              key={metric}
              aria-label={`${label} trend`}
            >
              <div className="dual-trend-heading">
                <h3>{label}</h3>
                <div>
                  <Money
                    value={latest ? value(latest, "USD", metric) : null}
                    unit="USD"
                  />
                  <Money
                    value={latest ? value(latest, "BITCOIN", metric) : null}
                    unit="BITCOIN"
                  />
                </div>
              </div>
              <DualHistoryChart
                title={label}
                history={report.history.map((point) => ({
                  month: point.month,
                  USD: value(point, "USD", metric),
                  BITCOIN: value(point, "BITCOIN", metric),
                }))}
              />
              {metric === "lifestyle" && (
                <p className="hint">
                  The dollar cost of your{" "}
                  {report.lifestyle_baseline ?? "first recorded"} spending, held
                  constant; its bitcoin equivalent changes with the exchange
                  rate.
                </p>
              )}
            </article>
          ),
        )}
      </div>
      <details className="history-details">
        <summary>About these values</summary>
        <div className="trend-explanation">
          <p>
            Income and expenses use transaction-date rates. Debt and net worth
            use month-end balances, dated Bitcoin rates, and recorded asset
            valuations. Same lifestyle holds baseline dollar spending constant.
            Missing conversions leave gaps. Each currency has its own labeled
            axis; line crossings do not mean equal amounts.
          </p>
          <small>
            {conversionNote(
              report.history.flatMap((h) => [h.dual?.BITCOIN, h.dual?.USD]),
            )}
          </small>
        </div>
      </details>
      <div className="trend-table-toggle">
        <Button variant="ghost" size="sm" onClick={() => setTable(!table)}>
          {table ? "Hide" : "Show"} monthly values
        </Button>
      </div>
      {table && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                {Object.values(metrics).map((label) => (
                  <th key={label} colSpan={2}>
                    {label}
                  </th>
                ))}
              </tr>
              <tr>
                <th>
                  <span className="sr-only">Currency</span>
                </th>
                {Object.keys(metrics).map((key) => (
                  <ReactFragment key={key}>
                    <th>USD</th>
                    <th>bitcoin</th>
                  </ReactFragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.history.map((point) => (
                <tr key={point.month}>
                  <td>{point.month}</td>
                  {(Object.keys(metrics) as Metric[]).map((metric) => (
                    <ReactFragment key={metric}>
                      <td>
                        <Money value={value(point, "USD", metric)} unit="USD" />
                      </td>
                      <td>
                        <Money
                          value={value(point, "BITCOIN", metric)}
                          unit="BITCOIN"
                        />
                      </td>
                    </ReactFragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
