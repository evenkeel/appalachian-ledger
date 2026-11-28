import type { ReactNode } from "react";
import type { Transaction } from "../../lib/types";
import { btc, shortDate, usd } from "../lib/format";
import { Private } from "../lib/privacy";

/** What an entry cost in bitcoin on its own date. Missing is shown as missing, never guessed. */
export function bitcoinThatDay(row: Transaction): ReactNode {
  if (row.kind === "transfer" && row.destination_currency === "BITCOIN" && row.destination_amount)
    return <span className="btc">+<Private>{btc(row.destination_amount)}</Private></span>;
  if (row.currency === "BITCOIN") return <Private>{btc(row.amount)}</Private>;
  if (row.purchase_cost) return <Private>{btc(row.purchase_cost.bitcoin)}</Private>;
  if (row.kind === "expense") return <span className="tag miss">no price saved</span>;
  return <span className="dim">{row.bitcoin !== null ? <Private>{btc(row.bitcoin)}</Private> : "—"}</span>;
}

export const amountText = (row: Transaction) =>
  `${row.kind === "income" ? "+" : row.kind === "expense" ? "−" : ""}${row.currency === "USD" ? usd(row.amount) : btc(row.amount)}`;

export function EntryTable({
  rows,
  account = true,
  selected,
  onSelect,
  actions,
}: {
  rows: Transaction[];
  account?: boolean;
  selected?: number | null;
  onSelect?: (row: Transaction) => void;
  actions?: (row: Transaction) => ReactNode;
}) {
  return (
    <div style={{ overflow: "hidden" }}>
      <table className="log">
        <thead>
          <tr>
            <th>Date</th>
            <th>Entry</th>
            <th className="hide-s">Category</th>
            {account && <th className="hide-s">Account</th>}
            <th className="r">Amount</th>
            <th className="r">Bitcoin that day</th>
            {actions && <th className="r hide-s">Change</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={selected === row.id ? "sel" : undefined} onClick={onSelect && (() => onSelect(row))}>
              <td className="num dim">{shortDate(row.date)}</td>
              <td className="w">{row.description}</td>
              <td className="hide-s">
                <span className="tag">{row.kind === "transfer" ? (row.destination_currency === "BITCOIN" && row.currency === "USD" ? "Stack" : row.currency === "BITCOIN" && row.destination_currency === "USD" ? "Sale" : "Move") : row.category}</span>
              </td>
              {account && (
                <td className="dim hide-s">
                  {row.account}
                  {row.destination_account ? ` → ${row.destination_account}` : ""}
                </td>
              )}
              <td className="num r">
                <Private when={row.currency !== "USD"}>{amountText(row)}</Private>
              </td>
              <td className="num r">{bitcoinThatDay(row)}</td>
              {actions && <td className="r hide-s">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
