import { beforeEach, expect, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EntryDialog, today } from "./EntryDialog";
import type { Account, Transaction } from "../lib/types";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const cash: Account = {
  id: 1,
  name: "Checking",
  kind: "checking",
  role: "asset",
  currency: "USD",
  balance: "1000",
  balance_minor: "100000",
  bitcoin: null,
  usd: "1000",
  value: "1000",
  holding_type: "dollars",
  archived: false,
  rate_day: null,
  rate_source: null,
};
const wallet: Account = {
  ...cash,
  id: 2,
  name: "Cold wallet",
  kind: "bitcoin_wallet",
  currency: "BITCOIN",
  holding_type: "bitcoin",
};
const savings: Account = { ...cash, id: 3, name: "Savings", kind: "savings" };
const props = {
  accounts: [cash, wallet, savings],
  categories: [{ id: 5, name: "Groceries", kind: "expense" as const }],
  assets: [],
  month: "2026-01",
  onClose: vi.fn(),
  onSaved: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});

const next = () =>
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
const back = () =>
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
const choose = (name: string) =>
  fireEvent.click(screen.getByRole("radio", { name }));
const fill = (name: string | RegExp, value: string) =>
  fireEvent.change(
    screen.getByLabelText(name, {
      selector: "input:not([type=radio]), textarea",
    }),
    {
      target: { value },
    },
  );
const review = () =>
  fireEvent.click(screen.getByRole("button", { name: "Review transaction" }));
const confirm = () =>
  fireEvent.click(screen.getByRole("button", { name: "Confirm and record" }));
const summary = () =>
  within(screen.getByRole("region", { name: "Transaction review" }));

function expenseToDetails({ upcoming = false, repeats = "Once" } = {}) {
  if (upcoming) choose("Upcoming");
  else next();
  choose("Groceries");
  next();
  fill(/^Amount · USD/, "25.50");
  next();
  choose(repeats);
  next();
  fill("Description", "Weekly groceries");
}

function bitcoinToAmount() {
  render(
    <EntryDialog
      {...props}
      state={{ type: "transaction", intent: "bitcoin" }}
    />,
  );
  next();
  expect(
    screen.getByRole("group", { name: "From account" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Bitcoin wallet" }),
  ).not.toBeInTheDocument();
  next();
  expect(
    screen.getByRole("radio", { name: "Cold wallet · bitcoin" }),
  ).toBeChecked();
  next();
}

test("expense entry shows one step at a time and records only after reviewing and confirming", async () => {
  render(
    <EntryDialog {...props} state={{ type: "transaction", kind: "expense" }} />,
  );
  expect(
    screen.getByRole("heading", { name: "Has this expense been paid?" }),
  ).toHaveFocus();
  expect(screen.getByRole("radio", { name: "Paid" })).toBeChecked();
  expect(
    screen.queryByRole("radio", { name: "Groceries" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: /Amount/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Confirm/ }),
  ).not.toBeInTheDocument();
  expenseToDetails();
  fill("Notes · optional", "Farmers market");
  review();
  expect(api).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  for (const value of [
    "Paid",
    "Groceries",
    "Checking",
    "$25.50",
    "2026-01-01",
    "Once",
    "Weekly groceries",
    "Farmers market",
  ]) {
    expect(summary().getByText(value, { exact: true })).toBeInTheDocument();
  }
  confirm();
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledExactlyOnceWith("/transactions", "POST", {
    kind: "expense",
    date: "2026-01-01",
    account_id: 1,
    amount: "25.50",
    description: "Weekly groceries",
    notes: "Farmers market",
    category_id: 5,
    destination_id: null,
    destination_amount: null,
  });
});

test("Back preserves fields and a revised draft must be reviewed again", async () => {
  render(
    <EntryDialog {...props} state={{ type: "transaction", kind: "expense" }} />,
  );
  expenseToDetails();
  fill("Notes · optional", "Keep this note");
  review();
  back();
  expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Weekly groceries",
  );
  back();
  expect(screen.getByRole("radio", { name: "Once" })).toBeChecked();
  back();
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
    "25.50",
  );
  fill(/^Amount · USD/, "41.75");
  next();
  next();
  expect(screen.getByRole("textbox", { name: "Notes · optional" })).toHaveValue(
    "Keep this note",
  );
  review();
  expect(summary().getByText("$41.75")).toBeInTheDocument();
  expect(summary().queryByText("$25.50")).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
  confirm();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({ amount: "41.75", notes: "Keep this note" }),
    ),
  );
});

