import { useReportingUnit } from "../lib/monetaryLens";
import { parseMinor, decimalAmount } from "../lib/spendingAnalysis";
import type { Category, Report } from "../lib/types";
import { conversionNote } from "../lib/conversionNote";
import { Money } from "./Money";
import { formatMoney } from "../lib/money";
import { LiquidUSD } from "./LiquidUSD";

function point(percent: number, radius: number) {
  const angle =
    ((180 + Math.max(0, Math.min(120, percent)) * 1.5) * Math.PI) / 180;
  return {
    x: 150 + Math.cos(angle) * radius,
    y: 137 + Math.sin(angle) * radius,
  };
}

export function LifestyleGauge({ ratio }: { ratio: number | null }) {
  const needle = ratio === null ? null : point(ratio, 89);
  const status =
    ratio === null
      ? "Unavailable"
      : ratio >= 100
        ? "Critical"
        : ratio >= 80
          ? "High"
          : ratio >= 60
            ? "Elevated"
            : "Controlled";
  const color =
    ratio === null
      ? "var(--muted)"
      : ratio >= 100
        ? "#e46861"
        : ratio >= 80
          ? "#e89a4b"
          : ratio >= 60
            ? "#d4b558"
            : "#84b69d";
  return (
    <div className="lifestyle-instrument">
      <svg
        viewBox="0 0 300 190"
        role="img"
        aria-label={`Spending Pressure: ${ratio === null ? "reading unavailable" : `${ratio.toFixed(1)}% of income spent`}`}
      >
        {[
          { start: 0, end: 60, color: "#84b69d" },
          { start: 60, end: 80, color: "#d4b558" },
          { start: 80, end: 100, color: "#e89a4b" },
          { start: 100, end: 120, color: "#e46861" },
        ].map((band) => {
          const start = point(band.start + 0.7, 110),
            end = point(band.end - 0.7, 110);
          return (
            <path
              key={band.start}
              d={`M${start.x},${start.y} A110,110 0 0,1 ${end.x},${end.y}`}
              fill="none"
              stroke={band.color}
              strokeWidth="13"
              opacity={ratio === null ? 0.25 : 1}
            />
          );
        })}
        {[0, 60, 80, 100, 120].map((tick) => {
          const inner = point(tick, 96),
            outer = point(tick, 119),
            label = point(tick, 136);
          return (
            <g key={tick}>
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke={tick === 100 ? "#e46861" : "var(--muted)"}
                strokeWidth={tick === 100 ? 3 : 1}
              />
              <text
                x={label.x}
                y={label.y + 4}
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="10"
              >
                {tick === 120 ? "120+" : tick}
              </text>
            </g>
          );
        })}
        {needle && (
          <>
            <line
              x1="150"
              y1="137"
              x2={needle.x}
              y2={needle.y}
              stroke="var(--text)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="150" cy="137" r="6" fill="var(--text)" />
          </>
        )}
        <text
          x="150"
          y="157"
          textAnchor="middle"
          fill={color}
          fontSize="12"
          fontWeight="600"
        >
          {status}
        </text>
        <text
          x="150"
          y="185"
          textAnchor="middle"
          fill={color}
          fontSize="28"
          fontWeight="600"
        >
          {ratio === null ? "—" : `${ratio.toFixed(1)}%`}
        </text>
      </svg>
    </div>
  );
}

