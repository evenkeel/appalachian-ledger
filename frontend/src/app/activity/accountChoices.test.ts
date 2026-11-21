import { describe, expect, it } from "vitest";
import { accountChoices, canTransfer } from "./accountChoices";
import type { Choice } from "./accountChoices";

const account = (id: number, name: string, kind: string, currency: "USD" | "BITCOIN" = "USD"): Choice => ({
  id,
  name,
  kind,
  currency,
  role: ["credit_card", "loan", "mortgage", "other_liability"].includes(kind) ? "liability" : "asset",
});
const bitkey = account(1, "Bitkey", "bitcoin_wallet", "BITCOIN");
const cold = account(2, "Cold storage", "bitcoin_wallet", "BITCOIN");
const checking = account(3, "Checking", "checking");
const savings = account(4, "Savings", "savings");
const visa = account(5, "Visa", "credit_card");
const loan = account(6, "Car loan", "loan");
const mortgage = account(7, "Mortgage", "mortgage");
const brokerage = account(8, "Brokerage", "brokerage");
const home = account(9, "Home", "real_estate");
const all = [bitkey, cold, checking, savings, visa, loan, mortgage, brokerage, home];
const names = (list: Choice[]) => list.map((item) => item.name);
const none = { from: "", to: "" };

describe("which accounts the entry form offers", () => {
  it("only lets bitcoin arrive from another bitcoin account", () => {
    const { from, source } = accountChoices("transfer", all, { from: "3", to: "1" }, "to");
    expect(names(from)).toEqual(["Cold storage"]);
    // Checking was picked before; it no longer fits, so the form moves to the one that does.
    expect(source?.name).toBe("Cold storage");
    for (const other of [checking, savings, visa, loan, mortgage, brokerage, home]) expect(canTransfer(other, bitkey)).toBe(false);
  });

  it("keeps every sensible destination on offer while the destination is being chosen", () => {
    const { to } = accountChoices("transfer", all, { from: "3", to: "1" }, "to");
    expect(names(to)).toEqual(["Checking", "Visa", "Savings", "Bitkey", "Cold storage", "Brokerage", "Car loan", "Mortgage"]);
  });

  it("before anything is picked, offers every destination and shows one that fits the source", () => {
    const { from, to, source, target } = accountChoices("transfer", all, none);
    expect(names(from)).toEqual(["Checking", "Savings", "Bitkey", "Cold storage", "Brokerage"]);
    expect(names(to)).toContain("Bitkey");
    expect(names(to)).not.toContain("Home");
    expect(source?.name).toBe("Checking");
    expect(target?.name).toBe("Visa");
  });

  it("from a dollar account, offers dollar accounts and debts, never a bitcoin wallet or property", () => {
    const { from, to, target } = accountChoices("transfer", all, { from: "3", to: "" }, "from");
    expect(names(from)).toEqual(["Checking", "Savings", "Bitkey", "Cold storage", "Brokerage"]);
    expect(names(to)).toEqual(["Visa", "Savings", "Brokerage", "Car loan", "Mortgage"]);
    expect(target?.name).toBe("Visa");
  });

  it("from a bitcoin wallet, a transfer offers only other bitcoin accounts", () => {
    const { to } = accountChoices("transfer", all, { from: "2", to: "" }, "from");
    expect(names(to)).toEqual(["Bitkey"]);
    for (const dollars of [checking, savings, visa, loan, mortgage, brokerage]) expect(canTransfer(cold, dollars)).toBe(false);
  });

  it("sells bitcoin from a wallet into a dollar money account, nothing else", () => {
    const { from, to, source, target } = accountChoices("sell", all, none);
    expect(names(from)).toEqual(["Bitkey", "Cold storage"]);
    expect(names(to)).toEqual(["Checking", "Savings"]);
    expect(source?.name).toBe("Bitkey");
    expect(target?.name).toBe("Checking");
  });

  it("never offers a debt or property as where a transfer comes from", () => {
    for (const source of [visa, loan, mortgage, home]) for (const target of all) expect(canTransfer(source, target)).toBe(false);
    for (const source of all) expect(canTransfer(source, home)).toBe(false);
  });

  it("pays an expense from money or a card, and receives income into money or brokerage", () => {
    expect(names(accountChoices("expense", all, none).from)).toEqual(["Checking", "Visa", "Savings", "Bitkey", "Cold storage"]);
    expect(names(accountChoices("income", all, none).from)).toEqual(["Checking", "Savings", "Bitkey", "Cold storage", "Brokerage"]);
  });

  it("buys bitcoin with dollars only, into a wallet only", () => {
    const { from, to } = accountChoices("stack", all, none);
    expect(names(from)).toEqual(["Checking", "Savings"]);
    expect(names(to)).toEqual(["Bitkey", "Cold storage"]);
  });

  it("with a single bitcoin wallet, does not offer it as a transfer destination at all", () => {
    const { to, target } = accountChoices("transfer", [bitkey, checking, savings], { from: "3", to: "1" }, "to");
    expect(names(to)).toEqual(["Checking", "Savings"]);
    expect(target?.name).toBe("Checking");
  });

  it("keeps the accounts of an entry being corrected, even ones the rules would leave out", () => {
    const { from, to, source, target } = accountChoices("transfer", all, { from: "5", to: "9" }, "from", [5, 9]);
    expect(source?.name).toBe("Visa");
    expect(names(from)).toContain("Visa");
    expect(target?.name).toBe("Home");
    expect(names(to)).toContain("Home");
  });
});