test("required fields block Continue and submitting an early step cannot save", () => {
  const { container } = render(
    <EntryDialog {...props} state={{ type: "transaction", kind: "expense" }} />,
  );
  fireEvent.submit(container.querySelector("form")!);
  expect(
    screen.getByRole("heading", { name: "Choose a category" }),
  ).toBeInTheDocument();
  next();
  expect(
    screen.getByRole("heading", { name: "Choose a category" }),
  ).toBeInTheDocument();
  choose("Groceries");
  next();
  next();
  expect(
    screen.getByRole("heading", { name: "Enter the amount" }),
  ).toBeInTheDocument();
  fill(/^Amount · USD/, "0");
  next();
  expect(screen.getByRole("alert")).toHaveTextContent("greater than zero");
  fill(/^Amount · USD/, "12.345");
  next();
  expect(screen.getByRole("alert")).toHaveTextContent("two decimal places");
  fill(/^Amount · USD/, "12.34");
  next();
  next();
  review();
  expect(
    screen.getByRole("heading", { name: "Add a description" }),
  ).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

test("a failed confirmation keeps the reviewed data and repeated submits cannot duplicate a save", async () => {
  let rejectSave!: (reason: Error) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
  );
  const { container } = render(
    <EntryDialog {...props} state={{ type: "transaction", kind: "expense" }} />,
  );
  expenseToDetails();
  review();
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.submit(container.querySelector("form")!);
  expect(api).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  rejectSave(new Error("Server unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Server unavailable",
  );
  expect(summary().getByText("$25.50")).toBeInTheDocument();
  confirm();
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledTimes(2);
});

test("Bitcoin buy has only dollars and whole bitcoin fields, then a compact review without a description step", async () => {
  bitcoinToAmount();
  expect(
    screen.queryByRole("group", { name: "Bitcoin entry unit" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Legacy BTC/)).not.toBeInTheDocument();
  fill(/^Dollars/, "100.99");
  fill(/^Bitcoin/, "123456");
  next();
  review();
  expect(
    screen.queryByRole("textbox", { name: "Description" }),
  ).not.toBeInTheDocument();
  expect(summary().getByText("Bitcoin per dollar")).toBeInTheDocument();
  expect(summary().getByText("₿1,222.46 / $1")).toBeInTheDocument();
  expect(summary().getByText("Cold wallet")).toBeInTheDocument();
  expect(summary().getByText("Checking")).toBeInTheDocument();
  expect(summary().getByText("$100.99")).toBeInTheDocument();
  expect(summary().getByText("₿123,456")).toBeInTheDocument();
  expect(summary().getAllByRole("term")).toHaveLength(6);
  expect(api).not.toHaveBeenCalled();
  confirm();
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith(
    "/transactions",
    "POST",
    expect.objectContaining({
      kind: "transfer",
      account_id: 1,
      destination_id: 2,
      amount: "100.99",
      destination_amount: "123456",
      date: "2026-01-01",
      category_id: null,
      description: "Bitcoin buy",
    }),
  );
});

test("Bitcoin buy requires whole units and preserves exact large quantities", () => {
  bitcoinToAmount();
  fill(/^Dollars/, "100");
  fill(/^Bitcoin/, "0.000000001");
  next();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "whole number of bitcoin units",
  );
  expect(screen.getByRole("textbox", { name: /^Bitcoin/ })).toHaveValue(
    "0.000000001",
  );
  fill(/^Bitcoin/, "9000000000000001");
  next();
  review();
  expect(summary().getByText("₿9,000,000,000,000,001")).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

test("general transfers retain exact conversion between entry units", () => {
  render(<EntryDialog {...props} state={{ type: "transaction" }} />);
  choose("Transfer");
  next();
  choose("Cold wallet · bitcoin");
  choose("Legacy BTC · decimal");
  fill(/Received amount/, "90000000.00000001");
  choose("bitcoin · ₿");
  expect(screen.getByRole("textbox", { name: /Received amount/ })).toHaveValue(
    "9000000000000001",
  );
  choose("Legacy BTC · decimal");
  expect(screen.getByRole("textbox", { name: /Received amount/ })).toHaveValue(
    "90000000.00000001",
  );
});

test("date shortcuts and the editable date stay synchronized for a Bitcoin buy", async () => {
  bitcoinToAmount();
  fill(/^Dollars/, "10");
  fill(/^Bitcoin/, "1000");
  next();
  choose("Today");
  expect(screen.getByLabelText("Date")).toHaveValue(today());
  expect(screen.getByRole("radio", { name: "Today" })).toBeChecked();
  choose("Yesterday");
  expect(screen.getByLabelText("Date")).toHaveValue(today(-1));
  fill("Date", today(-2));
  expect(screen.getByRole("radio", { name: "Today" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Yesterday" })).not.toBeChecked();
  review();
  expect(summary().getByText(today(-2))).toBeInTheDocument();
  back();
  expect(screen.getByLabelText("Date")).toHaveValue(today(-2));
  choose("Yesterday");
  review();
  expect(summary().getByText(today(-1))).toBeInTheDocument();
  confirm();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({ date: today(-1), description: "Bitcoin buy" }),
    ),
  );
});

test("savings funding skips category and received amount, then confirms a same-currency transfer", async () => {
  render(
    <EntryDialog
      {...props}
      state={{ type: "transaction", intent: "savings" }}
    />,
  );
  next();
  expect(
    screen.getByRole("heading", { name: "Choose the from account" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "To account" }),
  ).not.toBeInTheDocument();
  next();
  expect(
    within(screen.getByRole("group", { name: "To account" })).getByRole(
      "radio",
      { name: "Savings · USD" },
    ),
  ).toBeChecked();
  next();
  expect(
    screen.queryByRole("textbox", { name: /Received amount/ }),
  ).not.toBeInTheDocument();
  fill(/Amount · USD/, "250");
  next();
  next();
  review();
  expect(summary().queryByText("Category")).not.toBeInTheDocument();
  confirm();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({
        kind: "transfer",
        destination_id: 3,
        destination_amount: null,
        amount: "250",
      }),
    ),
  );
});

test("changing type updates the steps and empty account choices cannot advance", () => {
  render(
    <EntryDialog
      {...props}
      accounts={[cash]}
      state={{ type: "transaction" }}
    />,
  );
  choose("Bitcoin buy");
  expect(
    screen.getByRole("heading", { name: "Choose the from account" }),
  ).toBeInTheDocument();
  next();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Create a bitcoin wallet",
  );
  next();
  expect(screen.getByRole("alert")).toHaveTextContent("destination account");
  back();
  back();
  choose("Expense");
  expect(
    screen.getByRole("heading", { name: "Choose a category" }),
  ).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

test.each([
  ["Once", "once"],
  ["Weekly", "weekly"],
  ["Monthly", "monthly"],
  ["Quarterly", "quarterly"],
  ["Every 6 months", "semiannual"],
  ["Yearly", "yearly"],
])(
  "upcoming expense reviews its %s schedule and saves only on confirmation",
  async (label, frequency) => {
    render(
      <EntryDialog
        {...props}
        state={{
          type: "transaction",
          kind: "expense",
          recurring: true,
          oneTime: true,
        }}
      />,
    );
    choose("Upcoming");
    choose("Groceries");
    next();
    fill(/^Amount · USD/, "85");
    next();
    fill("Next due date", "2027-02-01");
    choose(label);
    next();
    fill("Description", "Planned groceries");
    review();
    expect(summary().getByText("Upcoming")).toBeInTheDocument();
    expect(summary().getByText(label, { exact: true })).toBeInTheDocument();
    expect(summary().getByText("2027-02-01")).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and save plan" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledExactlyOnceWith(
        "/recurring-bills",
        "POST",
        expect.objectContaining({
          frequency,
          record_now: false,
          transaction: expect.objectContaining({
            date: "2027-02-01",
            amount: "85",
            category_id: 5,
            account_id: 1,
          }),
        }),
      ),
    );
  },
);

test("a paid repeating expense records the expense and the next bill together", async () => {
  render(
    <EntryDialog {...props} state={{ type: "transaction", kind: "expense" }} />,
  );
  expenseToDetails({ repeats: "Monthly" });
  review();
  expect(summary().getByText("Monthly")).toBeInTheDocument();
  confirm();
  await waitFor(() =>
    expect(api).toHaveBeenCalledExactlyOnceWith(
      "/recurring-bills",
      "POST",
      expect.objectContaining({ frequency: "monthly", record_now: true }),
    ),
  );
});

test("switching an upcoming draft back to paid preserves its amount and restores date limits", () => {
  render(
    <EntryDialog {...props} state={{ type: "transaction", kind: "expense" }} />,
  );
  expenseToDetails({ upcoming: true });
  back();
  fill("Next due date", "2099-01-01");
  back();
  back();
  back();
  back();
  choose("Paid");
  next();
  next();
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
    "25.50",
  );
  next();
  expect(screen.getByLabelText("Date")).toHaveValue(today());
  expect(screen.getByLabelText("Date")).toHaveAttribute("max", today());
});

const previous: Transaction = {
  id: 42,
  date: "2026-01-07",
  kind: "expense",
  description: "Groceries",
  notes: "Weekly shop",
  account_id: 1,
  account: "Checking",
  currency: "USD",
  amount: "72.31",
  category_id: 5,
  category: "Groceries",
  destination_id: null,
  destination_amount: null,
  destination_currency: null,
  destination_account: null,
  bitcoin: null,
  usd: "72.31",
  rate_snapshot: null,
  valuation_basis: "historical purchasing power",
};

test.each([false, true])(
  "prefilled expense review preserves data for edit=%s",
  async (editing) => {
    render(
      <EntryDialog
        {...props}
        state={
          editing
            ? { type: "transaction", transaction: previous }
            : { type: "transaction", repeat: previous }
        }
      />,
    );
    next();
    expect(screen.getByRole("radio", { name: "Groceries" })).toBeChecked();
    next();
    next();
    expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
      "72.31",
    );
    next();
    expect(screen.getByLabelText("Date")).toHaveValue(
      editing ? previous.date : today(),
    );
    next();
    review();
    fireEvent.click(
      screen.getByRole("button", {
        name: editing ? "Confirm changes" : "Confirm and record",
      }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledExactlyOnceWith(
        editing ? "/transactions/42" : "/transactions",
        editing ? "PUT" : "POST",
        expect.objectContaining({
          account_id: 1,
          category_id: 5,
          description: "Groceries",
          notes: "Weekly shop",
          amount: "72.31",
          date: editing ? previous.date : today(),
        }),
      ),
    );
  },
);

test("expense category applies its default before the account step and allows an override", () => {
  render(
    <EntryDialog
      {...props}
      paymentDefaults={{ "5": 3 }}
      state={{ type: "transaction", kind: "expense" }}
    />,
  );
  next();
  choose("Groceries");
  expect(screen.getByRole("radio", { name: "Savings · USD" })).toBeChecked();
  choose("Checking · USD");
  back();
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
});

test.each([false, true])(
  "category shortcut uses its default unless an explicit account is provided: %s",
  (explicitAccount) => {
    render(
      <EntryDialog
        {...props}
        paymentDefaults={{ "5": 3 }}
        state={{
          type: "transaction",
          kind: "expense",
          category_id: 5,
          ...(explicitAccount ? { account: cash } : {}),
        }}
      />,
    );
    next();
    next();
    expect(
      screen.getByRole("radio", {
        name: explicitAccount ? "Checking · USD" : "Savings · USD",
      }),
    ).toBeChecked();
  },
);

test("archived payment defaults are ignored", () => {
  render(
    <EntryDialog
      {...props}
      accounts={[cash, { ...savings, archived: true }]}
      paymentDefaults={{ "5": 3 }}
      state={{ type: "transaction", kind: "expense", category_id: 5 }}
    />,
  );
  next();
  next();
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  expect(
    screen.queryByRole("radio", { name: "Savings · USD" }),
  ).not.toBeInTheDocument();
});

test("income categories do not change the payment account", () => {
  render(
    <EntryDialog
      {...props}
      categories={[{ id: 6, name: "Salary", kind: "income" }]}
      paymentDefaults={{ "6": 3 }}
      state={{ type: "transaction", kind: "income" }}
    />,
  );
  next();
  choose("Salary");
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
});

test.each([false, true])(
  "consumer debt exclusion toggles from %s and saves with the account",
  async (excluded) => {
    const loan: Account = {
      ...cash,
      id: 10,
      name: "Gooding Loan",
      kind: "loan",
      role: "liability",
      holding_type: "debt",
      exclude_from_consumer_debt: excluded,
    };
    render(
      <EntryDialog {...props} state={{ type: "editAccount", account: loan }} />,
    );
    const toggle = screen.getByRole("switch", {
      name: "Exclude from consumer debt",
    });
    if (excluded) expect(toggle).toBeChecked();
    else expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save to ledger" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledExactlyOnceWith("/accounts/10", "PATCH", {
      name: "Gooding Loan",
      archived: false,
      exclude_from_consumer_debt: !excluded,
    });
  },
);

