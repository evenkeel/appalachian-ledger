import type { SafeToSpend as Reading } from "../lib/types";
import { formatMoney } from "../lib/money";

/** A deduction shows as "−$x"; a deduction that went negative (money came back) as "+$x". */
function signed(value: string | null, sign: string) {
  if (sign && value?.startsWith("-"))
    return `+${formatMoney(value.slice(1), "USD")}`;
  return `${sign}${formatMoney(value, "USD")}`;
}

/** What is left of this month's income after spending, buying bitcoin and the bills still to come. */
export function SafeToSpend({
  reading,
  onBills,
}: {
  reading: Reading;
  onBills?: () => void;
}) {
  const otherMoved =
    !!reading.other_moved_usd && !/^-?0(\.0+)?$/.test(reading.other_moved_usd);
  const over = reading.amount?.startsWith("-") ?? false;
  const steps: [string, string | null, string][] = [
    ["Income so far", reading.income, ""],
    ["Spent", reading.spent, "−"],
    [
      `Bills still due${reading.bills_count ? ` (${reading.bills_count})` : ""}`,
      reading.bills_due,
      "−",
    ],
    ["Goals to fund", reading.goals, "−"],
  ];
  const renderStep = ([label, value, sign]: [
    string,
    string | null,
    string,
  ]) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd className="money">{signed(value, sign)}</dd>
    </div>
  );
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
              ? "Spending, bitcoin buys and upcoming bills add up to more than this month's income so far."
              : `About ${formatMoney(reading.per_day, "USD")} a day for the ${reading.days_left} day${reading.days_left === 1 ? "" : "s"} left this month.`}
        </p>
      </div>
      <dl className="safe-steps">
        {steps.slice(0, 2).map(renderStep)}
        <div className="safe-stacked">
          <dt>Bitcoin bought</dt>
          <dd className="money">
            {formatMoney(reading.bitcoin_bought, "BITCOIN")}
          </dd>
          <small className="money">
            for {formatMoney(reading.bitcoin_paid_usd, "USD")}
          </small>
        </div>
        {otherMoved &&
          renderStep(["Other transfers out", reading.other_moved_usd, "−"])}
        {steps.slice(2).map(renderStep)}
      </dl>
      <details className="safe-notes">
        <summary>How this is worked out</summary>
        <p>
          This month&rsquo;s recorded income, less what you have spent, less the
          dollars you put into bitcoin, less any other money moved out of
          checking or cash (savings, investing, loan payments), less unpaid
          bills due by month end, less what your dated goals still need this
          month. Card payments are not counted twice. It is a guide from your
          own records, not a forecast.
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
