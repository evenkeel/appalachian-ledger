import { useReportingUnit } from "../lib/monetaryLens";
import { formatMoney, percentChange, subtractMoney } from "../lib/money";
import type { BudgetOverview, Report, Transaction } from "../lib/types";
import { ChangeBadge, StatTile } from "./Visuals";

const monthName = (month: string, year = true) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: year ? "numeric" : undefined,
  });

/** The selected month in a few sentences, compared with the month before. */
export function MonthlyRecap({
  report,
  transactions,
  budgets,
}: {
  report: Report;
  transactions: Transaction[];
  budgets: BudgetOverview[];
}) {
  const unit = useReportingUnit("USD");
  const current = report.history.at(-1),
    previous = report.history.at(-2);
  const now = current?.dual?.[unit],
    before = previous?.dual?.[unit];
  if (!current || !now) return null;
  const today = new Date();
  const inProgress =
    report.month ===
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const stacked = current.stacked;
  const value = (row: Transaction) =>
    row.currency === unit ? row.amount : unit === "USD" ? row.usd : row.bitcoin;
  const expenses = transactions.filter(
    (row) => row.kind === "expense" && row.date.startsWith(report.month),
  );
  const largest = expenses
    .filter((row) => value(row) != null)
    .sort((a, b) => Number(value(b)) - Number(value(a)))[0];
  const categories = [...now.categories]
    .filter((c) => c.value != null)
    .sort((a, b) => Number(b.value) - Number(a.value));
  const top = categories[0];
  const spent = Number(now.expenses ?? 0);
  // The biggest mover is only meaningful between two complete months.
  const mover = inProgress
    ? undefined
    : categories
        .map((category) => ({
          name: category.name,
          change: subtractMoney(
            category.value,
            before?.categories.find((c) => c.name === category.name)?.value ??
              "0",
          ),
        }))
        .filter((row) => row.change && Number(row.change) > 0)
        .sort((a, b) => Number(b.change) - Number(a.change))[0];
  const overBudget = budgets.filter((b) => b.remaining_usd?.startsWith("-"));
  const highlights: string[] = [];
  // The core comparison: what a month of living cost in bitcoin, against the month before.
  const bitcoinNow = current.dual?.BITCOIN.expenses,
    bitcoinBefore = previous?.dual?.BITCOIN.expenses;
  const bitcoinChange = inProgress
    ? null
    : percentChange(bitcoinBefore, bitcoinNow);
  if (bitcoinChange !== null && previous)
    highlights.push(
      `Your spending cost ${formatMoney(bitcoinNow, "BITCOIN")}, ${Math.abs(bitcoinChange) < 0.5 ? "about the same bitcoin as" : `${Math.abs(bitcoinChange).toFixed(0)}% ${bitcoinChange < 0 ? "less" : "more"} bitcoin than`} ${monthName(previous.month, false)}.`,
    );
  if (top && spent > 0)
    highlights.push(
      `${top.name} was the largest category at ${formatMoney(top.value, unit)}, ${Math.round((Number(top.value) / spent) * 100)}% of spending.`,
    );
  if (largest)
    highlights.push(
      `The biggest single expense was ${largest.description} (${formatMoney(value(largest), unit)}).`,
    );
  if (mover)
    highlights.push(
      `${mover.name} rose the most, up ${formatMoney(mover.change, unit)} on ${monthName(previous!.month, false)}.`,
    );
  if (overBudget.length)
    highlights.push(
      `${overBudget.length === 1 ? `${overBudget[0].category} went` : `${overBudget.length} categories went`} over budget.`,
    );
  else if (budgets.some((b) => b.planned_usd !== null))
    highlights.push("Every budgeted category stayed within its plan.");
  if (!expenses.length) highlights.push("No expenses were recorded.");
  return (
    <section className="panel monthly-recap" aria-label="Monthly recap">
      <div className="panel-heading">
        <div>
          <h2>{monthName(report.month)} recap</h2>
          <span className="hint">
            {inProgress
              ? `Month in progress · through ${today.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : previous
                ? `Compared with ${monthName(previous.month)}`
                : "First month on record"}
          </span>
        </div>
        {stacked?.stack_rate != null && (
          <span className="recap-rate">
            <strong>{stacked.stack_rate}%</strong> of income stacked
          </span>
        )}
      </div>
      <div className="recap-body">
        <div className="stat-row">
          <StatTile
            label="Income"
            hint={
              previous && !inProgress ? (
                <ChangeBadge
                  from={before?.income}
                  to={now.income}
                  unit={unit}
                />
              ) : undefined
            }
          >
            {formatMoney(now.income, unit)}
          </StatTile>
          <StatTile
            label="Spending"
            hint={
              previous && !inProgress ? (
                <ChangeBadge
                  from={before?.expenses}
                  to={now.expenses}
                  unit={unit}
                  goodWhen="down"
                />
              ) : undefined
            }
          >
            {formatMoney(now.expenses, unit)}
          </StatTile>
          <StatTile
            label="Bitcoin stacked"
            tone="accent"
            hint={
              stacked?.usd != null ? (
                <small>for {formatMoney(stacked.usd, "USD")}</small>
              ) : undefined
            }
          >
            {formatMoney(stacked?.bitcoin ?? null, "BITCOIN")}
          </StatTile>
          <StatTile
            label="Bitcoin held"
            hint={
              previous ? (
                <ChangeBadge
                  from={previous.bitcoin_held}
                  to={current.bitcoin_held}
                  unit="BITCOIN"
                />
              ) : undefined
            }
          >
            {formatMoney(current.bitcoin_held ?? null, "BITCOIN")}
          </StatTile>
        </div>
        {highlights.length > 0 && (
          <ul className="recap-highlights">
            {highlights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
