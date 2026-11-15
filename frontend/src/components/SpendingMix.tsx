import type { Category, Transaction } from "../lib/types";
import { useReportingUnit } from "../lib/monetaryLens";
import { analyzeSpending, decimalAmount } from "../lib/spendingAnalysis";
import { formatMoney } from "../lib/money";

const colors = [
  "#df8547",
  "#b47bd5",
  "#84b69d",
  "#acc4cf",
  "#d4b558",
  "#e46861",
  "#76a9db",
];

export function SpendingMix({
  month,
  transactions,
  categories,
  now = new Date(),
}: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
  now?: Date;
}) {
  const unit = useReportingUnit("USD");
  const analysis = analyzeSpending({
    month,
    transactions,
    categories,
    unit,
    now,
  });
  const rows = analysis.categories
    .filter((row) => row.current.count > 0)
    .sort((a, b) => {
      const delta = (b.current.value ?? 0n) - (a.current.value ?? 0n);
      return delta > 0n ? 1 : delta < 0n ? -1 : a.name.localeCompare(b.name);
    });
  const share = (value: bigint | null) =>
    value !== null &&
    analysis.current.value !== null &&
    analysis.current.value > 0n
      ? Number((value * 10000n) / analysis.current.value) / 100
      : null;
  const total = analysis.current.value;
  const proportional =
    total !== null &&
    total > 0n &&
    rows.every((row) => row.current.value !== null && row.current.value > 0n);
  const weights = rows.map((row) =>
    proportional ? Number(row.current.value!) / Number(total!) : 1,
  );
  const chartHeight = 360;
  return (
    <section className="panel overview-spending-mix" aria-label="Spending Mix">
      <h2>Spending Mix</h2>
      {rows.length === 0 && (
        <p className="hint">No recorded expenses this month.</p>
      )}
      {rows.length > 0 && (
        <div
          className="category-mix-list"
          style={{
            height: chartHeight,
            gridTemplateRows: weights
              .map((weight) => `minmax(0, ${weight}fr)`)
              .join(" "),
          }}
          role="list"
          aria-label="Expense categories"
        >
          {rows.map((row, index) => (
            <div key={row.key} role="listitem" className="category-mix-row">
              <i
                className="category-mix-color"
                style={{
                  background: proportional
                    ? colors[index % colors.length]
                    : "var(--border)",
                }}
                aria-hidden="true"
              />
              <span className="category-mix-name">{row.name}</span>
              <div className="category-mix-amount">
                <strong>
                  {formatMoney(decimalAmount(row.current.value, unit), unit)}
                </strong>
                <small>
                  {share(row.current.value) === null
                    ? "—"
                    : `${share(row.current.value)!.toFixed(1)}%`}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
      {analysis.current.missing > 0 && (
        <p className="hint">
          Category shares need saved conversion references.
        </p>
      )}
    </section>
  );
}
