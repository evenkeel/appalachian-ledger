import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  Pencil,
  Repeat2,
  Trash2,
} from "lucide-react";
import type { Transaction } from "../lib/types";
import { Money } from "./Money";
import { TransactionSummary } from "./TransactionSummary";
import { transactionRate } from "../lib/transactionRate";
import { Button } from "./ui/button";
export function TransactionTable({
  rows,
  onEdit,
  onDelete,
  onRepeat,
  onReview,
  compact = false,
  showConversions = true,
}: {
  rows: Transaction[];
  onEdit?: (row: Transaction) => void;
  onDelete?: (row: Transaction) => void;
  onRepeat?: (row: Transaction) => void;
  /** Shown only for rows waiting in the review queue. */
  onReview?: (row: Transaction) => void;
  compact?: boolean;
  showConversions?: boolean;
}) {
  const [selected, setSelected] = useState<Transaction | null>(null);
  if (!rows.length)
    return (
      <div className="empty-inline">
        No transactions in this period. Record your first entry to start
        building your history.
      </div>
    );
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Date</th>
              {!compact && <th>Category</th>}
              <th className="numeric">Original amount</th>
              {!compact && showConversions && (
                <th className="numeric">Conversion / ₿ per dollar</th>
              )}
              {onEdit && (
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rate = transactionRate(row);
              return (
                <tr
                  key={row.id}
                  className="transaction-row"
                  onClick={(event) => {
                    event.currentTarget
                      .querySelector<HTMLButtonElement>(".transaction-open")
                      ?.focus();
                    setSelected(row);
                  }}
                >
                  <td>
                    <div className="transaction-cell">
                      <span className={`transaction-icon ${row.kind}`}>
                        {row.kind === "income" ? (
                          <ArrowDownLeft size={16} />
                        ) : row.kind === "transfer" ? (
                          <ArrowLeftRight size={16} />
                        ) : (
                          <ArrowUpRight size={16} />
                        )}
                      </span>
                      <div>
                        <button
                          type="button"
                          className="cell-title transaction-open"
                          aria-label={`View ${row.description} transaction`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(row);
                          }}
                        >
                          {row.description}
                        </button>
                        <small>
                          {row.account}
                          {row.destination_account
                            ? ` → ${row.destination_account}`
                            : ""}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td className="muted nowrap">
                    {new Date(row.date + "T12:00:00").toLocaleDateString(
                      undefined,
                      {
                        month: "short",
                        day: "numeric",
                        year: compact ? undefined : "numeric",
                      },
                    )}
                  </td>
                  {!compact && (
                    <td>
                      <span className="tag">{row.category}</span>
                      {row.review_reasons?.map((reason) => (
                        <span className="tag review-tag" key={reason}>
                          {reason === "imported"
                            ? "Imported"
                            : "Catch-all category"}
                        </span>
                      ))}
                    </td>
                  )}
                  <td
                    className={`numeric nowrap ${row.kind === "income" ? "positive" : ""}`}
                  >
                    <span>
                      {row.kind === "expense"
                        ? "−"
                        : row.kind === "income"
                          ? "+"
                          : ""}
                    </span>
                    <Money value={row.amount} unit={row.currency} />
                    {row.kind === "transfer" && row.destination_currency && (
                      <small className="valuation-label">
                        Received:{" "}
                        <Money
                          value={row.destination_amount}
                          unit={row.destination_currency}
                        />
                      </small>
                    )}
                  </td>
                  {!compact && showConversions && (
                    <td
                      className="numeric nowrap"
                      title={
                        rate
                          ? `${rate.value} · ${rate.basis}${rate.source ? ` · ${rate.source}` : ""}`
                          : row.kind === "transfer"
                            ? undefined
                            : "Missing transaction-date rate"
                      }
                    >
                      {row.purchase_cost ? (
                        <>
                          <Money
                            value={
                              row.currency === "USD"
                                ? row.purchase_cost.bitcoin
                                : row.purchase_cost.usd
                            }
                            unit={row.currency === "USD" ? "BITCOIN" : "USD"}
                          />
                          <small className="valuation-label">
                            saved purchase-date equivalent
                          </small>
                        </>
                      ) : row.kind === "expense" ? (
                        <span className="muted">
                          Purchase-date reference pending
                        </span>
                      ) : row.kind === "transfer" ? (
                        rate ? (
                          <>
                            <span>{rate.value}</span>
                            <small className="valuation-label">
                              {rate.basis}
                            </small>
                          </>
                        ) : (
                          <span className="muted">
                            {row.currency === row.destination_currency
                              ? "Same-currency transfer"
                              : "See actual received amount"}
                          </span>
                        )
                      ) : (
                        <>
                          {row.conversion_basis === "current_estimate" && "≈ "}
                          <Money
                            value={
                              row.currency === "USD" ? row.bitcoin : row.usd
                            }
                            unit={row.currency === "USD" ? "BITCOIN" : "USD"}
                          />
                          <small className="valuation-label">
                            {row.conversion_basis === "current_estimate"
                              ? "current quote estimate"
                              : row.conversion_basis === "dated_reference"
                                ? "transaction-date reference"
                                : "historical equivalent"}
                          </small>
                        </>
                      )}
                      {row.kind !== "transfer" && rate && (
                        <small className="valuation-label">{rate.value}</small>
                      )}
                    </td>
                  )}
                  {onEdit && (
                    <td>
                      <div
                        className="row-actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {onReview && !!row.review_reasons?.length && (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Mark ${row.description} as reviewed`}
                            onClick={() => onReview(row)}
                          >
                            <Check size={14} /> Looks right
                          </Button>
                        )}
                        {row.kind === "expense" && onRepeat && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Repeat ${row.description}`}
                            title="Repeat expense"
                            onClick={() => onRepeat(row)}
                          >
                            <Repeat2 size={14} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${row.description}`}
                          onClick={() => onEdit(row)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reverse ${row.description}`}
                          onClick={() => onDelete?.(row)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected && (
        <TransactionSummary row={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
