import { expect, test } from "vitest";
import {
  accountStatement,
  activityTitle,
  type AccountActivityData,
  type AccountActivityRow,
} from "./accountActivity";
const row = (
  id: number,
  change: string,
  overrides: Partial<AccountActivityRow> = {},
): AccountActivityRow => ({
  id,
  date: "2026-11-11",
  kind: "income",
  description: `Entry ${id}`,
  notes: "",
  counterparty: null,
  category: null,
  change,
  change_minor: String(BigInt(change) * 100n),
  balance: "0.00",
  reverses_id: null,
  reversed: false,
  ...overrides,
});

test("cancelled pairs are disclosed separately and interleaved balances are recalculated", () => {
  const data: AccountActivityData = {
    account_id: 1,
    currency: "USD",
    role: "asset",
    as_of: "2026-11-11",
    balance: "90.00",
    rows: [
      row(4, "-1000", { kind: "reversal", reverses_id: 2, balance: "90.00" }),
      row(3, "-10", { kind: "expense", balance: "1090.00" }),
      row(2, "1000", { reversed: true, balance: "1100.00" }),
      row(1, "100", { kind: "opening", balance: "100.00" }),
    ],
  };
  const statement = accountStatement(data);
  expect(statement.rows.map((r) => [r.id, r.balance])).toEqual([
    [3, "90.00"],
    [1, "100.00"],
  ]);
  expect(statement.corrections.map((r) => r.id)).toEqual([4, 2]);
  expect(data.rows[1].balance).toBe("1090.00");
});

test("statement preserves exact native bitcoin units beyond IEEE-754 precision", () => {
  const data: AccountActivityData = {
    account_id: 1,
    currency: "BITCOIN",
    role: "asset",
    as_of: "2026-11-11",
    balance: "9007199254740993",
    rows: [{ ...row(1, "0"), change_minor: "9007199254740993" }],
  };
  expect(accountStatement(data).rows[0].balance).toBe("9007199254740993");
});

test("payment descriptions identify direction without account-name duplication", () => {
  const payment = row(1, "-835", {
    kind: "transfer",
    counterparty: "Prime Card",
    direction: "out",
    counterparty_role: "liability",
  });
  expect(activityTitle(payment, "asset")).toBe("Payment to Prime Card");
  expect(
    activityTitle(
      { ...payment, direction: "in", counterparty: "Strike Checking" },
      "liability",
    ),
  ).toBe("Payment from Strike Checking");
  expect(
    activityTitle(
      { ...payment, counterparty: "Savings", counterparty_role: "asset" },
      "asset",
    ),
  ).toBe("Transfer to Savings");
});
