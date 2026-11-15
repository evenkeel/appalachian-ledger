import { decimalAmount } from "./spendingAnalysis";

export interface AccountActivityRow {
  id: number;
  date: string;
  kind: string;
  description: string;
  notes: string;
  counterparty: string | null;
  category: string | null;
  change: string;
  change_minor: string;
  balance: string;
  reverses_id: number | null;
  reversed: boolean;
  direction?: "in" | "out" | null;
  counterparty_role?: "asset" | "liability" | null;
  counterparty_kind?: string | null;
}
export interface AccountActivityData {
  account_id: number;
  currency: "USD" | "BITCOIN";
  role: "asset" | "liability";
  as_of: string;
  balance: string;
  rows: AccountActivityRow[];
}

/** Remove cancelled pairs for the statement; recalculate rather than reusing audit balances. */
export function accountStatement(data: AccountActivityData) {
  let balance = 0n;
  const rows = [...data.rows]
    .reverse()
    .filter((row) => !row.reversed && row.kind !== "reversal")
    .map((row) => {
      balance += BigInt(row.change_minor);
      return { ...row, balance: decimalAmount(balance, data.currency)! };
    })
    .reverse();
  return {
    rows,
    corrections: data.rows.filter(
      (row) => row.reversed || row.kind === "reversal",
    ),
  };
}

export function activityTitle(
  row: AccountActivityRow,
  role: AccountActivityData["role"],
) {
  if (row.kind === "transfer" && row.counterparty && row.direction) {
    const payment =
      row.direction === "out"
        ? row.counterparty_role === "liability"
        : role === "liability";
    return `${payment ? "Payment" : "Transfer"} ${row.direction === "in" ? "from" : "to"} ${row.counterparty}`;
  }
  if (row.kind === "adjustment") return "Balance adjustment";
  if (row.kind === "valuation") return "Value update";
  if (row.kind === "opening") return "Opening balance";
  return row.description;
}

export function activityDetail(row: AccountActivityRow) {
  if (row.kind === "transfer") {
    // Preserve user-authored descriptions without repeating generated account arrows.
    return /^(Payment:|Transfer:)/i.test(row.description)
      ? ""
      : row.description;
  }
  if (row.kind === "adjustment" || row.kind === "valuation") {
    return /^(adjustment|manual asset valuation)$/i.test(row.description)
      ? ""
      : row.description;
  }
  return [
    row.kind === "income" ? "Income" : row.kind === "expense" ? "Expense" : "",
    row.category,
  ]
    .filter(Boolean)
    .join(" · ");
}