test("consumer debt exclusion is not offered for an asset account", () => {
  render(
    <EntryDialog {...props} state={{ type: "editAccount", account: cash }} />,
  );
  expect(
    screen.queryByRole("switch", { name: "Exclude from consumer debt" }),
  ).not.toBeInTheDocument();
});

test.each([
  ["real_estate", "Add an asset", "real_estate", "checking"],
  ["loan", "Add a debt", "loan", "credit_card"],
])(
  "creation from %s defaults to its new management home",
  (kind, title, selected, excluded) => {
    render(
      <EntryDialog {...props} state={{ type: "account", accountKind: kind }} />,
    );
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByLabelText("Account type")).toHaveValue(selected);
    expect(
      screen.queryByRole("option", { name: excluded.replaceAll("_", " ") }),
    ).not.toBeInTheDocument();
  },
);

test.each([false, true])(
  "Everyday Cash exclusion toggles from %s and saves",
  async (excluded) => {
    const checking: Account = {
      ...cash,
      kind: "checking",
      currency: "USD",
      role: "asset",
      exclude_from_liquid_usd: excluded,
    };
    render(
      <EntryDialog
        {...props}
        state={{ type: "editAccount", account: checking }}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: "Exclude from Everyday Cash",
    });
    expect((toggle as HTMLInputElement).checked).toBe(excluded);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save to ledger" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith(`/accounts/${checking.id}`, "PATCH", {
      name: checking.name,
      archived: false,
      exclude_from_liquid_usd: !excluded,
    });
  },
);

