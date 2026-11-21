/** Which accounts each dropdown on the entry form offers. The lists follow what the entry can really be. */
export interface Choice {
  id: number;
  name: string;
  kind: string;
  role: string;
  currency: "USD" | "BITCOIN";
}
export type EntryKind = "expense" | "income" | "stack" | "sell" | "transfer";
/** The transfer field picked by hand last; the other list narrows to fit it. Null until one is picked: both lists are whole. */
export type Anchor = "from" | "to" | null;

const ORDER = ["checking", "credit_card", "cash", "savings", "bitcoin_wallet", "brokerage", "stock", "etf"];
const MONEY = ["checking", "savings", "cash", "bitcoin_wallet"];
const INVESTED = ["brokerage", "stock", "etf"];
const sorted = <T extends Choice>(accounts: T[]) =>
  [...accounts].sort((a, b) => {
    const rank = (account: Choice) => (account.role === "liability" && account.kind !== "credit_card" ? 99 : ORDER.includes(account.kind) ? ORDER.indexOf(account.kind) : 98);
    return rank(a) - rank(b) || a.id - b.id;
  });

/** Money that can be spent or moved: checking, savings, cash and bitcoin wallets. */
const isMoney = (account: Choice) => account.role === "asset" && MONEY.includes(account.kind);
const isInvested = (account: Choice) => account.role === "asset" && INVESTED.includes(account.kind);
const isDebt = (account: Choice) => account.role === "liability";
const isBitcoin = (account: Choice) => account.currency === "BITCOIN";

/** A transfer can leave money accounts and brokerage cash. Debts and property are never a source. */
const canSend = (account: Choice) => isMoney(account) || isInvested(account);
/** It can land in the same, or pay down a card or loan. Property is valued, not paid into. */
const canReceive = (account: Choice) => isMoney(account) || isInvested(account) || isDebt(account);

/**
 * A transfer stays in one currency: dollars to dollar accounts, bitcoin to bitcoin accounts.
 * Dollars turning into bitcoin is a Bitcoin buy, and bitcoin turning into dollars is a Bitcoin sale.
 */
export function canTransfer(from: Choice, to: Choice) {
  return from.id !== to.id && canSend(from) && canReceive(to) && isBitcoin(from) === isBitcoin(to);
}

export function accountChoices<T extends Choice>(
  kind: EntryKind,
  accounts: T[],
  picked: { from: string; to: string },
  anchor: Anchor = null,
  /** Accounts an entry being corrected already uses stay available, whatever the rules say. */
  keep: number[] = [],
): { from: T[]; to: T[]; source: T | undefined; target: T | undefined } {
  const kept = (list: T[], id: number | undefined) => (id != null && !list.some((account) => account.id === id) ? [...list, ...accounts.filter((account) => account.id === id)] : list);
  const choose = (list: T[], id: string) => list.find((account) => String(account.id) === id) ?? list[0];

  if (kind === "expense") {
    const from = kept(sorted(accounts.filter((account) => isMoney(account) || account.kind === "credit_card")), keep[0]);
    return { from, to: [], source: choose(from, picked.from), target: undefined };
  }
  if (kind === "income") {
    const from = kept(sorted(accounts.filter((account) => isMoney(account) || isInvested(account))), keep[0]);
    return { from, to: [], source: choose(from, picked.from), target: undefined };
  }
  if (kind === "stack") {
    const from = kept(sorted(accounts.filter((account) => isMoney(account) && !isBitcoin(account))), keep[0]);
    const to = kept(sorted(accounts.filter((account) => account.kind === "bitcoin_wallet" && isBitcoin(account))), keep[1]);
    return { from, to, source: choose(from, picked.from), target: choose(to, picked.to) };
  }
  if (kind === "sell") {
    const from = kept(sorted(accounts.filter((account) => isMoney(account) && isBitcoin(account))), keep[0]);
    const to = kept(sorted(accounts.filter((account) => isMoney(account) && !isBitcoin(account))), keep[1]);
    return { from, to, source: choose(from, picked.from), target: choose(to, picked.to) };
  }
  if (anchor === "to") {
    const to = kept(sorted(accounts.filter((account) => canReceive(account) && accounts.some((other) => canTransfer(other, account)))), keep[1]);
    const target = choose(to, picked.to);
    const from = kept(sorted(accounts.filter((account) => target && canTransfer(account, target))), keep[0]);
    return { from, to, source: choose(from, picked.from), target };
  }
  const from = kept(sorted(accounts.filter((account) => canSend(account) && accounts.some((other) => canTransfer(account, other)))), keep[0]);
  const source = choose(from, picked.from);
  const fits = kept(sorted(accounts.filter((account) => source && canTransfer(source, account))), keep[1]);
  if (anchor === "from") return { from, to: fits, source, target: choose(fits, picked.to) };
  // Nothing picked by hand yet: every destination is on offer, and the one shown always fits the source.
  const to = kept(sorted(accounts.filter((account) => canReceive(account) && accounts.some((other) => canTransfer(other, account)))), keep[1]);
  return { from, to, source, target: choose(fits, picked.to) };
}
