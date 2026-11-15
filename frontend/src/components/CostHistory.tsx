import { useModalDialog } from "../lib/useModalDialog";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import type { Category, CostHistoryData } from "../lib/types";
import { Money } from "./Money";
import { Button } from "./ui/button";

export function CostHistory({
  revision,
  billId,
  categories = [],
}: {
  revision: number;
  billId?: number;
  categories?: Category[];
}) {
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CostHistoryData | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    const query = new URLSearchParams();
    if (billId !== undefined) query.set("bill_id", String(billId));
    if (category) query.set("category_id", category);
    if (search) query.set("search", search);
    api<CostHistoryData>(`/expense-costs?${query}`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [revision, billId, category, search, retry]);
  return (
    <section className="cost-history">
      {billId === undefined && (
        <div className="filter-bar">
          <input
            aria-label="Search cost history"
            placeholder="Search a bill or expense…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Cost history category"
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
        </div>
      )}
      <p className="hint cost-history-note">
        Actual payments in dollars and bitcoin. Bitcoin equivalents use saved
        purchase-date references, not today's price. Missing references stay
        unavailable.
      </p>
      {error ? (
        <div className="alert error" role="alert">
          {error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry
          </Button>
        </div>
      ) : !data ? (
        <p className="empty-inline" role="status">
          Loading cost history…
        </p>
      ) : !data.payments.length ? (
        <p className="empty-inline">
          No recorded payments yet. History appears when you record an expense.
        </p>
      ) : (
        <>
          <div className="table-scroll cost-history-table">
            <table aria-label="Monthly cost history">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Payments</th>
                  <th className="numeric">Dollars</th>
                  <th className="numeric">Change</th>
                  <th className="numeric">Bitcoin</th>
                  <th className="numeric">Change</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((row) => (
                  <tr key={row.month}>
                    <th scope="row">{row.month}</th>
                    <td>{row.payments}</td>
                    <td className="numeric">
                      <Money value={row.usd} unit="USD" />
                      {row.missing_usd > 0 && (
                        <small className="valuation-label">
                          {row.missing_usd} missing reference
                        </small>
                      )}
                    </td>
                    <td className="numeric">
                      {row.change_usd === null ? "—" : `${row.change_usd}%`}
                    </td>
                    <td className="numeric">
                      <Money value={row.bitcoin} />
                      {row.missing_bitcoin > 0 && (
                        <small className="valuation-label">
                          {row.missing_bitcoin} missing reference
                        </small>
                      )}
                    </td>
                    <td className="numeric">
                      {row.change_bitcoin === null
                        ? "—"
                        : `${row.change_bitcoin}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint cost-history-note">
            Change compares the previous recorded month. Monthly totals include
            changes in usage and purchases. The current month may be incomplete.
          </p>
          <details open={billId !== undefined}>
            <summary>Recorded payments ({data.payments.length})</summary>
            <div className="table-scroll cost-history-table">
              <table aria-label="Recorded payment costs">
                <thead>
                  <tr>
                    <th>Purchase date</th>
                    <th>Expense</th>
                    <th className="numeric">Dollars</th>
                    <th className="numeric">Bitcoin</th>
                    <th>Price reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((row) => (
                    <tr key={row.id}>
                      <td>{row.date}</td>
                      <td>
                        {row.description}
                        <small className="valuation-label">{row.account}</small>
                      </td>
                      <td className="numeric">
                        <Money value={row.usd} unit="USD" />
                      </td>
                      <td className="numeric">
                        <Money value={row.bitcoin} />
                      </td>
                      <td>
                        {row.rate ? (
                          <details>
                            <summary>
                              {row.method === "daily_close"
                                ? "Daily close"
                                : row.method === "midnight"
                                  ? "Daily reference"
                                  : row.method === "manual"
                                    ? "Manual daily reference"
                                    : "Saved reference"}
                            </summary>
                            <small>
                              {row.source} · ${row.rate} / BTC
                              <br />
                              Quote: {row.quote_at}
                              <br />
                              Recorded: {row.recorded_at}
                            </small>
                          </details>
                        ) : (
                          <span className="hint">
                            Purchase-date reference pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export function CostHistoryDialog({
  billId,
  title,
  revision,
  onClose,
}: {
  billId: number;
  title: string;
  revision: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  return (
    <dialog
      ref={ref}
      className="entry-dialog account-bills-dialog"
      aria-labelledby="cost-history-title"
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="cost-history-title">{title} · cost history</h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Close cost history"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <CostHistory revision={revision} billId={billId} />
    </dialog>
  );
}
