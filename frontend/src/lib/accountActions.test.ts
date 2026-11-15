import { expect, test } from "vitest";
import { accountAction, canMoveMoney, cashBalance } from "./accountActions";
import type { Account } from "./types";
const account: Account = {
  id: 1,
  name: "Account",
  kind: "checking",
  role: "asset",
  currency: "USD",
  balance: "10000",
  balance_minor: "1000000",
  bitcoin: null,
  usd: "10000",
  value: "10000",
  holding_type: "dollars",
  archived: false,
  rate_day: null,
  rate_source: null,
};
test("account actions follow the account's role and kind", () => {
  for (const kind of ["checking", "savings", "cash", "bitcoin_wallet"])
    expect(accountAction({ ...account, kind })).toBe("transfer");
  for (const kind of ["credit_card", "loan", "mortgage", "other_liability"])
    expect(accountAction({ ...account, kind, role: "liability" })).toBe(
      "payment",
    );
  for (const kind of ["brokerage", "stock", "etf"])
    expect(accountAction({ ...account, kind })).toBe("cash");
  for (const kind of ["real_estate", "vehicle", "other_asset"]) {
    expect(accountAction({ ...account, kind })).toBe("valuation");
    expect(canMoveMoney({ ...account, kind })).toBe(false);
  }
});
test("brokerage money movement uses cash and never falls back to securities value", () => {
  const broker = { ...account, kind: "brokerage" };
  expect(cashBalance(broker)).toBeNull();
  expect(canMoveMoney(broker)).toBe(false);
  const tracked = {
    ...broker,
    portfolio: {
      cash: "25.00",
      holdings: [],
      source: "test",
      started_on: "2026-01-01",
      error: null,
    },
  };
  expect(cashBalance(tracked)).toBe("25.00");
  expect(canMoveMoney(tracked)).toBe(true);
  expect(canMoveMoney({ ...tracked, archived: true })).toBe(false);
});

test("property and longer-term debts have a different primary home from money accounts", async () => {
  const { belongsInAssets } = await import("./accountActions");
  const all = [
    "bitcoin_wallet",
    "checking",
    "savings",
    "cash",
    "brokerage",
    "stock",
    "etf",
    "credit_card",
    "loan",
    "mortgage",
    "real_estate",
    "vehicle",
    "other_asset",
    "other_liability",
  ].map((kind, id) => ({
    ...account,
    id,
    kind,
    role: (["credit_card", "loan", "mortgage", "other_liability"].includes(kind)
      ? "liability"
      : "asset") as Account["role"],
  }));
  const assets = all.filter(belongsInAssets),
    money = all.filter((item) => !belongsInAssets(item));
  expect(assets.map((item) => item.kind)).toEqual([
    "loan",
    "mortgage",
    "real_estate",
    "vehicle",
    "other_asset",
    "other_liability",
  ]);
  expect(money.map((item) => item.kind)).toContain("credit_card");
  expect(money.map((item) => item.kind)).toContain("brokerage");
  expect(new Set([...money, ...assets].map((item) => item.id)).size).toBe(
    all.length,
  );
});

test("transaction eligibility uses account kinds for new users and never treats property as spendable", async () => {
  const { isTransactionSource, isTransactionDestination } =
    await import("./accountActions");
  const checking = { ...account, name: "New bank" };
  expect(isTransactionSource(checking, "bitcoin")).toBe(true);
  for (const kind of [
    "savings",
    "cash",
    "bitcoin_wallet",
    "brokerage",
    "stock",
    "etf",
    "real_estate",
    "vehicle",
    "other_asset",
  ]) {
    expect(isTransactionSource({ ...account, kind }, "bitcoin")).toBe(false);
  }
  for (const kind of ["checking", "savings", "cash", "bitcoin_wallet"]) {
    expect(isTransactionSource({ ...account, kind }, "expense")).toBe(true);
  }
  expect(
    isTransactionSource(
      { ...account, kind: "credit_card", role: "liability" },
      "expense",
    ),
  ).toBe(true);
  for (const kind of [
    "real_estate",
    "vehicle",
    "other_asset",
    "mortgage",
    "loan",
    "other_liability",
  ]) {
    for (const mode of [
      "expense",
      "income",
      "bitcoin",
      "transfer",
      "savings",
      "investing",
    ]) {
      expect(isTransactionSource({ ...account, kind }, mode)).toBe(false);
    }
    expect(isTransactionDestination({ ...account, kind }, "bitcoin")).toBe(
      false,
    );
    expect(isTransactionDestination({ ...account, kind }, "transfer")).toBe(
      false,
    );
  }
  expect(
    isTransactionDestination(
      { ...account, kind: "bitcoin_wallet", currency: "BITCOIN" },
      "bitcoin",
    ),
  ).toBe(true);
  expect(
    isTransactionDestination(
      { ...account, kind: "real_estate", currency: "BITCOIN" },
      "bitcoin",
    ),
  ).toBe(false);
  expect(isTransactionSource({ ...checking, archived: true }, "bitcoin")).toBe(
    false,
  );
  expect(
    isTransactionDestination(
      {
        ...account,
        kind: "bitcoin_wallet",
        currency: "BITCOIN",
        archived: true,
      },
      "bitcoin",
    ),
  ).toBe(false);
});
