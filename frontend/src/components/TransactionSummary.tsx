import { useModalDialog } from "../lib/useModalDialog";
import { useRef } from "react";
import { X } from "lucide-react";
import type { Transaction } from "../lib/types";
import { formatMoney } from "../lib/money";
import { transactionRate } from "../lib/transactionRate";
import { Button } from "./ui/button";

export function TransactionSummary({
  row,
  onClose,
}: {
  row: Transaction;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const rate = transactionRate(row);
  const bitcoinBuy =
    row.kind === "transfer" &&
    row.currency === "USD" &&
    row.destination_currency === "BITCOIN";
  const facts: [string, string][] = bitcoinBuy
    ? [
        ["Dollars", formatMoney(row.amount, "USD")],
        ["Bitcoin", formatMoney(row.destination_amount, "BITCOIN")],
        ["Bitcoin per dollar", rate?.value || "Unavailable"],
        ["From", row.account],
        ["To", row.destination_account || "Unavailable"],
        ["Date", row.date],
      ]
    : [
        [
          "Type",
          row.kind === "expense"
            ? "Expense"
            : row.kind === "income"
              ? "Income"
              : "Transfer",
        ],
        ["Date", row.date],
        ["Original amount", formatMoney(row.amount, row.currency)],
        [row.kind === "transfer" ? "From" : "Account", row.account],
        ...(row.kind === "transfer"
          ? [
              ["To", row.destination_account || "Unavailable"] as [
                string,
                string,
              ],
              [
                "Received",
                row.destination_currency
                  ? formatMoney(
                      row.destination_amount,
                      row.destination_currency,
                    )
                  : "Unavailable",
              ] as [string, string],
            ]
          : [
              ["Category", row.category || "Uncategorized"] as [string, string],
            ]),
        [
          "Bitcoin per dollar",
          rate?.value ||
            (row.kind === "transfer" &&
            row.currency === row.destination_currency
              ? "Same-currency transfer"
              : "Unavailable"),
        ],
      ];
  if (row.kind !== "transfer" && row.purchase_cost) {
    facts.push([
      "Saved purchase-date equivalent",
      formatMoney(
        row.currency === "USD"
          ? row.purchase_cost.bitcoin
          : row.purchase_cost.usd,
        row.currency === "USD" ? "BITCOIN" : "USD",
      ),
    ]);
  }
  function dismiss() {
    ref.current?.close();
    onClose();
  }
  useModalDialog(ref);
  return (
    <dialog
      ref={ref}
      className="entry-dialog transaction-summary-dialog"
      aria-labelledby="transaction-summary-title"
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="hint">Transaction summary</p>
          <h2 id="transaction-summary-title">{row.description}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close transaction summary"
          onClick={dismiss}
        >
          <X size={20} />
        </Button>
      </div>
      <div className="transaction-summary-body">
        <section
          className={`transaction-review${bitcoinBuy ? " bitcoin-buy-review" : ""}`}
          aria-label="Transaction details"
        >
          <dl>
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {rate && (
          <p className="hint" title={rate.source}>
            Rate: {rate.basis}
            {rate.source && ` · ${rate.source}`}
          </p>
        )}
        {row.notes && (
          <div className="transaction-summary-notes">
            <h3>Notes</h3>
            <p>{row.notes}</p>
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <Button type="button" onClick={dismiss}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
