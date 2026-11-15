import {
  formatBitcoinPerDollar,
  formatBitcoinPerDollarFromRate,
} from "./money";
import type { Transaction } from "./types";

export function transactionRate(row: Transaction) {
  if (row.kind === "transfer") {
    if (row.currency === row.destination_currency || !row.destination_amount)
      return null;
    const value =
      row.currency === "USD"
        ? formatBitcoinPerDollar(row.destination_amount, row.amount)
        : row.destination_currency === "USD"
          ? formatBitcoinPerDollar(row.amount, row.destination_amount)
          : "Unavailable";
    return value === "Unavailable"
      ? null
      : { value, basis: "actual exchange", source: "Recorded amounts" };
  }
  if (row.purchase_cost) {
    const value = formatBitcoinPerDollarFromRate(row.purchase_cost.usd_per_btc);
    return value === "Unavailable"
      ? null
      : {
          value,
          basis: "saved purchase-date reference",
          source: `${row.purchase_cost.source} · ${row.purchase_cost.method} · ${row.purchase_cost.observed_at}`,
        };
  }
  if (row.kind === "expense") return null;
  const value = formatBitcoinPerDollarFromRate(
    row.conversion_rate || row.rate_snapshot,
  );
  return value === "Unavailable"
    ? null
    : {
        value: `${row.conversion_basis === "current_estimate" ? "≈ " : ""}${value}`,
        basis:
          row.conversion_basis === "current_estimate"
            ? "current quote estimate"
            : row.conversion_basis === "dated_reference"
              ? "transaction-date reference"
              : "saved reference",
        source: [row.conversion_source, row.conversion_at]
          .filter(Boolean)
          .join(" · "),
      };
}