test("Everyday Cash exclusion is not offered for savings", () => {
  render(
    <EntryDialog
      {...props}
      state={{ type: "editAccount", account: { ...cash, kind: "savings" } }}
    />,
  );
  expect(
    screen.queryByRole("switch", { name: "Exclude from Everyday Cash" }),
  ).not.toBeInTheDocument();
});

test("Bitcoin buy source selection excludes property, non-checking accounts, and archived accounts", () => {
  const house: Account = {
    ...cash,
    id: 10,
    name: "Basecamp condo",
    kind: "real_estate",
    holding_type: "valued_asset",
  };
  render(
    <EntryDialog
      {...props}
      accounts={[
        ...props.accounts,
        house,
        { ...cash, id: 11, name: "Old checking", archived: true },
        { ...cash, id: 12, name: "Cash on hand", kind: "cash" },
        {
          ...cash,
          id: 13,
          name: "Card",
          kind: "credit_card",
          role: "liability",
          holding_type: "debt",
        },
      ]}
      state={{ type: "transaction", account: house }}
    />,
  );
  choose("Bitcoin buy");
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  expect(
    screen.queryByRole("group", { name: "Bitcoin wallet" }),
  ).not.toBeInTheDocument();
  next();
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(
    screen.getByRole("radio", { name: "Cold wallet · bitcoin" }),
  ).toBeInTheDocument();
});

