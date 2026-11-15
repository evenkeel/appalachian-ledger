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

const choose = (name: string, group?: string) =>
  fireEvent.click(
    (group
      ? within(screen.getByRole("group", { name: group }))
      : screen
    ).getByRole("radio", { name }),
  );
const fill = (name: string | RegExp, value: string) =>
  fireEvent.change(
    screen.getByLabelText(name, {
      selector: "input:not([type=radio]), textarea",
    }),
    {
      target: { value },
    },
  );
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const expense = { type: "transaction", kind: "expense" } as const;

test("an expense is entered on one screen and saved with a single action", async () => {
  render(<EntryDialog {...props} state={expense} />);
  expect(screen.getByRole("heading", { name: "Add expense" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "Paid" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Once" })).toBeChecked();
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveFocus();
  expect(
    screen.queryByRole("group", { name: "Transaction type" }),
  ).not.toBeInTheDocument();
  fill(/^Amount · USD/, "25.50");
  choose("Groceries");
  fill(/^Description/, "Weekly groceries");
  fill("Notes · optional", "Farmers market");
  press("Record expense");
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

test("a blank description falls back to the category name", async () => {
  render(<EntryDialog {...props} state={expense} />);
  fill(/^Amount · USD/, "9");
  choose("Groceries");
  press("Record expense");
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({ description: "Groceries", notes: "" }),
    ),
  );
});

test("missing or invalid fields are reported together and nothing is saved", () => {
  const { container } = render(<EntryDialog {...props} state={expense} />);
  fireEvent.submit(container.querySelector("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a category");
  choose("Groceries");
  press("Record expense");
  expect(screen.getByRole("alert")).toHaveTextContent("USD amount");
  fill(/^Amount · USD/, "0");
  press("Record expense");
  expect(screen.getByRole("alert")).toHaveTextContent("greater than zero");
  fill(/^Amount · USD/, "12.345");
  press("Record expense");
  expect(screen.getByRole("alert")).toHaveTextContent("two decimal places");
  fill(/^Amount · USD/, "12.34");
  fill("Date", "2999-01-01");
  press("Record expense");
  expect(screen.getByRole("alert")).toHaveTextContent("in the future");
  expect(api).not.toHaveBeenCalled();
});

test("a failed save keeps the draft and repeated submits cannot duplicate a save", async () => {
  let rejectSave!: (reason: Error) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
  );
  const { container } = render(<EntryDialog {...props} state={expense} />);
  fill(/^Amount · USD/, "25.50");
  choose("Groceries");
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.submit(container.querySelector("form")!);
  expect(api).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  rejectSave(new Error("Server unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Server unavailable",
  );
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
    "25.50",
  );
  expect(screen.getByRole("radio", { name: "Groceries" })).toBeChecked();
  press("Record expense");
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledTimes(2);
});

test("Save and add another keeps the form open with its choices and clears the amount", async () => {
  const onSavedAnother = vi.fn();
  render(
    <EntryDialog {...props} onSavedAnother={onSavedAnother} state={expense} />,
  );
  fill(/^Amount · USD/, "4.25");
  choose("Groceries");
  fill(/^Description/, "Coffee beans");
  press("Save and add another");
  await waitFor(() => expect(onSavedAnother).toHaveBeenCalledOnce());
  expect(props.onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Saved 1 entry");
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
    "",
  );
  expect(screen.getByRole("textbox", { name: /^Description/ })).toHaveValue("");
  expect(screen.getByRole("radio", { name: "Groceries" })).toBeChecked();
  fill(/^Amount · USD/, "7");
  press("Record expense");
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledTimes(2);
});

function bitcoinBuy() {
  render(
    <EntryDialog
      {...props}
      state={{ type: "transaction", intent: "bitcoin" }}
    />,
  );
  expect(
    within(screen.getByRole("group", { name: "From account" })).getByRole(
      "radio",
      { name: "Checking · USD" },
    ),
  ).toBeChecked();
  expect(
    within(screen.getByRole("group", { name: "Bitcoin wallet" })).getByRole(
      "radio",
      { name: "Cold wallet · bitcoin" },
    ),
  ).toBeChecked();
}

test("Bitcoin buy has only dollars and whole bitcoin fields and no description", async () => {
  bitcoinBuy();
  expect(
    screen.queryByRole("group", { name: "Bitcoin entry unit" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Legacy BTC/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: /^Description/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Category" }),
  ).not.toBeInTheDocument();
  fill(/^Dollars/, "100.99");
  fill(/^Bitcoin/, "123456");
  press("Record bitcoin buy");
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

test("Bitcoin buy requires whole units and preserves exact large quantities", async () => {
  bitcoinBuy();
  fill(/^Dollars/, "100");
  fill(/^Bitcoin/, "0.000000001");
  press("Record bitcoin buy");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "whole number of bitcoin units",
  );
  expect(screen.getByRole("textbox", { name: /^Bitcoin/ })).toHaveValue(
    "0.000000001",
  );
  expect(api).not.toHaveBeenCalled();
  fill(/^Bitcoin/, "9000000000000001");
  press("Record bitcoin buy");
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({ destination_amount: "9000000000000001" }),
    ),
  );
});

test("general transfers retain exact conversion between entry units", () => {
  render(<EntryDialog {...props} state={{ type: "transaction" }} />);
  choose("Transfer");
  choose("Cold wallet · bitcoin", "To account");
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

test("date shortcuts and the editable date stay synchronized", async () => {
  bitcoinBuy();
  fill(/^Dollars/, "10");
  fill(/^Bitcoin/, "1000");
  choose("Today");
  expect(screen.getByLabelText("Date")).toHaveValue(today());
  expect(screen.getByRole("radio", { name: "Today" })).toBeChecked();
  choose("Yesterday");
  expect(screen.getByLabelText("Date")).toHaveValue(today(-1));
  fill("Date", today(-2));
  expect(screen.getByRole("radio", { name: "Today" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Yesterday" })).not.toBeChecked();
  choose("Yesterday");
  press("Record bitcoin buy");
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({ date: today(-1), description: "Bitcoin buy" }),
    ),
  );
});

test("savings funding has no category or received amount and saves a same-currency transfer", async () => {
  render(
    <EntryDialog
      {...props}
      state={{ type: "transaction", intent: "savings" }}
    />,
  );
  expect(
    within(screen.getByRole("group", { name: "To account" })).getByRole(
      "radio",
      { name: "Savings · USD" },
    ),
  ).toBeChecked();
  expect(
    screen.queryByRole("group", { name: "Category" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: /Received amount/ }),
  ).not.toBeInTheDocument();
  fill(/Amount · USD/, "250");
  press("Record transfer");
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({
        kind: "transfer",
        destination_id: 3,
        destination_amount: null,
        amount: "250",
        description: "Savings contribution",
      }),
    ),
  );
});

test("changing type swaps the fields in place and a missing destination blocks saving", () => {
  render(
    <EntryDialog
      {...props}
      accounts={[cash]}
      state={{ type: "transaction" }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Add transaction" }),
  ).toBeVisible();
  expect(screen.getByRole("group", { name: "Category" })).toBeInTheDocument();
  choose("Bitcoin buy");
  expect(
    screen.queryByRole("group", { name: "Category" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Create a bitcoin wallet",
  );
  fill(/^Dollars/, "10");
  press("Record bitcoin buy");
  expect(screen.getByRole("alert")).toHaveTextContent("destination account");
  choose("Expense");
  expect(screen.getByRole("group", { name: "Category" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Payment" })).toBeInTheDocument();
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
  "an upcoming expense saves its %s schedule without recording a payment",
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
    expect(screen.getByRole("radio", { name: "Upcoming" })).toBeChecked();
    choose("Groceries");
    fill(/^Amount · USD/, "85");
    fill("Next due date", "2027-02-01");
    choose(label);
    fill(/^Description/, "Planned groceries");
    press("Save planned expense");
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

test.each([expense, { type: "transaction" } as const])(
  "a paid repeating expense records the expense and the next bill together",
  async (state) => {
    render(<EntryDialog {...props} state={state} />);
    fill(/^Amount · USD/, "25.50");
    choose("Groceries");
    choose("Monthly");
    press("Record expense");
    await waitFor(() =>
      expect(api).toHaveBeenCalledExactlyOnceWith(
        "/recurring-bills",
        "POST",
        expect.objectContaining({ frequency: "monthly", record_now: true }),
      ),
    );
  },
);

test("switching an upcoming draft back to paid preserves its amount and restores date limits", () => {
  render(<EntryDialog {...props} state={expense} />);
  fill(/^Amount · USD/, "25.50");
  choose("Upcoming");
  fill("Next due date", "2099-01-01");
  expect(screen.getByLabelText("Next due date")).not.toHaveAttribute("max");
  choose("Paid");
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
    "25.50",
  );
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
  "a prefilled expense preserves its data for edit=%s",
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
    expect(
      screen.getByRole("heading", {
        name: editing ? "Edit transaction" : "Repeat expense",
      }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: "Groceries" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
      "72.31",
    );
    expect(screen.getByLabelText("Date")).toHaveValue(
      editing ? previous.date : today(),
    );
    expect(
      screen.getByRole("textbox", { name: "Notes · optional" }),
    ).toHaveValue("Weekly shop");
    press(editing ? "Save changes" : "Record expense");
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

test("an expense category applies its default account and allows an override", () => {
  render(
    <EntryDialog {...props} paymentDefaults={{ "5": 3 }} state={expense} />,
  );
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  choose("Groceries");
  expect(screen.getByRole("radio", { name: "Savings · USD" })).toBeChecked();
  choose("Checking · USD");
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Groceries" })).toBeChecked();
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
  expect(screen.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  expect(
    screen.queryByRole("radio", { name: "Savings · USD" }),
  ).not.toBeInTheDocument();
});

test("income categories do not change the receiving account", () => {
  render(
    <EntryDialog
      {...props}
      categories={[{ id: 6, name: "Salary", kind: "income" }]}
      paymentDefaults={{ "6": 3 }}
      state={{ type: "transaction", kind: "income" }}
    />,
  );
  choose("Salary");
  expect(
    within(screen.getByRole("group", { name: "Received into" })).getByRole(
      "radio",
      { name: "Checking · USD" },
    ),
  ).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Record income" }),
  ).toBeInTheDocument();
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
  const from = within(screen.getByRole("group", { name: "From account" }));
  expect(from.getAllByRole("radio")).toHaveLength(1);
  expect(from.getByRole("radio", { name: "Checking · USD" })).toBeChecked();
  const to = within(screen.getByRole("group", { name: "Bitcoin wallet" }));
  expect(to.getAllByRole("radio")).toHaveLength(1);
  expect(
    to.getByRole("radio", { name: "Cold wallet · bitcoin" }),
  ).toBeInTheDocument();
});

const spotify: Transaction = {
  ...previous,
  id: 50,
  description: "Spotify",
  amount: "11.99",
  account_id: 3,
  account: "Savings",
  date: "2026-01-03",
};
const learned = {
  ...props,
  categories: [
    ...props.categories,
    { id: 7, name: "Subscriptions", kind: "expense" as const },
  ],
  history: [
    { ...spotify, category_id: 7, category: "Subscriptions" },
    { ...previous, id: 51, date: "2025-12-07" },
    previous,
  ],
};

test("a frequent payee fills the description, category, account and last amount in one click", async () => {
  render(<EntryDialog {...learned} state={expense} />);
  const frequent = within(
    screen.getByRole("group", { name: "Frequent entries" }),
  );
  // Most used first.
  expect(frequent.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Groceries$72.31",
    "Spotify$11.99",
  ]);
  fireEvent.click(frequent.getByRole("button", { name: /Spotify/ }));
  expect(screen.getByRole("textbox", { name: /^Description/ })).toHaveValue(
    "Spotify",
  );
  expect(screen.getByRole("radio", { name: "Subscriptions" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Savings · USD" })).toBeChecked();
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
    "11.99",
  );
  press("Record expense");
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/transactions",
      "POST",
      expect.objectContaining({
        description: "Spotify",
        category_id: 7,
        account_id: 3,
        amount: "11.99",
      }),
    ),
  );
});

test("typing narrows suggestions and never overwrites an amount or a hand-picked category", () => {
  render(<EntryDialog {...learned} state={expense} />);
  fill(/^Amount · USD/, "5");
  choose("Groceries");
  fill(/^Description/, "spot");
  const matches = within(
    screen.getByRole("group", { name: "Matching past entries" }),
  );
  expect(matches.getAllByRole("button")).toHaveLength(1);
  fill(/^Description/, "Spotify");
  // Typed in full: the category chosen by hand stays.
  expect(screen.getByRole("radio", { name: "Groceries" })).toBeChecked();
  expect(screen.getByRole("textbox", { name: /^Amount · USD/ })).toHaveValue(
    "5",
  );
});

test("a saved rule categorises as you type and a new rule is stored with the entry", async () => {
  render(
    <EntryDialog
      {...learned}
      history={[]}
      payeeRules={[{ match: "netflix", category_id: 7, account_id: 3 }]}
      state={expense}
    />,
  );
  fill(/^Amount · USD/, "15.49");
  fill(/^Description/, "NETFLIX.COM 1234");
  expect(screen.getByRole("radio", { name: "Subscriptions" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Savings · USD" })).toBeChecked();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Always file “NETFLIX.COM 1234” under Subscriptions",
    }),
  );
  press("Record expense");
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith("/settings/payee-rules", "PUT", {
    payee_rules: [
      { match: "netflix", category_id: 7, account_id: 3 },
      { match: "NETFLIX.COM 1234", category_id: 7, account_id: 3 },
    ],
  });
  expect(props.onSaved.mock.calls[0][0]).toContain(
    "will be filed under Subscriptions",
  );
});
