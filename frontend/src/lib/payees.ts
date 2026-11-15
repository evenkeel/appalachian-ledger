import type { PayeeRule, Transaction } from "./types";

export interface PayeeSuggestion {
  description: string;
  category_id: number | null;
  account_id: number;
  amount: string;
  currency: Transaction["currency"];
  count: number;
  lastDate: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

/** What each payee usually looks like, learned from the ledger's own history. */
export function payeeMemory(
  transactions: Transaction[],
  kind: string,
): PayeeSuggestion[] {
  const byName = new Map<string, PayeeSuggestion>();
  for (const row of transactions) {
    if (row.kind !== kind || !row.description.trim()) continue;
    const key = normalize(row.description);
    const known = byName.get(key);
    if (!known) {
      byName.set(key, {
        description: row.description.trim(),
        category_id: row.category_id,
        account_id: row.account_id,
        amount: row.amount,
        currency: row.currency,
        count: 1,
        lastDate: row.date,
      });
    } else {
      known.count += 1;
      // The most recent entry decides the category, account and amount.
      if (row.date > known.lastDate) {
        Object.assign(known, {
          description: row.description.trim(),
          category_id: row.category_id,
          account_id: row.account_id,
          amount: row.amount,
          currency: row.currency,
          lastDate: row.date,
        });
      }
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate),
  );
}

/** Frequent payees for an empty field; otherwise those containing what was typed. */
export function suggestPayees(
  memory: PayeeSuggestion[],
  query: string,
  limit = 5,
) {
  const text = normalize(query);
  if (!text) return memory.slice(0, limit);
  return memory
    .filter(
      (payee) =>
        normalize(payee.description).includes(text) &&
        normalize(payee.description) !== text,
    )
    .sort(
      (a, b) =>
        Number(normalize(b.description).startsWith(text)) -
        Number(normalize(a.description).startsWith(text)),
    )
    .slice(0, limit);
}

/** The most specific rule whose text appears in the description. */
export function matchRule(
  rules: PayeeRule[],
  description: string,
  categoryIds: Set<number>,
) {
  const text = normalize(description);
  if (!text) return undefined;
  return rules
    .filter(
      (rule) =>
        categoryIds.has(rule.category_id) &&
        text.includes(normalize(rule.match)),
    )
    .sort((a, b) => b.match.length - a.match.length)[0];
}

/** Replace any rule with the same text, keeping one rule per payee and kind. */
export function upsertRule(
  rules: PayeeRule[],
  rule: PayeeRule,
  sameKind: Set<number>,
) {
  return [
    ...rules.filter(
      (existing) =>
        !(
          normalize(existing.match) === normalize(rule.match) &&
          sameKind.has(existing.category_id)
        ),
    ),
    rule,
  ];
}
