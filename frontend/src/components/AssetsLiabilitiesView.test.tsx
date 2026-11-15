import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssetsLiabilitiesView } from "./AssetsLiabilitiesView";
import type { Account, Asset } from "../lib/types";
const home: Account = {
  id: 1,
  name: "Basecamp Condo",
  kind: "real_estate",
  role: "asset",
  currency: "USD",
  balance: "140000.00",
  balance_minor: "14000000",
  usd: "140000.00",
  bitcoin: null,
  value: "140000.00",
  holding_type: "valued_asset",
  archived: false,
  rate_day: null,
  rate_source: null,
};
const loan: Account = {
  ...home,
  id: 2,
  name: "Gooding Loan",
  kind: "loan",
  role: "liability",
  balance: "21000.00",
  holding_type: "debt",
  exclude_from_consumer_debt: true,
};
const props = {
  accounts: [
    home,
    loan,
    { ...home, id: 3, name: "Fidelity", kind: "brokerage" },
    { ...home, id: 4, name: "Checking", kind: "checking" },
    { ...loan, id: 5, name: "Apple Card", kind: "credit_card" },
  ],
  assets: [] as Asset[],
  onAdd: vi.fn(),
  onAccounts: vi.fn(),
  onTransactions: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
});

test("existing property and loans appear without any separate valuation records", () => {
  render(<AssetsLiabilitiesView {...props} />);
  expect(
    screen.getByRole("heading", { name: "Basecamp Condo" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Gooding Loan" }),
  ).toBeInTheDocument();
  expect(screen.getByText("$140,000.00")).toBeInTheDocument();
  expect(screen.getByText("$21,000.00")).toBeInTheDocument();
  for (const name of ["Fidelity", "Checking", "Apple Card"])
    expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
  expect(screen.queryByText("No assets yet.")).not.toBeInTheDocument();
  expect(screen.getByText(/Excluded from consumer debt/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Update value" }));
  expect(props.onAdd).toHaveBeenCalledWith({
    type: "valuation",
    account: home,
  });
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  expect(props.onAdd).toHaveBeenCalledWith({ type: "payment", account: loan });
  fireEvent.click(screen.getByRole("button", { name: "Manage Gooding Loan" }));
  expect(props.onAdd).toHaveBeenCalledWith({
    type: "editAccount",
    account: loan,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "View payment activity" }),
  );
  expect(props.onTransactions).toHaveBeenCalledWith(loan);
});

test("optional valuation history uses existing metadata without duplicating the asset", () => {
  const asset: Asset = {
    id: 7,
    account_id: home.id,
    name: home.name,
    kind: home.kind,
    quantity: "1",
    account: home,
    history: [{ date: "2026-10-01", value: "135000.00" }],
  };
  render(<AssetsLiabilitiesView {...props} assets={[asset]} />);
  expect(screen.getAllByRole("heading", { name: home.name })).toHaveLength(1);
  expect(screen.getByText("2026-10-01")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Update value" }));
  expect(props.onAdd).toHaveBeenCalledWith({ type: "valuation", asset });
});

test("archived debts are hidden by default and can be shown for management", () => {
  render(
    <AssetsLiabilitiesView
      {...props}
      accounts={[{ ...loan, archived: true }]}
    />,
  );
  expect(screen.queryByText("$21,000.00")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }));
  expect(screen.getByText("$21,000.00")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Manage Gooding Loan" }),
  ).toBeEnabled();
});
