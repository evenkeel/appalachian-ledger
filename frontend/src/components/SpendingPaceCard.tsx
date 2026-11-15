import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Transaction } from "../lib/types";
import {
  analyzeSpending,
  decimalAmount,
  monthKey,
  type AnalysisUnit,
} from "../lib/spendingAnalysis";
import { formatMoney } from "../lib/money";
import { Button } from "./ui/button";

export function SpendingPaceCard({
  month,
  transactions,
  onOpen,
  now = new Date(),
}: {
  month: string;
  transactions: Transaction[];
  onOpen: () => void;
  now?: Date;
}) {
  const [unit, setUnit] = useState<AnalysisUnit>("USD");
  const analysis = analyzeSpending({
    month,
    transactions,
    categories: [],
    unit,
    now,
  });
  const baseline = transactions.some(
    (row) =>
      row.kind === "expense" &&
      row.date.startsWith(`${analysis.previousMonth}-`),
  );
  const money = (value: bigint | null) =>
    formatMoney(decimalAmount(value, unit), unit);
  const currentMonth = month === monthKey(now);
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString(
    undefined,
    { month: "short", year: "numeric" },
  );
  const change = analysis.change;
  const comparison = analysis.future
    ? "Spending will appear as expenses are recorded."
    : !baseline
      ? null
      : change === null
        ? "Comparison unavailable · missing saved conversion references."
        : `${change === 0n ? "Same recorded spending as" : `${money(change < 0n ? -change : change)} ${change < 0n ? "less" : "more"} than`} last month${currentMonth ? ` through day ${analysis.previousCutoff}` : ""}.`;
  const values = analysis.pace
    .map((point) => point.current)
    .filter((value): value is bigint => value !== null);
  const min = values.reduce((a, b) => (b < a ? b : a), 0n);
  const max = values.reduce((a, b) => (b > a ? b : a), 1n);
  // Scale chart coordinates only; recorded totals remain exact integers.
  let connected = false;
  const path = analysis.pace
    .map((point, index) => {
      if (point.current === null) {
        connected = false;
        return "";
      }
      const x = 6 + (index / (analysis.pace.length - 1)) * 308;
      const y =
        78 - Number(((point.current - min) * 6800n) / (max - min)) / 100;
      const segment = `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      connected = true;
      return segment;
    })
    .join(" ");
  return (
    <section className="panel overview-pace" aria-label="Spending Pace">
      <div className="panel-heading">
        <h2>Spending Pace</h2>
        <div
          className="currency-switch"
          role="group"
          aria-label="Spending pace currency"
        >
          {(["USD", "BITCOIN"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={unit === value}
              onClick={() => setUnit(value)}
            >
              {value === "USD" ? "USD" : "bitcoin"}
            </button>
          ))}
        </div>
      </div>
      <div className="overview-pace-body">
        <div>
          <span className="overview-pace-period">
            {monthLabel} ·{" "}
            {analysis.future
              ? "Upcoming month"
              : currentMonth
                ? "Month to date"
                : "Recorded spending"}
          </span>
          {comparison && <p>{comparison}</p>}
          {analysis.current.missing > 0 && (
            <p>
              {analysis.current.missing} expense
              {analysis.current.missing === 1 ? " needs" : "s need"} a saved
              conversion reference.
            </p>
          )}
        </div>
      </div>
      <div className="overview-pace-trend">
        <svg
          viewBox="0 0 320 88"
          role="img"
          aria-label={`Cumulative recorded spending for ${monthLabel}`}
        >
          <path d={path} className="overview-pace-current" />
        </svg>
      </div>
      <div className="overview-pace-footer">
        <strong className="overview-pace-total">
          {analysis.future ? "—" : money(analysis.current.value)}
        </strong>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          View expenses <ArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}
