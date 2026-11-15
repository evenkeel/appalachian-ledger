import type { Account } from "./types";
export const isPaymentAccount = (account: Account) =>
  !account.archived &&
  ["credit_card", "checking", "savings", "cash", "bitcoin_wallet"].includes(
    account.kind,
  );
export const isCashAccount = (account: Account) =>
  account.role === "asset" &&
  ["bitcoin_wallet", "checking", "savings", "cash"].includes(account.kind);
export const isBrokerageAccount = (account: Account) =>
  account.role === "asset" &&
  ["brokerage", "stock", "etf"].includes(account.kind);
export function cashBalance(account: Account) {
  return isCashAccount(account)
    ? account.balance
    : isBrokerageAccount(account)
      ? (account.portfolio?.cash ?? null)
      : null;
}
export const canMoveMoney = (account: Account) =>
  !account.archived && cashBalance(account) !== null;

/** Eligibility follows the account's purpose, never its name or valuation. */
export function isTransactionSource(account: Account, mode: string) {
  if (account.archived) return false;
  if (mode === "bitcoin")
    return (
      account.kind === "checking" &&
      account.role === "asset" &&
      account.currency === "USD"
    );
  if (mode === "expense") return isPaymentAccount(account);
  return canMoveMoney(account);
}

export function isTransactionDestination(account: Account, mode: string) {
  if (account.archived || account.role !== "asset") return false;
  if (mode === "bitcoin")
    return account.kind === "bitcoin_wallet" && account.currency === "BITCOIN";
  if (mode === "savings") return account.kind === "savings";
  if (mode === "investing") return isBrokerageAccount(account);
  return canMoveMoney(account);
}
export function accountAction(account: Account) {
  if (account.role === "liability") return "payment";
  if (isCashAccount(account)) return "transfer";
  if (isBrokerageAccount(account)) return "cash";
  return "valuation";
}

/** Primary management location; the underlying ledger account is shared. */
export function belongsInAssets(account: Pick<Account, "role" | "kind">) {
  return account.role === "liability"
    ? account.kind !== "credit_card"
    : ![
        "bitcoin_wallet",
        "checking",
        "savings",
        "cash",
        "brokerage",
        "stock",
        "etf",
      ].includes(account.kind);
}
