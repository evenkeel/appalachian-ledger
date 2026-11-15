import type { SafeToSpend as Reading } from "../lib/types";
import { formatMoney } from "../lib/money";

/** What is left of this month's income after spending, buying bitcoin and the bills still to come. */
export function SafeToSpend({
  reading,
  onBills,
}: {
  reading: Reading;
  onBills?: () => void;
}) {
  const over = reading.amount?.startsWith("-") ?? false;
  const steps: [string, string | null, string][] = [
    ["Income so far", reading.income, ""],
    ["Spent", reading.spent, "−"],
    ["Bitcoin bought", reading.bitcoin_bought, "−"],
    [
      `Bills still due${reading.bills_count ? ` (${reading.bills_count})` : ""}`,
      reading.bills_due,
      "−",
    ],
    ["Goals to fund", reading.goals, "−"],
  ];
  return (
    <section
      className={`panel safe-to-spend${over ? " safe-over" : ""}`}
      aria-label="Safe to spend"
    >
      <div className="safe-figure">
        <h2>{over ? "Over this month by" : "Safe to spend"}</h2>
        {reading.amount === null ? (
          <strong className="safe-unavailable">Unavailable</strong>
        ) : (
          <strong className="money">
            {formatMoney(reading.amount.replace(/^-/, ""), "USD")}
          </strong>
        )}
        <p>
          {reading.amount === null
            ? "A bitcoin amount this month has no exchange rate yet, so the total would be a guess."
            : over
              ? "Spending, bitcoin bought and upcoming bills exceed this month's income so far."
              : `About ${formatMoney(reading.per_day, "USD")} a day for the ${reading.days_left} day${reading.days_left === 1 ? "" : "s"} left this month.`}
        </p>
      </div>
      <dl className="safe-steps">
        {steps.map(([label, value, sign]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="money">
              {sign}
              {formatMoney(value, "USD")}
            </dd>
          </div>
        ))}
      </dl>
      <details className="safe-notes">
        <summary>How this is worked out</summary>
        <p>
          This month&rsquo;s recorded income, less what you have spent, less the
          bitcoin you bought from everyday accounts, less unpaid bills due by
          month end, less what your dated goals still need this month. Card
          payments are not counted twice. It is a guide from your own records,
          not a forecast.
          {onBills && (
            <>
              {" "}
              <button type="button" className="text-link" onClick={onBills}>
                See upcoming bills
              </button>
            </>
          )}
        </p>
      </details>
    </section>
  );
}
