import type { Account } from "../lib/types";
import { decimalAmount } from "../lib/spendingAnalysis";
import { Money } from "./Money";

export function LiquidUSD({ accounts = [] }: { accounts?: Account[] }) {
  const checking = accounts.filter(
    (account) =>
      account.kind === "checking" &&
      account.role === "asset" &&
      account.currency === "USD" &&
      !account.archived &&
      !account.exclude_from_liquid_usd,
  );
  const excluded = accounts.filter(
    (account) =>
      account.kind === "checking" &&
      account.role === "asset" &&
      account.currency === "USD" &&
      !account.archived &&
      account.exclude_from_liquid_usd,
  ).length;
  const cents = checking.reduce(
    (total, account) => total + BigInt(account.balance_minor),
    0n,
  );
  return (
    <div role="group" aria-label="Everyday Cash">
      <span>Everyday Cash</span>
      <Money
        value={decimalAmount(cents, "USD")}
        unit="USD"
        className={cents < 0n ? "negative" : ""}
      />
      <small>
        {checking.length} active checking{" "}
        {checking.length === 1 ? "account" : "accounts"}
      </small>
      {excluded > 0 && <small>{excluded} excluded · set-aside money</small>}
    </div>
  );
}
