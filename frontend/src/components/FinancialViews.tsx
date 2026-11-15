import type { ReactNode } from "react";
import { SortableCards } from "./SortableCards";
import { conversionNote } from "../lib/conversionNote";
import { useState } from "react";
import { ArrowRight, Download } from "lucide-react";
import type {
  BudgetOverview,
  Category,
  Flow,
  Ownership,
  Report,
  Transaction,
} from "../lib/types";
import { CashflowCockpit } from "./CashflowCockpit";
import { type Denomination, unitLabel } from "../lib/money";
import { Money } from "./Money";
import { NetWorth, DenominationTrends, ToggleAmounts } from "./WealthOverview";
import { AllocationOverview } from "./AllocationOverview";
import { BitcoinDominance } from "./BitcoinDominance";
import { SpendingMix } from "./SpendingMix";
import { DebtGauge } from "./DebtGauge";
import { HistoryChart } from "./Charts";
import { Button } from "./ui/button";
import { BarList } from "./Visuals";
import { SafeToSpend } from "./SafeToSpend";
import { BitcoinLens } from "./BitcoinLens";
import { MonthlyRecap } from "./MonthlyRecap";
import { CashFlowDiagram } from "./CashFlowDiagram";

export function CurrencyToggle({
  unit,
  onChange,
  disabled,
}: {
  unit: Denomination;
  onChange: (unit: Denomination) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="currency-switch"
      role="group"
      aria-label="Reporting currency"
    >
      {(["USD", "BITCOIN"] as const).map((value) => (
        <button
          key={value}
          disabled={disabled}
          aria-pressed={unit === value}
          onClick={() => onChange(value)}
        >
          {unitLabel(value)}
        </button>
      ))}
      {unit === "BTC" && (
        <button aria-pressed="true" disabled>
          Legacy BTC
        </button>
      )}
    </div>
  );
}

function NativeAmounts({
  amounts,
}: {
  amounts: Record<"USD" | "BITCOIN", string>;
}) {
  const currencies = (["USD", "BITCOIN"] as const).filter(
    (currency) => !/^0(?:\.0+)?$/.test(amounts[currency]),
  );
  return (
    <div className="native-balances">
      {(currencies.length ? currencies : (["USD"] as const)).map((currency) => (
        <Money
          key={currency}
          value={amounts[currency]}
          unit={currency}
          className="holding-value"
        />
      ))}
    </div>
  );
}

export function OwnershipCards({
  ownership,
  asOf,
}: {
  ownership: Ownership;
  asOf: string;
}) {
  return (
    <section aria-label="Balances" className="ownership-section">
      <SortableCards
        scope="overview-balances"
        className="ownership-grid"
        title={`Balances as of ${asOf}`}
        itemId={(item) => item.kind}
        itemLabel={(item) => item.name}
        items={
          [
            {
              kind: "bitcoin",
              label: "bitcoin",
              name: "Bitcoin holdings",
              initialUnit: "BITCOIN",
              fallback: { BITCOIN: ownership.bitcoin_held, USD: null },
            },
            {
              kind: "dollars",
              label: "USD cash",
              name: "USD cash",
              initialUnit: "USD",
              fallback: { BITCOIN: null, USD: ownership.usd_held },
            },
            {
              kind: "valued_asset",
              label: "Other assets",
              name: "Other assets",
              initialUnit: "BITCOIN",
              fallback: { BITCOIN: null, USD: ownership.valued_assets_usd },
            },
            {
              kind: "debt",
              label: "Liabilities",
              name: "Liabilities",
              initialUnit: "BITCOIN",
              fallback: { BITCOIN: null, USD: ownership.liabilities_usd },
            },
          ] as const
        }
        renderItem={({ kind, label, name, initialUnit, fallback }, handle) => (
          <article
            key={kind}
            aria-label={name}
            className={`panel holding-card holding-${kind}`}
          >
            <div className="holding-card-heading">
              <h2>{label}</h2>
              {handle}
            </div>
            <ToggleAmounts
              label={name.toLowerCase()}
              initialUnit={initialUnit}
              values={ownership.equivalents?.[kind] ?? fallback}
            />
            {(kind === "valued_asset" || kind === "debt") && (
              <details className="holding-originals">
                <summary>Original balances</summary>
                <NativeAmounts
                  amounts={
                    kind === "valued_asset"
                      ? ownership.native_other_assets
                      : ownership.native_liabilities
                  }
                />
              </details>
            )}
          </article>
        )}
      />
    </section>
  );
}

