import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { History, Report } from "../lib/types";
import { formatMoney, percentChange } from "../lib/money";
import { TrendArea } from "./Visuals";

// Floats are used for chart geometry and rounded percentages only.
const monthLabel = (month: string, long = false) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    year: long ? "numeric" : "2-digit",
  });

/** A month counts once its last day has been reached; a partial month would understate spending. */
export function isCompleteMonth(point: Pick<History, "month" | "date">) {
  const [year, month] = point.month.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return point.date === `${point.month}-${String(last).padStart(2, "0")}`;
}

/** Monthly expenses in dollars and in bitcoin (at each purchase-date rate), both indexed to the first month. */
export function expenseIndex(history: History[]) {
  const months = history
    .filter(isCompleteMonth)
    .map((point) => ({
      month: point.month,
      usd: point.dual?.USD.expenses ?? null,
      bitcoin: point.dual?.BITCOIN.expenses ?? null,
    }))
    .filter(
      (point) =>
        point.usd !== null &&
        point.bitcoin !== null &&
        Number(point.usd) > 0 &&
        Number(point.bitcoin) > 0,
    );
  const base = months[0];
  return months.map((point) => ({
    ...point,
    usdIndex: base ? (Number(point.usd) / Number(base.usd)) * 100 : null,
    bitcoinIndex: base
      ? (Number(point.bitcoin) / Number(base.bitcoin)) * 100
      : null,
  }));
}

const describe = (percent: number | null, unit: string) =>
  percent === null
    ? null
    : Math.abs(percent) < 0.5
      ? `about the same in ${unit}`
      : `${Math.abs(percent).toFixed(0)}% ${percent < 0 ? "less" : "more"} ${unit}`;

/** The app's core idea: what your life costs, measured in bitcoin, and how much bitcoin you hold. */
export function BitcoinLens({ report }: { report: Report }) {
  const points = expenseIndex(report.history);
  const first = points[0],
    last = points.at(-1);
  const enough = points.length >= 2 && first && last;
  const bitcoinChange = enough
    ? percentChange(first.bitcoin, last.bitcoin)
    : null;
  const usdChange = enough ? percentChange(first.usd, last.usd) : null;
  const cheaper = bitcoinChange !== null && bitcoinChange < 0;
  const held = report.ownership.bitcoin_held;
  const stacked = report.stacked;
  const stackedSomething = stacked && !/^-?0$/.test(stacked.bitcoin);
  return (
    <section className="bitcoin-lens" aria-label="Your life in bitcoin">
      <div className="panel lens-cost">
        <header>
          <span className="eyebrow">Your expenses, priced in bitcoin</span>
          {enough ? (
            <h2>
              {monthLabel(last.month, true)} cost{" "}
              <span className={cheaper ? "lens-good" : "lens-bad"}>
                {describe(bitcoinChange, "bitcoin")}
              </span>{" "}
              than {monthLabel(first.month, true)}
              {usdChange !== null && (
                <span className="lens-dollars">
                  {" "}
                  and {describe(usdChange, "dollars")}
                </span>
              )}
            </h2>
          ) : (
            <h2>Two full months of expenses start this chart.</h2>
          )}
          <p className="muted">
            Every expense is priced at the bitcoin it would have bought on the
            day you paid. When bitcoin buys more over time, the same life costs
            less of it.
          </p>
        </header>
        {enough && (
          <>
            <div className="lens-figures">
              <div>
                <small>{monthLabel(last.month, true)} in bitcoin</small>
                <strong className="money lens-bitcoin">
                  {formatMoney(last.bitcoin, "BITCOIN")}
                </strong>
                <small className="money">
                  was {formatMoney(first.bitcoin, "BITCOIN")}
                </small>
              </div>
              <div>
                <small>{monthLabel(last.month, true)} in dollars</small>
                <strong className="money">
                  {formatMoney(last.usd, "USD")}
                </strong>
                <small className="money">
                  was {formatMoney(first.usd, "USD")}
                </small>
              </div>
            </div>
            <div
              className="lens-chart"
              role="img"
              aria-label={`Monthly expenses indexed to ${monthLabel(first.month, true)}: bitcoin ${last.bitcoinIndex?.toFixed(0)}, dollars ${last.usdIndex?.toFixed(0)}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={points}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={32}
                    tick={{ fill: "var(--muted)", fontSize: 12 }}
                    tickFormatter={(month: string) => monthLabel(month)}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    domain={["auto", "auto"]}
                    tick={{ fill: "var(--muted)", fontSize: 12 }}
                    tickFormatter={(n: number) => n.toFixed(0)}
                  />
                  <ReferenceLine
                    y={100}
                    stroke="var(--border-strong)"
                    strokeDasharray="4 4"
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border-strong)" }}
                    content={({ active, payload }) => {
                      const point = payload?.[0]?.payload as
                        (typeof points)[number] | undefined;
                      return active && point ? (
                        <div className="chart-tooltip">
                          <strong>{monthLabel(point.month, true)}</strong>
                          <div>
                            <span>In bitcoin</span>
                            <span>{formatMoney(point.bitcoin, "BITCOIN")}</span>
                          </div>
                          <div>
                            <span>In dollars</span>
                            <span>{formatMoney(point.usd, "USD")}</span>
                          </div>
                        </div>
                      ) : null;
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="usdIndex"
                    name="Dollars"
                    stroke="var(--blue)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bitcoinIndex"
                    name="Bitcoin"
                    stroke="var(--accent)"
                    strokeWidth={3}
                    dot={{ r: 3, strokeWidth: 0, fill: "var(--accent)" }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="lens-legend" aria-hidden="true">
              <span className="lens-key lens-key-bitcoin">In bitcoin</span>
              <span className="lens-key lens-key-dollars">In dollars</span>
              <span className="muted">
                {monthLabel(first.month, true)} = 100 · full months only
              </span>
            </div>
          </>
        )}
      </div>
      <div className="panel lens-stack">
        <span className="eyebrow">Your bitcoin</span>
        <strong className="money lens-held">
          {formatMoney(held, "BITCOIN")}
        </strong>
        {report.ownership.equivalents?.bitcoin.USD != null && (
          <small className="money muted">
            worth {formatMoney(report.ownership.equivalents.bitcoin.USD, "USD")}{" "}
            today
          </small>
        )}
        {stacked && (
          <p>
            {stackedSomething ? (
              <>
                <strong className="money">
                  {stacked.bitcoin.startsWith("-") ? "" : "+"}
                  {formatMoney(stacked.bitcoin, "BITCOIN")}
                </strong>{" "}
                stacked in {monthLabel(report.month, true)}
                {stacked.stack_rate !== null && (
                  <> · {stacked.stack_rate}% of income</>
                )}
              </>
            ) : (
              <>No bitcoin bought in {monthLabel(report.month, true)} yet.</>
            )}
          </p>
        )}
        <TrendArea
          points={report.history.map((point) => ({
            month: point.month,
            value: point.bitcoin_held ?? null,
          }))}
          unit="BITCOIN"
          label="Bitcoin held"
          height={120}
        />
      </div>
    </section>
  );
}
