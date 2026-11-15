import { useReportingUnit } from "../lib/monetaryLens";
import { conversionNote } from "../lib/conversionNote";
import { useState } from "react";
import type { Report, Transaction } from "../lib/types";
import { Money } from "./Money";
import { Button } from "./ui/button";
import { TransactionTable } from "./TransactionTable";
import { BarList, ChangeBadge, MonthBars } from "./Visuals";

export function IncomeView({
  report,
  transactions,
  onAdd,
  onEdit,
  onDelete,
  onCategory,
  onManageCategories,
}: {
  report: Report;
  transactions: Transaction[];
  onAdd: () => void;
  onEdit: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  onCategory: () => void;
  onManageCategories?: () => void;
}) {
  const unit = useReportingUnit(
    report.denomination === "USD" ? "USD" : "BITCOIN",
  );
  const secondary = unit === "USD" ? "BITCOIN" : "USD";
  const [search, setSearch] = useState("");
  const [chosenCategory, setCategory] = useState("");
  const [chosenAccount, setAccount] = useState("");
  const received = transactions.filter(
    (t) => t.kind === "income" && t.date.startsWith(report.month),
  );
  // A filter picked in another month only applies while that choice still exists here.
  const category = received.some((t) => t.category === chosenCategory)
    ? chosenCategory
    : "";
  const account = received.some((t) => t.account === chosenAccount)
    ? chosenAccount
    : "";
  const shown = received.filter(
    (t) =>
      (!category || t.category === category) &&
      (!account || t.account === account) &&
      `${t.description} ${t.notes}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sources = [...new Set(received.map((t) => t.category))].sort();
  const monthLabel = (month: string) =>
    new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  const monthName = monthLabel(report.month);
  const previous = report.history.at(-2);
  return (
    <>
      <section className="panel income-hero">
        <div className="income-hero-figure">
          <span className="eyebrow">Received in {monthName}</span>
          <Money
            value={report.dual?.[unit].income ?? null}
            unit={unit}
            className="holding-value"
          />
          <Money
            value={report.dual?.[secondary].income ?? null}
            unit={secondary}
            className="income-hero-secondary"
          />
          {previous && (
            <ChangeBadge
              from={previous.dual?.[unit].income}
              to={report.dual?.[unit].income}
              unit={unit}
              since={monthLabel(previous.month)}
            />
          )}
          <div className="button-row">
            <Button onClick={onAdd}>Record income</Button>
            <Button variant="outline" onClick={onCategory}>
              Add income category
            </Button>
            {onManageCategories && (
              <Button variant="ghost" onClick={onManageCategories}>
                Manage categories
              </Button>
            )}
          </div>
        </div>
        <div className="income-hero-chart">
          <h2>Income by month</h2>
          <MonthBars
            points={report.history.map((point) => ({
              month: point.month,
              value: point.dual?.[unit].income ?? null,
            }))}
            unit={unit}
            label="Income"
            highlight={report.month}
            color="var(--green)"
          />
        </div>
        <details className="income-hero-notes">
          <summary>How income is counted</summary>
          <p>
            Income is the sum of active income entries dated in this month.
            Record the amount actually received into an account, such as
            take-home pay. Transfers, opening balances and market gains are
            excluded.
          </p>
          <p className="hint native-flow-note">
            Original receipts:{" "}
            <Money value={report.native_flows.BITCOIN.income} unit="BITCOIN" />{" "}
            + <Money value={report.native_flows.USD.income} unit="USD" />.{" "}
            {conversionNote([report.dual?.BITCOIN, report.dual?.USD])} Edits and
            deletions preserve an audit trail.
          </p>
        </details>
      </section>
      <section className="panel income-panel">
        <div className="panel-heading">
          <h2>Income by source</h2>
          <span className="hint">
            {received.length} payment{received.length === 1 ? "" : "s"} this
            month
          </span>
        </div>
        <div className="panel-pad">
          <BarList
            unit={unit}
            color="var(--green)"
            empty="No income recorded this month. Add a payment to start tracking."
            items={sources.map((source) => ({
              key: source,
              label: source,
              value:
                report.dual?.[unit].income_categories?.find(
                  (c) => c.name === source,
                )?.value ?? null,
              onSelect: () => setCategory(category === source ? "" : source),
            }))}
          />
        </div>
      </section>
      <section className="panel income-panel">
        <div className="panel-heading">
          <h2>Income payments</h2>
          <span className="hint">
            {shown.length} shown · totals above include all payments
          </span>
        </div>
        <div className="filter-bar income-filters">
          <input
            aria-label="Search income"
            placeholder="Search income or notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Income category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Income account"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">All accounts</option>
            {[...new Set(received.map((t) => t.account))].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <TransactionTable rows={shown} onEdit={onEdit} onDelete={onDelete} />
      </section>
    </>
  );
}
