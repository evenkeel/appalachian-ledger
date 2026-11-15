import { useReportingUnit } from "../lib/monetaryLens";
import { conversionNote } from "../lib/conversionNote";
import { useState } from "react";
import type { Report, Transaction } from "../lib/types";
import { Money } from "./Money";
import { Button } from "./ui/button";
import { TransactionTable } from "./TransactionTable";

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
  const units = [unit, secondary] as const;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const received = transactions.filter(
    (t) => t.kind === "income" && t.date.startsWith(report.month),
  );
  const shown = received.filter(
    (t) =>
      (!category || t.category === category) &&
      (!account || t.account === account) &&
      `${t.description} ${t.notes}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sources = [...new Set(received.map((t) => t.category))].sort();
  return (
    <>
      <section className="panel income-intro">
        <div>
          <span className="eyebrow">INCOME RECEIVED · {report.month}</span>
          <Money
            value={report.dual?.[unit].income ?? null}
            unit={unit}
            className="holding-value"
          />
          <Money
            value={report.dual?.[secondary].income ?? null}
            unit={secondary}
          />
          <p className="hint native-flow-note">
            Original receipts:{" "}
            <Money value={report.native_flows.BITCOIN.income} unit="BITCOIN" />{" "}
            + <Money value={report.native_flows.USD.income} unit="USD" />
          </p>
        </div>
        <div>
          <h2>Income details</h2>
          <p>
            Income is the sum of active income entries dated in this month.
            Record the amount actually received into an account, such as
            take-home pay. Transfers, opening balances and market gains are
            excluded.
          </p>
          <p className="hint">
            {conversionNote([report.dual?.BITCOIN, report.dual?.USD])} Edits and
            deletions preserve an audit trail.
          </p>
          <div className="button-row">
            <Button onClick={onAdd}>Record income</Button>
            <Button variant="outline" onClick={onCategory}>
              Add income category
            </Button>
            {onManageCategories && (
              <Button variant="outline" onClick={onManageCategories}>
                Manage categories
              </Button>
            )}
          </div>
        </div>
      </section>
      <section className="panel income-panel">
        <div className="panel-heading">
          <h2>Income by source</h2>
          <span className="hint">
            All {received.length} payments this month
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                {units.map((unit) => (
                  <th key={unit} className="numeric">
                    {unit === "USD" ? "USD" : "bitcoin"} equivalent
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source}>
                  <td>{source}</td>
                  {units.map((unit) => (
                    <td key={unit} className="numeric">
                      <Money
                        value={
                          report.dual?.[unit].income_categories?.find(
                            (c) => c.name === source,
                          )?.value ?? null
                        }
                        unit={unit}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!sources.length && (
          <p className="trend-explanation">
            No income recorded this month. Add a payment to start tracking.
          </p>
        )}
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
