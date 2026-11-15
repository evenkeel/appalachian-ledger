import type { Account, Category, Transaction } from "../lib/types";
export const expenseCategories: Category[] = [
  "Groceries",
  "Dining",
  "Utilities",
  "Transport",
  "Insurance",
  "Repairs",
  "Health",
  "Gifts",
  "Travel",
].map((name, i) => ({ id: i + 1, name, kind: "expense" }));
export const expenseAccounts = [
  { id: 1, name: "Checking", currency: "USD", archived: false },
  { id: 2, name: "Spending wallet", currency: "BITCOIN", archived: true },
] as Account[];
export function expense(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    date: "2026-11-05",
    kind: "expense",
    description: "Weekly groceries",
    notes: "",
    account_id: 1,
    account: "Checking",
    currency: "USD",
    amount: "80.00",
    destination_id: null,
    destination_amount: null,
    destination_currency: null,
    destination_account: null,
    category_id: 1,
    category: "Groceries",
    bitcoin: "999999",
    usd: "80.00",
    rate_snapshot: null,
    conversion_basis: "current_estimate",
    valuation_basis: "historical purchasing power",
    purchase_cost: {
      usd: "80.00",
      bitcoin: "80000",
      usd_per_btc: "100000",
      source: "Fictional dated reference",
      method: "manual",
      observed_at: "2026-11-05",
    },
    ...overrides,
  };
}
export const analysisExpenses = [
  expense({ id: 1, amount: "120.00", description: "Market groceries" }),
  expense({
    id: 2,
    date: "2026-10-05",
    amount: "80.00",
    description: "Previous groceries",
  }),
  expense({
    id: 3,
    date: "2026-11-03",
    amount: "20.00",
    category_id: 2,
    category: "Dining",
    description: "Lunch",
  }),
  expense({
    id: 4,
    date: "2026-10-03",
    amount: "65.00",
    category_id: 2,
    category: "Dining",
    description: "Previous lunch",
  }),
  expense({
    id: 5,
    date: "2026-10-20",
    amount: "90.00",
    description: "Later previous groceries",
  }),
  expense({
    id: 6,
    date: "2026-11-20",
    amount: "150.00",
    description: "Future expense",
  }),
  expense({
    id: 7,
    kind: "transfer",
    amount: "500.00",
    description: "Move to savings",
  }),
  expense({ id: 8, kind: "income", amount: "4000.00", description: "Salary" }),
];
