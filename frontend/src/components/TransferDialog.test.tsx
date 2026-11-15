import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TransferDialog } from "./TransferDialog";
import { QuickEntries } from "./MoneyTracking";
import { today } from "./EntryDialog";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const river: Account = {
  id: 1,
  name: "River Custody",
  kind: "bitcoin_wallet",
  currency: "BITCOIN",
  role: "asset",
  archived: false,
  balance: "100000000",
  balance_minor: "100000000",
  bitcoin: "100000000",
  usd: null,
  value: "100000000",
  holding_type: "bitcoin",
  rate_day: null,
  rate_source: null,
};
const bitkey: Account = { ...river, id: 2, name: "Bitkey", balance: "5000000" };
const checking: Account = {
  ...river,
  id: 3,
  name: "Checking",
  currency: "USD",
  kind: "checking",
  balance: "2000.00",
  holding_type: "dollars",
};
const props = {
  accounts: [river, bitkey, checking],
  initialAccount: river,
  onSaved: vi.fn(),
  onClose: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ id: 4 });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});

test("River to Bitkey needs only an amount and records today with an automatic description", async () => {
  render(<TransferDialog {...props} />);
  expect(screen.getByLabelText("From account")).toHaveValue("1");
  expect(screen.getByLabelText("To account")).toHaveValue("2");
  expect(screen.queryByLabelText(/Amount received/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Amount · bitcoin"), {
    target: { value: "125000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record transfer" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledExactlyOnceWith("/transactions", "POST", {
    kind: "transfer",
    date: today(),
    account_id: 1,
    destination_id: 2,
    amount: "125000",
    destination_amount: null,
    category_id: null,
    description: "River Custody → Bitkey",
    notes: "",
  });
});

test("decimal BTC converts exactly and unit changes preserve the entered amount", async () => {
  render(<TransferDialog {...props} />);
  fireEvent.change(screen.getByLabelText("Amount unit"), {
    target: { value: "BTC" },
  });
  fireEvent.change(screen.getByLabelText("Amount · BTC"), {
    target: { value: "0.00123456" },
  });
  fireEvent.change(screen.getByLabelText("Amount unit"), {
    target: { value: "BITCOIN" },
  });
  expect(screen.getByLabelText("Amount · bitcoin")).toHaveValue("123456");
  fireEvent.click(screen.getByRole("button", { name: "Record transfer" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({ amount: "123456" }),
    ),
  );
});

test("changing currency requires the actual amount received", async () => {
  render(<TransferDialog {...props} initialAccount={checking} />);
  fireEvent.change(screen.getByLabelText("To account"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Amount · USD"), {
    target: { value: "120.50" },
  });
  fireEvent.change(screen.getByLabelText("Received unit"), {
    target: { value: "BTC" },
  });
  fireEvent.change(screen.getByLabelText(/^Amount received · BTC/), {
    target: { value: "0.00125" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record transfer" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({
        account_id: 3,
        destination_id: 1,
        amount: "120.50",
        destination_amount: "125000",
      }),
    ),
  );
});

test("swap reverses accounts and archived destinations are excluded", () => {
  render(
    <TransferDialog
      {...props}
      accounts={[
        ...props.accounts,
        { ...bitkey, id: 8, name: "Old wallet", archived: true },
      ]}
    />,
  );
  expect(
    screen.queryByRole("option", { name: /Old wallet/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Swap accounts" }));
  expect(screen.getByLabelText("From account")).toHaveValue("2");
  expect(screen.getByLabelText("To account")).toHaveValue("1");
});

test("failed transfers preserve the amount for correction", async () => {
  vi.mocked(api).mockRejectedValueOnce(
    new Error("Account changed. Try again."),
  );
  render(<TransferDialog {...props} />);
  fireEvent.change(screen.getByLabelText("Amount · bitcoin"), {
    target: { value: "500" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record transfer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Account changed");
  expect(screen.getByLabelText("Amount · bitcoin")).toHaveValue("500");
  expect(props.onSaved).not.toHaveBeenCalled();
});

test("Overview has a direct transfer shortcut", () => {
  const add = vi.fn();
  render(<QuickEntries onAdd={add} />);
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  expect(add).toHaveBeenCalledWith({ type: "transfer" });
});

test("ordinary transfers omit debts, property, and brokerage accounts", () => {
  render(
    <TransferDialog
      {...props}
      accounts={[
        ...props.accounts,
        { ...checking, id: 5, name: "Condo", kind: "real_estate" },
        {
          ...checking,
          id: 6,
          name: "Card",
          kind: "credit_card",
          role: "liability",
        },
        {
          ...checking,
          id: 7,
          name: "Broker",
          kind: "brokerage",
          portfolio: {
            cash: "25.00",
            holdings: [],
            started_on: "2026-01-01",
            source: "test",
            error: null,
          },
        },
      ]}
    />,
  );
  for (const name of [/Condo/, /Card/, /Broker/])
    expect(screen.queryByRole("option", { name })).not.toBeInTheDocument();
});

test("brokerage cash movement displays cash instead of investment value", () => {
  const broker: Account = {
    ...checking,
    id: 7,
    name: "Broker",
    kind: "brokerage",
    balance: "10000.00",
    portfolio: {
      cash: "25.00",
      holdings: [],
      started_on: "2026-01-01",
      source: "test",
      error: null,
    },
  };
  render(
    <TransferDialog
      {...props}
      accounts={[checking, broker]}
      initialAccount={broker}
      cashMovement
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Move brokerage cash" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("From account")).toHaveValue("7");
  expect(
    screen.getByRole("option", { name: "Broker · $25.00 cash" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("$10,000.00")).not.toBeInTheDocument();
  expect(screen.getByText("Uninvested cash:")).toBeInTheDocument();
});
