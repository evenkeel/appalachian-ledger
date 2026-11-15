import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaymentDialog } from "./PaymentDialog";
import { today } from "./EntryDialog";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const checking: Account = {
  id: 1,
  name: "Checking",
  kind: "checking",
  currency: "USD",
  role: "asset",
  archived: false,
  balance: "5000.00",
  balance_minor: "500000",
  bitcoin: null,
  usd: "5000",
  value: "5000",
  holding_type: "dollars",
  rate_day: null,
  rate_source: null,
};
const debt: Account = {
  ...checking,
  id: 2,
  name: "Loan",
  kind: "loan",
  role: "liability",
  balance: "1000.00",
  holding_type: "debt",
};
const props = {
  debt,
  accounts: [
    checking,
    debt,
    { ...checking, id: 3, name: "Home", kind: "real_estate" },
  ],
  categories: [{ id: 4, name: "Interest", kind: "expense" as const }],
  onSaved: vi.fn(),
  onClose: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ entry_ids: [1] });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});

test("debt payment selects checking and posts total and interest separately", async () => {
  render(<PaymentDialog {...props} />);
  expect(screen.getByLabelText("Pay from account")).toHaveValue("1");
  expect(
    screen.queryByRole("option", { name: /Home/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Payment amount · USD"), {
    target: { value: "300.00" },
  });
  fireEvent.change(screen.getByLabelText(/^Interest & fees · USD/), {
    target: { value: "50" },
  });
  expect(screen.getByText("$250.00")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Interest & fees category"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledExactlyOnceWith("/accounts/2/payments", "POST", {
    account_id: 1,
    date: today(),
    amount: "300.00",
    interest: "50.00",
    category_id: 4,
    notes: "",
  });
});

test("credit card payment needs only the total and no expense category", async () => {
  render(<PaymentDialog {...props} debt={{ ...debt, kind: "credit_card" }} />);
  fireEvent.change(screen.getByLabelText("Payment amount · USD"), {
    target: { value: "100" },
  });
  expect(
    screen.queryByLabelText("Interest & fees category"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/accounts/2/payments",
      "POST",
      expect.objectContaining({
        amount: "100.00",
        interest: "0.00",
        category_id: null,
      }),
    ),
  );
});

test("credit card payment can use a different selected funding account", async () => {
  const funding: Account = { ...checking, id: 10, name: "River Checking" };
  render(
    <PaymentDialog
      {...props}
      debt={{ ...debt, name: "Apple Card", kind: "credit_card" }}
      accounts={[...props.accounts, funding]}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Make payment: Apple Card" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Pay from account"), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText("Payment amount · USD"), {
    target: { value: "125.50" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/accounts/2/payments",
      "POST",
      expect.objectContaining({
        account_id: 10,
        amount: "125.50",
        interest: "0.00",
        category_id: null,
      }),
    ),
  );
});