function NativeFlows({
  flows,
  native,
  onIncome,
  overview = false,
}: {
  flows: Record<"USD" | "BITCOIN", Flow>;
  native: Record<"USD" | "BITCOIN", Flow>;
  onIncome?: () => void;
  overview?: boolean;
}) {
  if (overview) {
    return (
      <section
        className="panel overview-activity"
        aria-label="Monthly activity"
      >
        <div className="overview-activity-grid">
          {(["income", "expenses"] as const).map((kind) => (
            <div
              key={kind}
              role="group"
              aria-label={kind === "income" ? "Income" : "Expenses"}
            >
              <h2>
                {kind === "income" && onIncome ? (
                  <button onClick={onIncome} aria-label="Income · manage">
                    Income <ArrowRight size={14} />
                  </button>
                ) : kind === "income" ? (
                  "Income"
                ) : (
                  "Expenses"
                )}
              </h2>
              <ToggleAmounts
                label={kind}
                values={{ BITCOIN: flows.BITCOIN[kind], USD: flows.USD[kind] }}
              />
            </div>
          ))}
        </div>
        <details className="history-details">
          <summary>Activity details</summary>
          <div className="trend-explanation">
            {(["income", "expenses"] as const).map((kind) => (
              <p key={kind}>
                {kind === "income" ? "Income" : "Expenses"} · original amounts:{" "}
                <Money value={native.BITCOIN[kind]} unit="BITCOIN" /> +{" "}
                <Money value={native.USD[kind]} unit="USD" />
              </p>
            ))}
            <small>{conversionNote([flows.BITCOIN, flows.USD])}</small>
          </div>
        </details>
      </section>
    );
  }
  return (
    <section className="panel cashflow-summary" aria-label="Monthly activity">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <span className="sr-only">Activity</span>
              </th>
              <th className="numeric">bitcoin equivalent</th>
              <th className="numeric">USD equivalent</th>
            </tr>
          </thead>
          <tbody>
            {(["income", "expenses"] as const).map((kind) => (
              <tr key={kind}>
                <td>
                  {kind === "income" && onIncome ? (
                    <Button variant="ghost" size="sm" onClick={onIncome}>
                      Income · manage <ArrowRight size={13} />
                    </Button>
                  ) : kind === "income" ? (
                    "Income"
                  ) : (
                    "Expenses"
                  )}
                  <small className="native-flow-note">
                    Original amounts:{" "}
                    <Money value={native.BITCOIN[kind]} unit="BITCOIN" /> +{" "}
                    <Money value={native.USD[kind]} unit="USD" />
                  </small>
                </td>
                {(["BITCOIN", "USD"] as const).map((currency) => (
                  <td className="numeric" key={currency}>
                    <Money value={flows[currency][kind]} unit={currency} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="trend-explanation">
        {conversionNote([flows.BITCOIN, flows.USD])}
      </p>
    </section>
  );
}

export function OverviewView({
  utilities,
  expenses,
  spendingPace,
  transactions = [],
  categories = [],
  report,
  period,
  onPeriod,
  onIncome,
  onBills,
  onSaved = () => {},
}: {
  utilities?: ReactNode;
  expenses?: ReactNode;
  spendingPace?: ReactNode;
  transactions?: Transaction[];
  categories?: Category[];
  report: Report;
  period: string;
  onPeriod: (period: string) => void;
  onTransactions: () => void;
  onUnit: (unit: Denomination) => void;
  loading: boolean;
  onIncome?: () => void;
  onBills?: () => void;
  onSaved?: (message: string) => void;
}) {
  return (
    <>
      <BitcoinLens report={report} />
      {report.safe_to_spend && (
        <SafeToSpend reading={report.safe_to_spend} onBills={onBills} />
      )}
      <div className="overview-summary" aria-label="Financial overview">
        <NetWorth report={report} />
        {spendingPace}
        <CashflowCockpit
          report={report}
          categories={categories}
          onSaved={onSaved}
        />
        <div className="overview-side-readings">
          {expenses}
          <DebtGauge
            data={
              report.debt_gauge ?? {
                debt_usd: null,
                limits: null,
                level: null,
                position: null,
              }
            }
            onSaved={onSaved}
          />
        </div>
        <AllocationOverview report={report} />
        <SpendingMix
          month={report.month}
          transactions={transactions}
          categories={categories}
        />
        <BitcoinDominance report={report} />
      </div>
      <div className="overview-balances">
        <OwnershipCards
          ownership={report.ownership}
          asOf={report.history.at(-1)?.date ?? report.month}
        />
      </div>
      <div className="overview-utilities">{utilities}</div>
      <details className="overview-activity-details">
        <summary>Activity in both currencies</summary>
        <NativeFlows
          flows={report.dual ?? report.native_flows}
          native={report.native_flows}
          onIncome={onIncome}
          overview
        />
      </details>
      <DenominationTrends report={report} period={period} onPeriod={onPeriod} />
    </>
  );
}

function PeriodSelect({
  period,
  onPeriod,
}: {
  period: string;
  onPeriod: (period: string) => void;
}) {
  return (
    <select
      aria-label="History period"
      value={period}
      onChange={(e) => onPeriod(e.target.value)}
    >
      <option value="6">6 months</option>
      <option value="12">12 months</option>
      <option value="24">2 years</option>
      <option value="60">5 years</option>
      <option value="120">10 years</option>
    </select>
  );
}

export function ReportsView({
  report,
  period,
  onPeriod,
  onExport,
  transactions = [],
  budgets = [],
}: {
  report: Report;
  period: string;
  onPeriod: (period: string) => void;
  onExport: () => void;
  transactions?: Transaction[];
  budgets?: BudgetOverview[];
}) {
  const [source, setSource] = useState<"all" | "USD" | "BITCOIN">("all");
  const [accountId, setAccountId] = useState("");
  const unit = report.denomination;
  const currentFlow = source === "all" ? report : report.flows[source];
  const flowHistory = report.history.map((row) =>
    source === "all" ? row : { ...row, ...row.flows[source] },
  );
  const investmentAccounts = report.accounts.filter((a) => a.role === "asset");
  const selected =
    investmentAccounts.find((a) => String(a.id) === accountId) ??
    investmentAccounts.find((a) => a.holding_type === "bitcoin") ??
    investmentAccounts.find((a) => a.holding_type === "valued_asset") ??
    investmentAccounts[0];
  const performance = report.performance.find(
    (p) => p.account_id === selected?.id,
  );
  const valueHistory = report.history.map((h) => ({
    ...h,
    net_worth: h.accounts.find((a) => a.id === selected?.id)?.value ?? null,
  }));
  return (
    <>
      <div className="section-toolbar">
        <span />
        <div className="button-row">
          <PeriodSelect period={period} onPeriod={onPeriod} />
          <Button variant="outline" onClick={onExport}>
            <Download size={15} />
            Export journal
          </Button>
        </div>
      </div>
      <MonthlyRecap
        report={report}
        transactions={transactions}
        budgets={budgets}
      />
      <section className="panel cash-flow-panel">
        <div className="panel-heading">
          <div>
            <h2>Where the money went</h2>
            <span className="hint">
              Income on the left; spending, bitcoin stacked and cash left on the
              right
            </span>
          </div>
          <span className="tag">{report.month}</span>
        </div>
        <CashFlowDiagram report={report} />
      </section>
      <section className="panel investment-panel">
        <div className="panel-heading">
          <div>
            <h2>Account history</h2>
          </div>
          <select
            aria-label="Investment or holding account"
            value={selected?.id ?? ""}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {!investmentAccounts.length && (
              <option value="">No asset accounts</option>
            )}
            {investmentAccounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {performance ? (
          <>
            <div className="performance-grid">
              <div>
                <span>Starting value · {performance.start_date}</span>
                <Money value={performance.start_value} unit={unit} />
              </div>
              <div>
                <span>Net additions & adjustments</span>
                <Money value={performance.net_additions} unit={unit} />
              </div>
              <div>
                <span>Valuation & exchange-rate change</span>
                <Money value={performance.value_change} unit={unit} />
              </div>
              <div>
                <span>Ending value · {performance.end_date}</span>
                <Money value={performance.end_value} unit={unit} />
              </div>
            </div>
            <HistoryChart
              history={valueHistory}
              unit={unit}
              title={`${selected.name} value history`}
            />
            <details className="history-details">
              <summary>Details</summary>
              <p className="chart-note">
                Change excludes net additions and includes valuation and
                exchange-rate changes. It is not an investment return
                percentage.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="numeric">Original balance</th>
                      <th className="numeric">{unitLabel(unit)} equivalent</th>
                      <th>Rate date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.history.map((h) => {
                      const a = h.accounts.find((a) => a.id === selected.id)!;
                      return (
                        <tr key={h.month}>
                          <td>{h.date}</td>
                          <td className="numeric">
                            <Money value={a.balance} unit={a.currency} />
                          </td>
                          <td className="numeric">
                            <Money value={a.value} unit={unit} />
                          </td>
                          <td>
                            {a.currency === unit
                              ? "Not required"
                              : (h.rate_day ?? "Unavailable")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <p className="empty-inline">
            Create an asset account to build its history.
          </p>
        )}
      </section>
      <div className="section-toolbar flow-toolbar">
        <div>
          <h2>Cash flow</h2>
        </div>
        <select
          aria-label="Activity currency"
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
        >
          <option value="all">All activity · converted</option>
          <option value="USD">Originally USD</option>
          <option value="BITCOIN">Originally bitcoin</option>
        </select>
      </div>
      <NativeFlows
        flows={report.dual ?? report.native_flows}
        native={report.native_flows}
      />
      <div className="report-chart-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Income vs. expenses</h2>
            <span className="tag">
              {unitLabel(unit)} ·{" "}
              {source === "all"
                ? "all activity"
                : `originally ${unitLabel(source)}`}
            </span>
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: "var(--blue)" }} />
              Income
            </span>
            <span>
              <i style={{ background: "var(--accent)" }} />
              Expenses
            </span>
          </div>
          <HistoryChart history={flowHistory} unit={unit} flows />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Spending by category · {report.month}</h2>
          </div>
          <div className="panel-pad">
            <BarList
              unit={unit}
              empty="No spending in this currency and period."
              items={currentFlow.categories.map((c) => ({
                key: c.name,
                label: c.name,
                value: c.value,
              }))}
            />
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Monthly comparison · {unitLabel(unit)}</h2>
          <span className="hint">
            Flow filter:{" "}
            {source === "all" ? "all currencies" : unitLabel(source)}
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="numeric">Income</th>
                <th className="numeric">Expenses</th>
                <th className="numeric">Expenses in bitcoin</th>
                <th className="numeric">Bitcoin stacked</th>
              </tr>
            </thead>
            <tbody>
              {flowHistory.map((h) => (
                <tr key={h.month}>
                  <td>{h.month}</td>
                  <td className="numeric">
                    <Money value={h.income} unit={unit} />
                  </td>
                  <td className="numeric">
                    <Money value={h.expenses} unit={unit} />
                  </td>
                  <td className="numeric">
                    <Money
                      // Priced at each purchase date's rate; shown for all activity only.
                      value={
                        source === "all"
                          ? (h.dual?.BITCOIN.expenses ?? null)
                          : null
                      }
                      unit="BITCOIN"
                    />
                  </td>
                  <td className="numeric">
                    {h.stacked ? (
                      <span className="rate-meter">
                        <i aria-hidden="true">
                          <b
                            style={{
                              width: `${Math.min(Math.max(Number(h.stacked.stack_rate ?? 0), 0), 100)}%`,
                            }}
                          />
                        </i>
                        <Money value={h.stacked.bitcoin} unit="BITCOIN" />
                        {h.stacked.stack_rate !== null && (
                          <small className="muted">
                            {" "}
                            · {h.stacked.stack_rate}%
                          </small>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
