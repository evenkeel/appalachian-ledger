import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Account } from "../lib/types";
import { LiquidUSD } from "./LiquidUSD";

function account(
  balance_minor: string,
  overrides: Partial<Account> = {},
): Account {
  return {
    id: 1,
    name: "Checking",
    kind: "checking",
    role: "asset",
    currency: "USD",
    balance_minor,
    archived: false,
    ...overrides,
  } as Account;
}

test("totals active USD checking accounts including overdrafts", () => {
  render(
    <LiquidUSD
      accounts={[
        account("10001"),
        account("20002"),
        account("-5000"),
        account("99999", { kind: "savings" }),
        account("99999", { kind: "brokerage" }),
        account("99999", { kind: "cash" }),
        account("99999", { currency: "BITCOIN" }),
        account("99999", { role: "liability" }),
        account("99999", { archived: true }),
      ]}
    />,
  );
  const card = within(screen.getByRole("group", { name: "Everyday Cash" }));
  expect(card.getByText("$250.03")).toBeInTheDocument();
  expect(card.getByText("3 active checking accounts")).toBeInTheDocument();
});

test("preserves cents above JavaScript's safe integer limit", () => {
  render(<LiquidUSD accounts={[account("9007199254740993"), account("1")]} />);
  expect(screen.getByText("$90,071,992,547,409.94")).toBeInTheDocument();
});

test("displays zero when there are no checking accounts", () => {
  render(<LiquidUSD accounts={[]} />);
  expect(screen.getByText("$0.00")).toBeInTheDocument();
  expect(screen.getByText("0 active checking accounts")).toBeInTheDocument();
});

test("keeps an overdrawn total negative and red", () => {
  render(<LiquidUSD accounts={[account("-1")]} />);
  expect(screen.getByText("−$0.01")).toHaveClass("negative");
  expect(screen.getByText("1 active checking account")).toBeInTheDocument();
});

test("excludes reserved checking while disclosing its account count", () => {
  render(
    <LiquidUSD
      accounts={[
        account("12345"),
        account("500000", { exclude_from_liquid_usd: true }),
        account("500000", { exclude_from_liquid_usd: true, archived: true }),
      ]}
    />,
  );
  expect(screen.getByText("$123.45")).toBeInTheDocument();
  expect(screen.getByText("1 active checking account")).toBeInTheDocument();
  expect(screen.getByText("1 excluded · set-aside money")).toBeInTheDocument();
});
