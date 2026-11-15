import { test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HoldingsDialog } from "./Holdings";
import { EntryDialog } from "./EntryDialog";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const account: Account = {
  id: 1,
  name: "MSTR",
  kind: "stock",
  role: "asset",
  currency: "USD",
  balance: "1000",
  balance_minor: "100000",
  bitcoin: null,
  usd: "1000",
  value: "1000",
  holding_type: "valued_asset",
  archived: false,
  rate_day: null,
  rate_source: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
test("ticker and fractional shares save with unknown cost basis, no guessed purchase price", async () => {
  vi.mocked(api).mockResolvedValue({});
  const saved = vi.fn();
  render(
    <HoldingsDialog account={account} onClose={() => {}} onSaved={saved} />,
  );
  expect(screen.getByLabelText("Ticker 1")).toHaveValue("MSTR");
  fireEvent.change(screen.getByLabelText("Shares 1"), {
    target: { value: "1.25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save & fetch prices" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith("/accounts/1/holdings", "PUT", {
    cash: "0",
    holdings: [{ symbol: "MSTR", shares: "1.25", cost_basis: null }],
  });
});
test("quote failure keeps the holdings editor open for correction", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Quote unavailable for MSTR"));
  const saved = vi.fn();
  render(
    <HoldingsDialog account={account} onClose={() => {}} onSaved={saved} />,
  );
  fireEvent.change(screen.getByLabelText("Shares 1"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save & fetch prices" }));
  expect(
    await screen.findByText("Quote unavailable for MSTR"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Shares 1")).toHaveValue("10");
  expect(saved).not.toHaveBeenCalled();
});
test("record income opens the correct type, category list, and selected month", () => {
  render(
    <EntryDialog
      state={{ type: "transaction", kind: "income" }}
      accounts={[account]}
      categories={[
        { id: 1, name: "Salary", kind: "income" },
        { id: 2, name: "Groceries", kind: "expense" },
      ]}
      month="2026-01"
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
  expect(screen.getByRole("radio", { name: "Income" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("radio", { name: "Salary" })).toBeInTheDocument();
  expect(
    screen.queryByRole("radio", { name: "Groceries" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveValue("2026-01-01");
});
