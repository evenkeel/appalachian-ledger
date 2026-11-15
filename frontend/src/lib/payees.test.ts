import { expect, test } from "vitest";
import { matchRule, payeeMemory, suggestPayees, upsertRule } from "./payees";
import type { Transaction } from "./types";

const row = (overrides: Partial<Transaction>): Transaction => ({
  id: 1,
  date: "2026-01-01",
  kind: "expense",
  description: "Coffee",
  notes: "",
  account_id: 1,
  account: "Checking",
  currency: "USD",
  amount: "4.00",
  destination_id: null,
  destination_amount: null,
  destination_currency: null,
  destination_account: null,
  category_id: 5,
  category: "Dining",
  bitcoin: null,
  usd: "4.00",
  rate_snapshot: null,
  valuation_basis: "",
  ...overrides,
});

test("memory groups by payee, ranks by use, and keeps the latest details", () => {
  const memory = payeeMemory(
    [
      row({
        id: 1,
        description: "coffee ",
        amount: "4.00",
        date: "2026-01-01",
      }),
      row({ id: 2, amount: "4.75", date: "2026-02-01", account_id: 9 }),
      row({ id: 3, description: "Rent", amount: "900.00", category_id: 2 }),
      row({ id: 4, description: "Salary", kind: "income" }),
      row({ id: 5, description: "  ", amount: "1.00" }),
    ],
    "expense",
  );
  expect(memory.map((payee) => payee.description)).toEqual(["Coffee", "Rent"]);
  expect(memory[0]).toMatchObject({ count: 2, amount: "4.75", account_id: 9 });
});

test("suggestions are frequent when empty and filtered when typing", () => {
  const memory = payeeMemory(
    [
      row({ id: 1, description: "Mountain market" }),
      row({ id: 2, description: "Farmers market" }),
      row({ id: 3, description: "Farmers market" }),
      row({ id: 4, description: "Fuel" }),
    ],
    "expense",
  );
  expect(suggestPayees(memory, "", 2).map((p) => p.description)).toEqual([
    "Farmers market",
    "Mountain market",
  ]);
  expect(suggestPayees(memory, "mar").map((p) => p.description)).toEqual([
    "Farmers market",
    "Mountain market",
  ]);
  expect(suggestPayees(memory, "mo").map((p) => p.description)).toEqual([
    "Mountain market",
  ]);
  // Nothing to suggest once the text already is the payee.
  expect(suggestPayees(memory, "fuel")).toEqual([]);
});

test("the most specific rule for this kind of category wins", () => {
  const rules = [
    { match: "amazon", category_id: 1, account_id: null },
    { match: "Amazon Prime", category_id: 2, account_id: 4 },
    { match: "amazon", category_id: 30, account_id: null },
  ];
  const expense = new Set([1, 2]);
  expect(matchRule(rules, "AMAZON PRIME*123", expense)?.category_id).toBe(2);
  expect(matchRule(rules, "Amazon marketplace", expense)?.category_id).toBe(1);
  expect(matchRule(rules, "Amazon refund", new Set([30]))?.category_id).toBe(
    30,
  );
  expect(matchRule(rules, "Bakery", expense)).toBeUndefined();
  expect(
    upsertRule(
      rules,
      { match: "AMAZON", category_id: 2, account_id: null },
      expense,
    ),
  ).toEqual([
    rules[1],
    rules[2],
    { match: "AMAZON", category_id: 2, account_id: null },
  ]);
});
