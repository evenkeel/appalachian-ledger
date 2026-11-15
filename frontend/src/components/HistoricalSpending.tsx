import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useReportingUnit } from "../lib/monetaryLens";
import type { Account, Category } from "../lib/types";
import { today, Field } from "./EntryDialog";
import { Money } from "./Money";
import { ProjectionChart } from "./ProjectionChart";

interface Summary {
  count: number;
  usd: string | null;
  bitcoin: string | null;
  hypothetical_value_usd: string | null;
  missing_usd: number;
  missing_bitcoin: number;
}
interface HistoricalData {
  totals: Summary;
  periods: (Summary & { period: string })[];
  categories: (Summary & { name: string })[];
  transactions: {
    id: number;
    date: string;
    description: string;
    category: string;
    account: string;
    amount: string;
    currency: "USD" | "BITCOIN";
    usd: string | null;
    bitcoin: string | null;
    rate: string | null;
    source: string | null;
    method: string;
    hypothetical_value_usd: string | null;
  }[];
  transactions_truncated: boolean;
  current_reference: {
    price_usd: string;
    day: string;
    source: string;
    older: boolean;
  } | null;
}
export function HistoricalSpending({
  accounts,
  categories,
  revision,
}: {
  accounts: Account[];
  categories: Category[];
  revision: number;
}) {
  const unit = useReportingUnit("USD");
  const [range, setRange] = useState("year");
  const [start, setStart] = useState(`${today().slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(today());
  const [interval, setInterval] = useState("month");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const [opportunity, setOpportunity] = useState(false);
  const [data, setData] = useState<HistoricalData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    const beginning = range === "year" ? `${today().slice(0, 4)}-01-01` : start;
    const finish = range === "year" ? today() : end;
    const query = new URLSearchParams({
      start: beginning,
      end: finish,
      interval,
    });
    if (category) query.set("category_id", category);
    if (account) query.set("account_id", account);
    api<HistoricalData>(`/spending-history?${query}`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [start, end, range, interval, category, account, revision]);
  return (
    <div className="panel-body stack">
      <div className="planning-fields">
        <Field label="History range">
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="year">This year</option>
            <option value="custom">Custom dates</option>
          </select>
        </Field>
        {range === "custom" && (
          <>
            <Field label="History start">
              <input
                type="date"
                value={start}
                min="1970-01-01"
                max={today()}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="History end">
              <input
                type="date"
                value={end}
                min={start}
                max={today()}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Group spending by">
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </Field>
        <Field label="Historical expense category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All expense categories</option>
            {categories
              .filter((c) => c.kind === "expense")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Historical expense account">
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="hint">
        Each expense is converted at its own transaction-date reference before
        summing. Saved purchase costs take precedence. Completed UTC daily
        references, explicit manual rates and legacy snapshots keep their source
        methods. Today’s provisional spot estimates are excluded. Missing
        conversions make dependent totals unavailable.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <p role="status">Loading historical spending…</p>}
      {data && (
        <>
          <div
            className="planning-readings"
            aria-label="Historical spending totals"
          >
            <div>
              <span>Recorded expenses · {data.totals.count} entries</span>
              <strong>
                <Money
                  value={unit === "USD" ? data.totals.usd : data.totals.bitcoin}
                  unit={unit}
                />
              </strong>
            </div>
            <div>
              <span>Missing USD / bitcoin conversions</span>
              <strong>
                {data.totals.missing_usd} / {data.totals.missing_bitcoin}
              </strong>
            </div>
          </div>
          <ProjectionChart
            title="Historical spending"
            unit={unit}
            points={data.periods.map((p) => ({
              label: p.period,
              values: { spending: unit === "USD" ? p.usd : p.bitcoin },
            }))}
            series={[
              {
                key: "spending",
                label: "Dated spending",
                color: "var(--accent)",
              },
            ]}
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>USD spending</th>
                  <th>Historical bitcoin equivalent</th>
                </tr>
              </thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.period}>
                    <td>{p.period}</td>
                    <td>
                      <Money value={p.usd} unit="USD" />
                    </td>
                    <td>
                      <Money value={p.bitcoin} unit="BITCOIN" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Spending by category</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>USD spending</th>
                    <th>Historical bitcoin equivalent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>
                        <Money value={p.usd} unit="USD" />
                      </td>
                      <td>
                        <Money value={p.bitcoin} unit="BITCOIN" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Choose a category above to examine its trend over time.
            </p>
          </details>
          <label>
            <input
              type="checkbox"
              checked={opportunity}
              onChange={(e) => setOpportunity(e.target.checked)}
            />{" "}
            Show hypothetical value at the latest stored price
          </label>
          {opportunity && (
            <p className="hint">
              Historical bitcoin equivalent valued at{" "}
              {data.current_reference
                ? `${data.current_reference.source} · ${data.current_reference.day}${data.current_reference.older ? " · older reference" : ""}`
                : "an unavailable current reference"}
              : <Money value={data.totals.hypothetical_value_usd} unit="USD" />.
              This comparison does not mean you purchased or held bitcoin, and
              is not an investment return.
            </p>
          )}
          <details>
            <summary>Transaction references</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Expense</th>
                    <th>Original amount</th>
                    <th>Dated bitcoin equivalent</th>
                    <th>USD per legacy BTC</th>
                    <th>Source / method</th>
                    {opportunity && <th>Hypothetical latest value · USD</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((row) => (
                    <tr key={row.id}>
                      <td>{row.date}</td>
                      <td>
                        {row.description}
                        <small>
                          {row.category} · {row.account}
                        </small>
                      </td>
                      <td>
                        <Money value={row.amount} unit={row.currency} />
                      </td>
                      <td>
                        <Money value={row.bitcoin} unit="BITCOIN" />
                      </td>
                      <td>
                        <Money value={row.rate} unit="USD" />
                      </td>
                      <td>
                        {row.source ?? "Unavailable"} · {row.method}
                      </td>
                      {opportunity && (
                        <td>
                          <Money
                            value={row.hypothetical_value_usd}
                            unit="USD"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.transactions_truncated && (
              <p className="hint">
                Showing the first 500 matching entries; totals include all
                matches. Narrow the date range for details.
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
