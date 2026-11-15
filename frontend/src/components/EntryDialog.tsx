import { useModalDialog } from "../lib/useModalDialog";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { ChoiceField } from "./ChoiceField";
import { api } from "../lib/api";
import {
  isTransactionSource,
  isTransactionDestination,
  isPaymentAccount,
} from "../lib/accountActions";
import { formatBitcoinPerDollar, formatMoney } from "../lib/money";
import { bitcoinInput, bitcoinAsBtc } from "../lib/bitcoinInput";
import type {
  Account,
  Asset,
  BudgetOverview,
  Category,
  Transaction,
  RecurringBill,
} from "../lib/types";

const repeatOptions = [
  { value: "once", label: "Once" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Every 6 months" },
  { value: "yearly", label: "Yearly" },
];

function validateTransactionAmount(
  value: string,
  unit: "USD" | "BTC" | "BITCOIN",
) {
  let minor: string;
  if (unit === "USD") {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
      throw new Error("Enter a USD amount with up to two decimal places.");
    const [whole, fraction = ""] = value.trim().split(".");
    minor = whole + fraction.padEnd(2, "0");
  } else {
    minor = bitcoinInput(value, unit);
  }
  if (BigInt(minor) <= 0n)
    throw new Error("Enter an amount greater than zero.");
  if (BigInt(minor) > 9223372036854775807n)
    throw new Error("Amount exceeds the supported range.");
}

export const today = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export type DialogState = {
  type:
    | "account"
    | "transaction"
    | "transfer"
    | "payment"
    | "budget"
    | "category"
    | "manageCategories"
    | "rate"
    | "import"
    | "valuation"
    | "adjustment"
    | "editAccount"
    | "deleteTransaction";
  kind?: "income" | "expense";
  intent?: "bitcoin" | "savings" | "investing";
  category_id?: number;
  accountKind?: Account["kind"];
  transaction?: Transaction;
  repeat?: Transaction;
  recurring?: boolean;
  cashMovement?: boolean;
  oneTime?: boolean;
  bill?: RecurringBill;
  account?: Account;
  asset?: Asset;
  budget?: BudgetOverview;
};
const titles: Record<DialogState["type"], string> = {
  account: "Create an account",
  transaction: "Record a transaction",
  transfer: "Transfer between accounts",
  payment: "Record payment",
  budget: "Set a monthly budget",
  category: "Create a category",
  manageCategories: "Manage categories",
  rate: "Record an exchange rate",
  import: "Import transactions",
  valuation: "Record a valuation",
  adjustment: "Adjust account balance",
  editAccount: "Manage account",
  deleteTransaction: "Reverse transaction",
};
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function EntryDialog({
  state: initialState,
  accounts,
  categories,
  paymentDefaults = {},
  month,
  onClose,
  onSaved,
}: {
  state: DialogState;
  accounts: Account[];
  categories: Category[];
  paymentDefaults?: Record<string, number>;
  month: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const newExpense =
    initialState.type === "transaction" &&
    initialState.kind === "expense" &&
    !initialState.transaction &&
    !initialState.bill &&
    !initialState.intent;
  const [paymentTiming, setPaymentTiming] = useState(
    initialState.recurring ? "upcoming" : "paid",
  );
  const [frequency, setFrequency] = useState(
    initialState.recurring && !initialState.oneTime ? "monthly" : "once",
  );
  const state = newExpense
    ? {
        ...initialState,
        recurring: paymentTiming === "upcoming",
        oneTime: frequency === "once",
      }
    : initialState;
  const [legacyRecurring, setSaveRecurring] = useState(
    Boolean(initialState.recurring || initialState.bill),
  );
  const saveRecurring = newExpense
    ? paymentTiming === "upcoming" || frequency !== "once"
    : legacyRecurring;
  const preset: Partial<Transaction> | undefined =
    state.transaction ||
    state.repeat ||
    (state.bill
      ? {
          ...state.bill,
          date: state.bill.next_due,
          kind: "expense",
        }
      : undefined);
  const [entryDate, setEntryDate] = useState(
    (initialState.repeat || initialState.recurring ? today() : preset?.date) ||
      (month !== today().slice(0, 7) ? `${month}-01` : today()),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [accountKind, setAccountKind] = useState<string>(
    state.accountKind || "checking",
  );
  const [accountCurrency, setAccountCurrency] = useState(
    state.accountKind === "bitcoin_wallet" ? "BITCOIN" : "USD",
  );
  const [mode, setMode] = useState(
    state.intent || preset?.kind || state.kind || "expense",
  );
  const kind = ["bitcoin", "savings", "investing"].includes(mode)
    ? "transfer"
    : mode;
  const sources = accounts.filter((a) => isTransactionSource(a, mode));
  function suggestedAccount(categoryId: number | string | undefined) {
    if (state.type !== "transaction" || kind !== "expense" || preset)
      return undefined;
    return accounts.find(
      (a) =>
        a.id === paymentDefaults[String(categoryId)] && isPaymentAccount(a),
    );
  }
  const [source, setSource] = useState(
    String(
      preset?.account_id ||
        state.account?.id ||
        suggestedAccount(state.category_id)?.id ||
        sources.find((a) => a.kind === "checking")?.id ||
        sources[0]?.id ||
        "",
    ),
  );
  const account = accounts.find((a) => String(a.id) === source);
  const currency = account?.currency === "USD" ? "USD" : "bitcoin";
  const destinations = accounts.filter(
    (a) => String(a.id) !== source && isTransactionDestination(a, mode),
  );
  const [destinationId, setDestinationId] = useState(
    String(
      preset?.destination_id || (state.intent ? destinations[0]?.id || "" : ""),
    ),
  );
  const destination = destinations.find((a) => String(a.id) === destinationId);
  const [received, setReceived] = useState(preset?.destination_amount || "");
  const [receivedUnit, setReceivedUnit] = useState<"BTC" | "BITCOIN">(
    "BITCOIN",
  );
  const crossCurrency =
    account && destination && account.currency !== destination.currency;
  const isTransaction = state.type === "transaction";
  const steps = [
    ...(newExpense
      ? [{ id: "payment", label: "Has this expense been paid?" }]
      : !state.recurring && !state.bill
        ? [{ id: "type", label: "What would you like to record?" }]
        : []),
    ...(kind !== "transfer"
      ? [{ id: "category", label: "Choose a category" }]
      : []),
    {
      id: "accounts",
      label:
        kind === "transfer" ? "Choose the from account" : "Choose the account",
    },
    ...(kind === "transfer"
      ? [
          {
            id: "destination",
            label:
              mode === "bitcoin"
                ? "Choose the bitcoin wallet"
                : "Choose the to account",
          },
        ]
      : []),
    { id: "amount", label: "Enter the amount" },
    {
      id: "schedule",
      label:
        kind === "expense" && !state.transaction
          ? "Set the date and repeat schedule"
          : "Set the date",
    },
    ...(mode === "bitcoin"
      ? []
      : [{ id: "details", label: "Add a description" }]),
    { id: "review", label: "Review and confirm" },
  ];
  const [step, setStep] = useState(steps[0].id);
  const stepIndex = steps.findIndex((item) => item.id === step);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [reviewData, setReviewData] = useState<FormData | null>(null);
  useModalDialog(ref);
  useEffect(() => {
    if (isTransaction) {
      stepHeading.current?.focus();
      const body = ref.current?.querySelector(".form-grid");
      if (body) body.scrollTop = 0;
    }
  }, [step, isTransaction]);
  function chooseAndAdvance(nextStep: string) {
    setError("");
    setReviewData(null);
    setStep(nextStep);
  }
  function goBack() {
    setReviewData(null);
    setError("");
    setStep(steps[stepIndex - 1].id);
  }
  function advance(form: HTMLFormElement) {
    setError("");
    const controls = form.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >(`[data-step="${step}"] input, [data-step="${step}"] textarea`);
    for (const control of controls) {
      if (!control.reportValidity()) return;
    }
    const data = new FormData(form);
    try {
      if (
        step === "category" &&
        !categories.some(
          (c) => c.kind === kind && String(c.id) === data.get("category_id"),
        )
      )
        throw new Error("Choose a category to continue.");
      if (step === "accounts") {
        if (!sources.some((a) => String(a.id) === source))
          throw new Error("Choose an available account to continue.");
      }
      if (step === "destination" && !destination)
        throw new Error("Choose a destination account to continue.");
      if (step === "amount") {
        validateTransactionAmount(
          String(data.get("amount") || ""),
          account?.currency === "BITCOIN" ? "BITCOIN" : "USD",
        );
        if (crossCurrency)
          validateTransactionAmount(
            received,
            destination.currency === "BITCOIN" ? receivedUnit : "USD",
          );
      }
      if (step === "details" && !String(data.get("description") || "").trim())
        throw new Error("Enter a description to continue.");
      const next = steps[stepIndex + 1];
      if (next.id === "review") setReviewData(data);
      setStep(next.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const reviewValue = (name: string) => String(reviewData?.get(name) || "");
  const typeLabels: Record<string, string> = {
    expense: "Expense",
    income: "Income",
    bitcoin: "Bitcoin buy",
    savings: "Move to savings",
    investing: "Fund investment account",
    transfer: "Transfer",
  };
  const reviewRows: [string, string][] = [
    ["Transaction type", typeLabels[mode]],
  ];
  if (kind === "expense") {
    reviewRows.push([
      "Payment",
      state.recurring || state.bill ? "Upcoming" : "Paid",
    ]);
  }
  if (kind !== "transfer") {
    reviewRows.push([
      "Category",
      categories.find((c) => String(c.id) === reviewValue("category_id"))
        ?.name || "",
    ]);
  }
  reviewRows.push([
    kind === "transfer" ? "From account" : "Account",
    account ? `${account.name} · ${currency}` : "",
  ]);
  if (kind === "transfer") {
    reviewRows.push([
      "To account",
      destination
        ? `${destination.name} · ${destination.currency === "BITCOIN" ? "bitcoin" : "USD"}`
        : "",
    ]);
  }
  reviewRows.push(["Amount", `${reviewValue("amount")} ${currency}`]);
  if (crossCurrency) {
    reviewRows.push([
      "Received amount",
      `${received} ${destination.currency === "BITCOIN" ? (receivedUnit === "BTC" ? "BTC" : "bitcoin") : "USD"}`,
    ]);
  }
  reviewRows.push([
    state.recurring || state.bill ? "Next due date" : "Date",
    reviewValue("date"),
  ]);
  if (kind === "expense" && !state.transaction) {
    reviewRows.push([
      "Repeats",
      saveRecurring
        ? repeatOptions.find(
            (option) => option.value === reviewValue("frequency"),
          )?.label || "Once"
        : "Once",
    ]);
  }
  if (mode !== "bitcoin") {
    reviewRows.push(
      ["Description", reviewValue("description")],
      ["Notes", reviewValue("notes") || "None"],
    );
  }
  const displayReviewRows: [string, string][] =
    mode === "bitcoin"
      ? [
          ["Dollars", formatMoney(reviewValue("amount").trim(), "USD")],
          ["Bitcoin", formatMoney(received.trim(), "BITCOIN")],
          [
            "Bitcoin per dollar",
            formatBitcoinPerDollar(
              received.trim(),
              reviewValue("amount").trim(),
            ),
          ],
          ["From", account?.name || ""],
          ["To", destination?.name || ""],
          ["Date", reviewValue("date")],
        ]
      : kind === "expense"
        ? [
            [
              "Amount",
              formatMoney(
                reviewValue("amount").trim(),
                account?.currency === "BITCOIN" ? "BITCOIN" : "USD",
              ),
            ],
            [
              "Category",
              categories.find(
                (c) => String(c.id) === reviewValue("category_id"),
              )?.name || "",
            ],
            ["Account", account?.name || ""],
            [
              state.recurring || state.bill ? "Next due date" : "Date",
              reviewValue("date"),
            ],
            ["Payment", state.recurring || state.bill ? "Upcoming" : "Paid"],
            [
              "Repeats",
              saveRecurring
                ? repeatOptions.find(
                    (option) => option.value === reviewValue("frequency"),
                  )?.label || "Once"
                : "Once",
            ],
          ]
        : reviewRows;

  function changeMode(next: string) {
    setMode(next);
    if (!account || !isTransactionSource(account, next)) {
      setSource(
        String(
          accounts.find(
            (a) => isTransactionSource(a, next) && a.kind === "checking",
          )?.id ||
            accounts.find((a) => isTransactionSource(a, next))?.id ||
            "",
        ),
      );
    }
    setDestinationId("");
    setReceived("");
    setReceivedUnit("BITCOIN");
  }
  const available = accounts.filter((a) => !a.archived);
  const accountOptions = available.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name} · {a.currency === "BITCOIN" ? "bitcoin" : a.currency}
    </option>
  ));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (isTransaction && step !== "review") {
      advance(event.currentTarget);
      return;
    }
    if (isTransaction && !reviewData) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const data = isTransaction
      ? reviewData!
      : new FormData(event.currentTarget);
    const v = (key: string) => String(data.get(key) || "");
    try {
      let message = "Saved to your ledger.";
      if (state.type === "account")
        await api("/accounts", "POST", {
          name: v("name"),
          kind: v("kind"),
          currency: v("currency"),
          opening_balance: v("opening_balance"),
          date: v("date"),
        });
      if (state.type === "editAccount")
        await api(`/accounts/${state.account!.id}`, "PATCH", {
          name: v("name"),
          archived: v("archived") === "on",
          ...(state.account!.kind === "checking" &&
          state.account!.currency === "USD" &&
          state.account!.role === "asset"
            ? { exclude_from_liquid_usd: v("exclude_from_liquid_usd") === "on" }
            : {}),
          ...(state.account!.role === "liability" &&
          state.account!.kind !== "mortgage"
            ? {
                exclude_from_consumer_debt:
                  v("exclude_from_consumer_debt") === "on",
              }
            : {}),
        });
      if (state.type === "transaction") {
        if (kind === "transfer" && !destination)
          throw new Error("Select a destination account.");
        const payload = {
          date: v("date"),
          kind,
          account_id: Number(source),
          amount: v("amount"),
          description: v("description"),
          notes: v("notes"),
          category_id: kind === "transfer" ? null : Number(v("category_id")),
          destination_id: kind === "transfer" ? Number(destinationId) : null,
          destination_amount:
            kind === "transfer" && crossCurrency
              ? destination?.currency === "BITCOIN"
                ? bitcoinInput(received, receivedUnit)
                : received
              : null,
        };
        if (saveRecurring && kind === "expense" && !state.transaction) {
          await api(
            state.bill
              ? `/recurring-bills/${state.bill.id}`
              : "/recurring-bills",
            state.bill ? "PUT" : "POST",
            {
              transaction: payload,
              frequency: v("frequency"),
              record_now: !state.recurring && !state.bill,
            },
          );
          message = state.bill
            ? "Recurring bill updated."
            : state.recurring
              ? "Recurring bill saved. Record it when paid."
              : "Expense recorded and recurring bill saved.";
          if (v("frequency") === "once") message = "Planned expense saved.";
        } else {
          await api(
            state.transaction
              ? `/transactions/${state.transaction.id}`
              : "/transactions",
            state.transaction ? "PUT" : "POST",
            payload,
          );
        }
      }
      if (state.type === "deleteTransaction") {
        await api(`/transactions/${state.transaction!.id}`, "DELETE");
        message =
          "Transaction reversed. The original entry remains in the audit trail.";
      }
      if (state.type === "budget")
        await api("/budgets", "POST", {
          month: v("month"),
          category_id: Number(v("category_id")),
          amount: v("amount"),
          currency: "USD",
          scope: "all",
        });
      if (state.type === "category")
        await api("/categories", "POST", { name: v("name"), kind: v("kind") });
      if (state.type === "rate") {
        await api("/rates", "POST", {
          day: v("day"),
          usd_per_btc: v("usd_per_btc"),
        });
        message =
          "Rate recorded. Missing purchase-date conversions are filled automatically; existing saved costs remain unchanged.";
      }
      if (state.type === "adjustment")
        await api(`/accounts/${state.account!.id}/adjustments`, "POST", {
          date: v("date"),
          amount: v("amount"),
          description: v("description"),
        });
      if (state.type === "valuation")
        await api(
          state.asset
            ? `/assets/${state.asset.id}/valuations`
            : `/accounts/${state.account!.id}/valuations`,
          "POST",
          {
            date: v("date"),
            value: v("value"),
          },
        );
      if (state.type === "import") {
        const result = await api<{ imported: number; duplicates: number }>(
          "/import/csv",
          "POST",
          data,
        );
        message = `Imported ${result.imported} transactions; skipped ${result.duplicates} duplicates.`;
      }
      onSaved(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className={`entry-dialog${isTransaction ? " transaction-dialog" : ""}`}
      onCancel={(e) => {
        e.stopPropagation();
        if (busy) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <form onSubmit={submit} noValidate={isTransaction}>
        <div className="dialog-heading">
          <div>
            <h2 id="dialog-title">
              {state.type === "account" && state.accountKind === "real_estate"
                ? "Add an asset"
                : state.type === "account" && state.accountKind === "loan"
                  ? "Add a debt"
                  : newExpense
                    ? "Add expense"
                    : state.bill
                      ? state.bill.frequency === "once"
                        ? "Edit planned expense"
                        : "Edit recurring bill"
                      : state.recurring
                        ? state.oneTime
                          ? "Plan an expense"
                          : "Add recurring bill"
                        : state.repeat
                          ? "Repeat expense"
                          : state.transaction && state.type === "transaction"
                            ? "Edit transaction"
                            : state.type === "transaction" && mode === "bitcoin"
                              ? "Bitcoin buy"
                              : state.type === "transaction" &&
                                  mode === "savings"
                                ? "Move money to savings"
                                : state.type === "transaction" &&
                                    mode === "investing"
                                  ? "Add investment funds"
                                  : state.type === "transaction" &&
                                      state.kind === "income"
                                    ? "Record income"
                                    : state.type === "transaction" &&
                                        mode === "expense" &&
                                        step !== "type"
                                      ? "Record expense"
                                      : titles[state.type]}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </Button>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid">
          {state.type === "account" && (
            <>
              <Field label="Account name">
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Everyday checking"
                  autoFocus
                />
              </Field>
              <Field label="Account type">
                <select
                  name="kind"
                  value={accountKind}
                  onChange={(e) => {
                    setAccountKind(e.target.value);
                    if (e.target.value === "bitcoin_wallet")
                      setAccountCurrency("BITCOIN");
                  }}
                >
                  {[
                    "bitcoin_wallet",
                    "checking",
                    "savings",
                    "cash",
                    "brokerage",
                    "credit_card",
                    "loan",
                    "mortgage",
                    "real_estate",
                    "vehicle",
                    "stock",
                    "etf",
                    "other_asset",
                    "other_liability",
                  ]
                    .filter((kind) =>
                      state.accountKind === "real_estate"
                        ? ["real_estate", "vehicle", "other_asset"].includes(
                            kind,
                          )
                        : state.accountKind === "loan"
                          ? ["loan", "mortgage", "other_liability"].includes(
                              kind,
                            )
                          : [
                              "bitcoin_wallet",
                              "checking",
                              "savings",
                              "cash",
                              "brokerage",
                              "credit_card",
                              "stock",
                              "etf",
                            ].includes(kind),
                    )
                    .map((k) => (
                      <option key={k} value={k}>
                        {k.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Original currency">
                <select
                  name="currency"
                  value={accountCurrency}
                  onChange={(e) => setAccountCurrency(e.target.value)}
                >
                  <option
                    value="USD"
                    disabled={accountKind === "bitcoin_wallet"}
                  >
                    US dollars · USD
                  </option>
                  <option value="BITCOIN">bitcoin · native units</option>
                </select>
              </Field>
              <Field
                label="Opening balance"
                hint="Use a positive amount for debt owed."
              >
                <input
                  name="opening_balance"
                  defaultValue="0"
                  inputMode="decimal"
                  required
                />
              </Field>
              <Field label="Opening date">
                <input
                  name="date"
                  type="date"
                  defaultValue={today()}
                  required
                  max={today()}
                />
              </Field>
            </>
          )}
          {state.type === "editAccount" && (
            <>
              <Field label="Account name">
                <input
                  name="name"
                  defaultValue={state.account!.name}
                  required
                />
              </Field>
              {state.account!.kind === "checking" &&
                state.account!.currency === "USD" &&
                state.account!.role === "asset" && (
                  <div className="full-width">
                    <label className="check">
                      <input
                        name="exclude_from_liquid_usd"
                        type="checkbox"
                        role="switch"
                        defaultChecked={
                          state.account!.exclude_from_liquid_usd ?? false
                        }
                      />
                      Exclude from Everyday Cash
                    </label>
                    <p className="hint">
                      Reserve this account for an emergency fund or other
                      set-aside money. Its balance still counts toward USD cash
                      and net worth.
                    </p>
                  </div>
                )}
              {state.account!.role === "liability" &&
                state.account!.kind !== "mortgage" && (
                  <div className="full-width">
                    <label className="check">
                      <input
                        name="exclude_from_consumer_debt"
                        type="checkbox"
                        role="switch"
                        defaultChecked={
                          state.account!.exclude_from_consumer_debt ?? false
                        }
                      />
                      Exclude from consumer debt
                    </label>
                    <p className="hint">
                      Only affects the consumer debt gauge. This account still
                      counts toward total debt and net worth.
                    </p>
                  </div>
                )}
              {state.account!.kind === "mortgage" && (
                <p className="hint">
                  Mortgages are automatically excluded from consumer debt.
                </p>
              )}
              <div className="full-width">
                <label className="check">
                  <input
                    name="archived"
                    type="checkbox"
                    aria-describedby="archive-account-help"
                    defaultChecked={state.account!.archived}
                  />
                  Archive account
                </label>
                <p className="hint" id="archive-account-help">
                  Use this for an account you no longer use. It is hidden from
                  account cards unless Show archived is selected, and removed
                  from new payment and transfer choices. Its balance and history
                  stay in reports, total debt, and net worth. Bills using this
                  account cannot be recorded until you reactivate it or choose
                  another account. Uncheck this option and save to reactivate.
                </p>
                {state.account!.role === "liability" &&
                  state.account!.kind !== "mortgage" && (
                    <p className="hint">
                      Archiving does not exclude this account from consumer
                      debt. Use the separate exclusion switch above for that.
                    </p>
                  )}
              </div>
              <p className="hint">
                The currency and accounting role are fixed once an account is
                created.
              </p>
            </>
          )}
          {state.type === "transaction" && (
            <>
              <div className="transaction-progress full-width">
                <p>
                  Step {stepIndex + 1} of {steps.length}
                </p>
                <h3 ref={stepHeading} tabIndex={-1}>
                  {steps[stepIndex].label}
                </h3>
                <progress
                  aria-label="Transaction progress"
                  value={stepIndex + 1}
                  max={steps.length}
                />
              </div>
              <div
                className="transaction-step full-width"
                data-step="type"
                hidden={step !== "type"}
              >
                {!newExpense && !state.recurring && !state.bill && (
                  <ChoiceField
                    label="Transaction type"
                    value={mode}
                    onChange={changeMode}
                    onSelect={(next) =>
                      chooseAndAdvance(
                        ["expense", "income"].includes(next)
                          ? "category"
                          : "accounts",
                      )
                    }
                    options={[
                      { value: "expense", label: "Expense" },
                      { value: "income", label: "Income" },
                      { value: "bitcoin", label: "Bitcoin buy" },
                      { value: "savings", label: "Move to savings" },
                      { value: "investing", label: "Fund investment account" },
                      { value: "transfer", label: "Transfer" },
                    ]}
                  />
                )}
              </div>
              <div
                className="transaction-step full-width"
                data-step="payment"
                hidden={step !== "payment"}
              >
                {newExpense && (
                  <>
                    <ChoiceField
                      label="Payment"
                      onSelect={() => chooseAndAdvance("category")}
                      value={paymentTiming}
                      hint={
                        paymentTiming === "upcoming"
                          ? "Record payment when paid."
                          : undefined
                      }
                      onChange={(next) => {
                        setPaymentTiming(next);
                        if (next === "paid" && entryDate > today())
                          setEntryDate(today());
                      }}
                      options={[
                        { value: "paid", label: "Paid" },
                        { value: "upcoming", label: "Upcoming" },
                      ]}
                    />
                  </>
                )}
              </div>
              <div
                className="transaction-step full-width"
                data-step="category"
                hidden={step !== "category"}
              >
                {kind !== "transfer" && (
                  <ChoiceField
                    label="Category"
                    onSelect={() => chooseAndAdvance("accounts")}
                    name="category_id"
                    required
                    key={kind}
                    defaultValue={
                      preset?.category_id || state.category_id || ""
                    }
                    onChange={(next) => {
                      const suggested = suggestedAccount(next);
                      if (suggested) setSource(String(suggested.id));
                    }}
                    options={categories
                      .filter((c) => c.kind === kind)
                      .map((c) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                  />
                )}
              </div>
              <div
                className="transaction-step full-width"
                data-step="accounts"
                hidden={step !== "accounts"}
              >
                <ChoiceField
                  label={kind === "transfer" ? "From account" : "Account"}
                  value={source}
                  onSelect={() =>
                    chooseAndAdvance(
                      kind === "transfer" ? "destination" : "amount",
                    )
                  }
                  onChange={(next) => {
                    setSource(next);
                    setDestinationId("");
                    setReceived("");
                  }}
                  required
                  options={sources.map((a) => ({
                    value: a.id,
                    label: `${a.name} · ${a.currency === "BITCOIN" ? "bitcoin" : "USD"}`,
                  }))}
                />
                {!sources.length && (
                  <p className="alert" role="status">
                    {mode === "bitcoin"
                      ? "Add an active USD checking account in Accounts before recording a Bitcoin buy."
                      : "Add an eligible active account in Accounts before continuing."}
                  </p>
                )}
              </div>
              <div
                className="transaction-step full-width"
                data-step="destination"
                hidden={step !== "destination"}
              >
                {kind === "transfer" && (
                  <>
                    <ChoiceField
                      label={
                        mode === "bitcoin" ? "Bitcoin wallet" : "To account"
                      }
                      onSelect={() => chooseAndAdvance("amount")}
                      name="destination_id"
                      required
                      value={destination ? destinationId : ""}
                      onChange={(next) => {
                        setDestinationId(next);
                        setReceived("");
                      }}
                      options={destinations.map((a) => ({
                        value: a.id,
                        label: `${a.name} · ${a.currency === "BITCOIN" ? "bitcoin" : a.currency}`,
                      }))}
                    />
                    {!destinations.length && (
                      <p className="alert full-width" role="status">
                        Create{" "}
                        {mode === "bitcoin"
                          ? "a bitcoin wallet"
                          : mode === "savings"
                            ? "a savings account"
                            : mode === "investing"
                              ? "a brokerage, stock or ETF account"
                              : "another account"}{" "}
                        in Accounts first, then record this transfer.
                      </p>
                    )}
                  </>
                )}
              </div>
              <div
                className={`transaction-step full-width${mode === "bitcoin" ? " bitcoin-buy-amounts" : ""}`}
                data-step="amount"
                hidden={step !== "amount"}
              >
                <Field
                  label={
                    mode === "bitcoin" ? "Dollars" : `Amount · ${currency}`
                  }
                  hint={
                    mode === "bitcoin"
                      ? "Actual dollars exchanged. Record fees separately."
                      : newExpense
                        ? currency === "bitcoin"
                          ? "Whole bitcoin units."
                          : undefined
                        : "Enter the original amount. Bitcoin must be a whole number."
                  }
                >
                  <input
                    name="amount"
                    defaultValue={preset?.amount}
                    inputMode="decimal"
                    required
                  />
                </Field>
                {kind === "transfer" && (
                  <>
                    {crossCurrency && (
                      <>
                        {destination.currency === "BITCOIN" &&
                          mode !== "bitcoin" && (
                            <ChoiceField
                              label="Bitcoin entry unit"
                              value={receivedUnit}
                              onChange={(value) => {
                                const next = value as "BTC" | "BITCOIN";
                                try {
                                  if (received) {
                                    const native = bitcoinInput(
                                      received,
                                      receivedUnit,
                                    );
                                    setReceived(
                                      next === "BTC"
                                        ? bitcoinAsBtc(native)
                                        : native,
                                    );
                                  }
                                } catch (error) {
                                  setError((error as Error).message);
                                  return;
                                }
                                setReceivedUnit(next);
                                setError("");
                              }}
                              options={[
                                { value: "BITCOIN", label: "bitcoin · ₿" },
                                { value: "BTC", label: "Legacy BTC · decimal" },
                              ]}
                            />
                          )}
                        <Field
                          label={
                            mode === "bitcoin"
                              ? "Bitcoin"
                              : `Received amount · ${destination.currency === "BITCOIN" ? (receivedUnit === "BTC" ? "legacy BTC" : "bitcoin") : "USD"}`
                          }
                          hint={
                            mode === "bitcoin"
                              ? "Whole bitcoin units."
                              : "Enter the amount actually received, not an estimated conversion."
                          }
                        >
                          <input
                            name="destination_amount"
                            maxLength={50}
                            inputMode="decimal"
                            value={received}
                            onChange={(e) => setReceived(e.target.value)}
                            required
                            placeholder={
                              receivedUnit === "BTC" &&
                              destination.currency === "BITCOIN"
                                ? "0.00125000"
                                : ""
                            }
                          />
                        </Field>
                      </>
                    )}
                  </>
                )}
              </div>
              <div
                className="transaction-step full-width"
                data-step="schedule"
                hidden={step !== "schedule"}
              >
                <div className="transaction-date full-width">
                  <ChoiceField
                    label="Quick date"
                    value={
                      entryDate === today()
                        ? "today"
                        : entryDate === today(-1)
                          ? "yesterday"
                          : ""
                    }
                    onChange={(value) =>
                      setEntryDate(today(value === "yesterday" ? -1 : 0))
                    }
                    options={[
                      { value: "today", label: "Today" },
                      { value: "yesterday", label: "Yesterday" },
                    ]}
                  />
                  <Field
                    label={
                      state.recurring || state.bill ? "Next due date" : "Date"
                    }
                  >
                    <input
                      name="date"
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      required
                      max={state.recurring || state.bill ? undefined : today()}
                    />
                  </Field>
                </div>
                {newExpense && (
                  <>
                    <ChoiceField
                      label="Repeats"
                      name="frequency"
                      value={frequency}
                      onChange={setFrequency}
                      options={repeatOptions}
                    />
                  </>
                )}
                {kind === "expense" && !state.transaction && !newExpense && (
                  <div className="full-width recurring-options">
                    {!state.recurring && !state.bill && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={saveRecurring}
                          onChange={(event) =>
                            setSaveRecurring(event.target.checked)
                          }
                        />
                        Save as a recurring bill
                      </label>
                    )}
                    {saveRecurring && (
                      <>
                        <ChoiceField
                          label="Repeats"
                          name="frequency"
                          defaultValue={
                            state.bill?.frequency ||
                            (state.oneTime ? "once" : "monthly")
                          }
                          options={
                            state.recurring || state.bill
                              ? repeatOptions.map((option) =>
                                  option.value === "once"
                                    ? {
                                        ...option,
                                        label: "Once · planned expense",
                                      }
                                    : option,
                                )
                              : repeatOptions.filter(
                                  (option) => option.value !== "once",
                                )
                          }
                        />
                        <p className="hint">
                          {state.recurring || state.bill
                            ? "This is planned spending. Confirm payment when paid to include it in your budget's actual spending."
                            : "This records the expense now and saves the next bill. Confirm future payments from Expenses."}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
              {mode === "bitcoin" ? (
                <>
                  <input type="hidden" name="description" value="Bitcoin buy" />
                  <input
                    type="hidden"
                    name="notes"
                    value={preset?.notes || ""}
                  />
                </>
              ) : (
                <div
                  className="transaction-step full-width"
                  data-step="details"
                  hidden={step !== "details"}
                >
                  <Field label="Description">
                    <input
                      name="description"
                      defaultValue={
                        preset?.description ||
                        (state.intent === "savings"
                          ? "Savings contribution"
                          : state.intent === "investing"
                            ? "Investment contribution"
                            : "")
                      }
                      placeholder="What was this for?"
                      required
                      maxLength={500}
                    />
                  </Field>
                  <div className="full-width">
                    <Field label="Notes · optional">
                      <textarea
                        name="notes"
                        defaultValue={preset?.notes}
                        maxLength={4000}
                        rows={2}
                      />
                    </Field>
                  </div>
                </div>
              )}
              {step === "review" && reviewData && (
                <section
                  className={`transaction-review full-width${mode === "bitcoin" || kind === "expense" ? " transaction-review-compact" : ""}`}
                  aria-label="Transaction review"
                >
                  {mode !== "bitcoin" && kind !== "expense" && (
                    <p>Check the details below before confirming.</p>
                  )}
                  <dl>
                    {displayReviewRows.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {kind === "expense" && (
                    <div className="transaction-review-description">
                      <strong>{reviewValue("description")}</strong>
                      {reviewValue("notes") && <p>{reviewValue("notes")}</p>}
                    </div>
                  )}
                  <p className="hint">
                    {state.recurring || state.bill
                      ? "This saves planned spending. It will be recorded as an expense when you confirm payment."
                      : saveRecurring &&
                          kind === "expense" &&
                          !state.transaction
                        ? "This records the expense and saves the next recurring bill."
                        : state.transaction
                          ? "Confirm to save these changes to your ledger."
                          : "Confirm to record this transaction in your ledger."}
                  </p>
                  {mode !== "bitcoin" &&
                    kind !== "expense" &&
                    !newExpense &&
                    !state.recurring &&
                    !state.bill && (
                      <p className="hint full-width">
                        Fiat purchasing power uses a saved rate for the
                        transaction date. Without one, the original amount is
                        recorded and its cross-currency equivalent stays
                        unavailable.
                      </p>
                    )}
                </section>
              )}
            </>
          )}
          {state.type === "deleteTransaction" && (
            <p className="full-width">
              Reverse “{state.transaction!.description}”? This removes it from
              active reports and offsets its postings with a permanent reversal
              entry.
            </p>
          )}
          {state.type === "budget" && (
            <>
              <Field label="Month">
                <input
                  type="month"
                  name="month"
                  defaultValue={month}
                  required
                />
              </Field>
              <Field label="Spending category">
                <select
                  name="category_id"
                  required
                  defaultValue={state.budget?.category_id}
                >
                  {categories
                    .filter((c) => c.kind === "expense")
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="USD budget">
                <input
                  name="amount"
                  defaultValue={state.budget?.planned_usd ?? ""}
                  inputMode="decimal"
                  required
                  placeholder="180.00"
                />
              </Field>
            </>
          )}
          {state.type === "category" && (
            <>
              <Field label="Category name">
                <input name="name" maxLength={100} required autoFocus />
              </Field>
              <Field label="Type">
                <select name="kind" defaultValue={state.kind || "expense"}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </Field>
            </>
          )}
          {state.type === "rate" && (
            <>
              <Field label="Effective date">
                <input
                  name="day"
                  type="date"
                  defaultValue={today()}
                  required
                  max={today()}
                />
              </Field>
              <Field label="USD per ₿100,000,000">
                <input
                  name="usd_per_btc"
                  inputMode="decimal"
                  required
                  placeholder="120000"
                />
              </Field>
              <p className="hint full-width">
                Manual prices are labeled and timestamped. Historical reporting
                uses the exact date; existing transaction snapshots are
                immutable.
              </p>
            </>
          )}
          {state.type === "import" && (
            <>
              <Field label="Destination ledger account">
                <select name="account_id" required>
                  {accountOptions}
                </select>
              </Field>
              <Field label="CSV file">
                <input
                  type="file"
                  name="file"
                  accept=".csv,text/csv"
                  required
                />
              </Field>
              <p className="hint full-width">
                UTF-8 CSV headers:{" "}
                <code>date,kind,amount,description,category</code>. Dates use
                YYYY-MM-DD; kind is income or expense. Amounts use the account’s
                original currency. Optional: external_id,notes. Categories must
                already exist.
              </p>
              <p className="hint full-width">
                Stable external IDs give the strongest duplicate protection.
                Without IDs, matching rows and their occurrence counts are
                deduplicated. All rows are validated before the import commits.
              </p>
            </>
          )}
          {state.type === "valuation" && (
            <>
              <Field label="Valuation date">
                <input
                  name="date"
                  type="date"
                  defaultValue={today()}
                  required
                  max={today()}
                />
              </Field>
              <Field
                label={`Total value · ${(state.asset?.account.currency || state.account?.currency) === "BITCOIN" ? "bitcoin" : "USD"}`}
                hint="Enter the total value, not the change in value."
              >
                <input name="value" inputMode="decimal" required />
              </Field>
              <p className="hint full-width">
                New valuations must follow the last recorded valuation date.
                Appreciation and depreciation are posted to equity.
              </p>
            </>
          )}
          {state.type === "adjustment" && (
            <>
              <Field label="Adjustment date">
                <input
                  name="date"
                  type="date"
                  defaultValue={today()}
                  required
                  max={today()}
                />
              </Field>
              <Field
                label={`Change in balance · ${state.account!.currency === "BITCOIN" ? "bitcoin" : "USD"}`}
                hint="Positive increases the displayed balance or debt; negative reduces it."
              >
                <input name="amount" inputMode="decimal" required />
              </Field>
              <Field label="Reason">
                <input
                  name="description"
                  minLength={3}
                  maxLength={500}
                  required
                />
              </Field>
              <p className="hint full-width">
                This creates an auditable equity adjustment. It is excluded from
                income and expenses, and included in net additions on investment
                reports. For appreciation or depreciation, use Update value on
                Assets & liabilities.
              </p>
            </>
          )}
        </div>
        <div className="dialog-footer">
          <Button
            variant="outline"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          {isTransaction && stepIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={busy}
            >
              Back
            </Button>
          )}
          <Button
            variant={
              state.type === "deleteTransaction" ? "destructive" : "default"
            }
            disabled={busy}
            type="submit"
          >
            {busy
              ? "Saving…"
              : isTransaction
                ? step === "review"
                  ? state.recurring || state.bill
                    ? "Confirm and save plan"
                    : state.transaction
                      ? "Confirm changes"
                      : "Confirm and record"
                  : steps[stepIndex + 1]?.id === "review"
                    ? "Review transaction"
                    : "Continue"
                : state.type === "import"
                  ? "Import CSV"
                  : state.type === "deleteTransaction"
                    ? "Reverse transaction"
                    : "Save to ledger"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