test("one click on each single-choice step advances, including already-selected options", () => {
  render(<EntryDialog {...props} state={{ type: "transaction" }} />);
  choose("Expense");
  expect(
    screen.getByRole("heading", { name: "Choose a category" }),
  ).toHaveFocus();
  choose("Groceries");
  expect(
    screen.getByRole("heading", { name: "Choose the account" }),
  ).toHaveFocus();
  choose("Checking · USD");
  expect(
    screen.getByRole("heading", { name: "Enter the amount" }),
  ).toHaveFocus();
  expect(api).not.toHaveBeenCalled();
  back();
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  choose("Checking · USD");
  expect(
    screen.getByRole("heading", { name: "Enter the amount" }),
  ).toHaveFocus();
});

test("selecting Bitcoin buy immediately updates the flow and selecting accounts advances", () => {
  render(<EntryDialog {...props} state={{ type: "transaction" }} />);
  choose("Bitcoin buy");
  expect(
    screen.getByRole("heading", { name: "Choose the from account" }),
  ).toHaveFocus();
  choose("Checking · USD");
  expect(
    screen.getByRole("heading", { name: "Choose the bitcoin wallet" }),
  ).toHaveFocus();
  choose("Cold wallet · bitcoin");
  expect(screen.getByRole("textbox", { name: /^Dollars/ })).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

test("Paid selection advances and expense review uses six compact fields", () => {
  render(
    <EntryDialog {...props} state={{ type: "transaction", kind: "expense" }} />,
  );
  choose("Paid");
  choose("Groceries");
  choose("Checking · USD");
  fill(/^Amount · USD/, "25.50");
  next();
  next();
  fill("Description", "Weekly groceries");
  review();
  expect(summary().getAllByRole("term")).toHaveLength(6);
  expect(
    screen.getByRole("region", { name: "Transaction review" }),
  ).toHaveClass("transaction-review-compact");
  expect(summary().getByText("Weekly groceries")).toBeInTheDocument();
  expect(summary().queryByText("None")).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});