export function CashflowCockpit({
  report,
}: {
  report: Report;
  categories: Category[];
  onSaved: (message: string) => void;
}) {
  // Use both currencies converted into the same unit; native USD alone omits Bitcoin activity.
  const unit = useReportingUnit("USD");
  const flow = report.dual?.[unit];
  const income = flow?.income == null ? null : Number(flow.income);
  const expenses = flow?.expenses == null ? null : Number(flow.expenses);
  const ratio =
    income !== null && income > 0 && expenses !== null
      ? (expenses / income) * 100
      : null;
  const [year, month] = report.month.split("-").map(Number);
  const now = new Date();
  const current = now.getFullYear() === year && now.getMonth() + 1 === month;
  const period = new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  // Months before the first recorded activity are not part of the average.
  const active = (row: Report["history"][number]) =>
    (["USD", "BITCOIN"] as const).some((currency) =>
      [row.dual?.[currency].income, row.dual?.[currency].expenses].some(
        (value) => value != null && Number(value) !== 0,
      ),
    );
  const firstActive = (report.history ?? []).findIndex(active);
  const completeMonths = (report.history ?? [])
    .slice(Math.max(firstActive, 0))
    .filter(
      (row) =>
        row.month <= report.month &&
        row.month <
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    )
    .slice(-3);
  const burnTotal =
    completeMonths.length &&
    completeMonths.every((row) => row.dual?.[unit].expenses != null)
      ? completeMonths.reduce(
          (sum, row) => sum + parseMinor(row.dual![unit].expenses!, unit),
          0n,
        )
      : null;
  // Positive amounts only: half-even division keeps averages in exact minor units.
  const average = (multiplier: bigint) => {
    if (burnTotal === null) return null;
    const numerator = burnTotal * multiplier,
      denominator = BigInt(completeMonths.length);
    const quotient = numerator / denominator,
      remainder = numerator % denominator;
    return decimalAmount(
      quotient +
        (remainder * 2n > denominator ||
        (remainder * 2n === denominator && quotient % 2n === 1n)
          ? 1n
          : 0n),
      unit,
    );
  };
  return (
    <section className="financial-instruments" aria-label="Income and spending">
      <div className="cockpit-grid">
        <article className="cockpit-heat">
          <h3>Spending Pressure</h3>
          <LifestyleGauge ratio={ratio} />
        </article>
        <article
          className="cockpit-readings"
          aria-label={`Monthly readings · ${period} · ${current ? "month so far" : "full month"}`}
        >
          <LiquidUSD accounts={report.accounts} />
          <div>
            <span>Lifestyle cost</span>
            <Money value={flow?.expenses} unit={unit} />
            <small>Expenses recorded this period</small>
          </div>
          <div className="cockpit-stacked">
            <span>Bitcoin stacked</span>
            <Money value={report.stacked?.bitcoin ?? null} unit="BITCOIN" />
            <small>
              {report.stacked?.usd != null
                ? `${formatMoney(report.stacked.usd, "USD")} of income turned into bitcoin`
                : "Bought with dollars this period"}
            </small>
          </div>
          <div>
            <span>Stack rate</span>
            <strong>
              {report.stacked?.stack_rate == null
                ? "—"
                : `${report.stacked.stack_rate}%`}
            </strong>
            <small>Share of income turned into bitcoin</small>
          </div>

          <div>
            <span className="cockpit-eyebrow">Recorded burn rate</span>
            <Money value={average(1n)} unit={unit} />
            <span className="hint"> / month</span>
          </div>
          <div>
            <span className="cockpit-eyebrow">Annualized lifestyle cost</span>
            <Money value={average(12n)} unit={unit} />
            <span className="hint"> / year</span>
          </div>
        </article>
      </div>
      <details className="cockpit-method">
        <summary>About these readings</summary>
        <p className="hint">
          {completeMonths.length
            ? `Average recorded expenses across ${completeMonths.length} completed ${completeMonths.length === 1 ? "month" : "months"} (${completeMonths[0].month}–${completeMonths.at(-1)!.month}). Annualized pace, not a forecast.`
            : "A completed month of expense history is needed for a burn-rate reading."}
        </p>
        <p>
          Everyday Cash totals active USD checking balances as of the selected
          reporting period, including any overdrafts. Accounts marked “Exclude
          from Everyday Cash” are reserved outside everyday spending cash. These
          remain in total USD cash and net worth. Everyday Cash excludes
          savings, investments, physical cash, and archived accounts, and stays
          in USD when the reporting currency changes. The other readings compare
          recorded income and expenses in the same month. During an unfinished
          month, paycheck and bill timing can move the needle sharply. They are
          observations, not spending limits. The green, amber, orange, and red
          bands are visual guides, not personalized targets. Bitcoin stacked
          counts dollars moved from checking or cash into your bitcoin wallets,
          net of any sold back; the stack rate is those dollars as a share of
          the month&rsquo;s income.
        </p>
        <p>
          Burn rate uses up to three completed months ending in the selected
          period. Annualized cost multiplies that monthly average by twelve; it
          depends on the completeness of your records. Missing conversions leave
          the reading unavailable.
        </p>
        <p>{conversionNote([flow])}</p>
      </details>
    </section>
  );
}
