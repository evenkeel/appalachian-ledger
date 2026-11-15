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
import { bitcoinInput, bitcoinAsBtc } from "../lib/bitcoinInput";
import { formatMoney } from "../lib/money";
import {
  matchRule,
  payeeMemory,
  suggestPayees,
  upsertRule,
  type PayeeSuggestion,
} from "../lib/payees";
import type {
  Account,
  Asset,
  BudgetOverview,
  Category,
  PayeeRule,
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
  history = [],
  payeeRules = [],
  month,
  onClose,
  onSaved,
  onSavedAnother,
}: {
  state: DialogState;
  accounts: Account[];
  categories: Category[];
  paymentDefaults?: Record<string, number>;
  /** Past transactions; the form learns each payee's usual details from them. */
  history?: Transaction[];
  payeeRules?: PayeeRule[];
  month: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Saves without closing, so several entries can be recorded in a row. */
  onSavedAnother?: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const another = useRef(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const [savedCount, setSavedCount] = useState(0);
  const isTransaction = initialState.type === "transaction";
  const preset: Partial<Transaction> | undefined =
    initialState.transaction ||
    initialState.repeat ||
    (initialState.bill
      ? {
          ...initialState.bill,
          date: initialState.bill.next_due,
          kind: "expense",
        }
      : undefined);
  /** Opened without a fixed purpose, so the form offers every transaction type. */
  const typeChoice =
    isTransaction &&
    !initialState.kind &&
    !initialState.intent &&
    !preset &&
    !initialState.recurring;
  const [mode, setMode] = useState(
    initialState.intent || preset?.kind || initialState.kind || "expense",
  );
  const kind = ["bitcoin", "savings", "investing"].includes(mode)
    ? "transfer"
    : mode;
  const newExpense =
    isTransaction &&
    mode === "expense" &&
    !initialState.transaction &&
    !initialState.bill;
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
  const saveRecurring = newExpense
    ? paymentTiming === "upcoming" || frequency !== "once"
    : Boolean(initialState.bill);
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
  const [description, setDescription] = useState(
    preset?.description ||
      (initialState.intent === "savings"
        ? "Savings contribution"
        : initialState.intent === "investing"
          ? "Investment contribution"
          : ""),
  );
  const [categoryId, setCategoryId] = useState(
    String(preset?.category_id || initialState.category_id || ""),
  );
  // Once a category is picked by hand, typing a description never overrides it.
  const categoryPicked = useRef(Boolean(categoryId));
  const [remember, setRemember] = useState(false);
  const kindCategories = categories.filter((c) => c.kind === kind);
  const kindCategoryIds = new Set(kindCategories.map((c) => c.id));
  const learning =
    isTransaction && kind !== "transfer" && !initialState.transaction;
  const memory = learning ? payeeMemory(history, kind) : [];
  const payees = suggestPayees(memory, description, 5);
  const chosenCategory = kindCategories.find(
    (c) => String(c.id) === categoryId,
  );
  const activeRule = matchRule(payeeRules, description, kindCategoryIds);
  const ruleAlreadySaved =
    activeRule !== undefined &&
    activeRule.match.trim().toLowerCase() ===
      description.trim().toLowerCase() &&
    String(activeRule.category_id) === categoryId;
  function pickAccount(id: number | null | undefined) {
    if (id != null && sources.some((a) => a.id === id)) setSource(String(id));
  }
  function describe(next: string) {
    setDescription(next);
    if (!learning || categoryPicked.current) return;
    // A saved rule wins; otherwise an exact match with a past payee fills the rest.
    const rule = matchRule(payeeRules, next, kindCategoryIds);
    const known = memory.find(
      (payee) => payee.description.toLowerCase() === next.trim().toLowerCase(),
    );
    const category = rule?.category_id ?? known?.category_id;
    if (category != null && kindCategoryIds.has(category)) {
      setCategoryId(String(category));
      pickAccount(
        rule?.account_id ?? known?.account_id ?? suggestedAccount(category)?.id,
      );
    }
  }
  function applyPayee(payee: PayeeSuggestion) {
    setDescription(payee.description);
    const rule = matchRule(payeeRules, payee.description, kindCategoryIds);
    const category = rule?.category_id ?? payee.category_id;
    if (category != null && kindCategoryIds.has(category)) {
      setCategoryId(String(category));
      categoryPicked.current = true;
    }
    pickAccount(rule?.account_id ?? payee.account_id);
    // The last amount is a starting point only when nothing has been typed yet.
    if (amountInput.current && !amountInput.current.value.trim()) {
      amountInput.current.value = payee.amount;
      amountInput.current.select();
    }
    amountInput.current?.focus();
  }
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
  useModalDialog(ref);
  // showModal() focuses the first control; a new entry should start at the amount.
  useEffect(() => {
    amountInput.current?.focus();
  }, []);
  const amountUnit = account?.currency === "BITCOIN" ? "BITCOIN" : "USD";
  const defaultDescription =
    kind === "transfer"
      ? destination
        ? `Transfer to ${destination.name}`
        : "Transfer"
      : "";
  /** Every field is on one screen, so everything is checked together on save. */
  function validateTransaction(data: FormData) {
    if (
      kind !== "transfer" &&
      !categories.some(
        (c) => c.kind === kind && String(c.id) === data.get("category_id"),
      )
    )
      throw new Error("Choose a category.");
    if (!sources.some((a) => String(a.id) === source))
      throw new Error(
        kind === "transfer"
          ? "Choose the account the money comes from."
          : "Choose an account.",
      );
    if (kind === "transfer" && !destination)
      throw new Error("Choose a destination account.");
    validateTransactionAmount(String(data.get("amount") || ""), amountUnit);
    if (crossCurrency)
      validateTransactionAmount(
        received,
        destination.currency === "BITCOIN" ? receivedUnit : "USD",
      );
    const date = String(data.get("date") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a date.");
    if (!state.recurring && !state.bill && date > today())
      throw new Error(
        "A recorded transaction cannot be dated in the future. Choose Upcoming for planned expenses.",
      );
  }
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
    setCategoryId("");
    categoryPicked.current = false;
    setRemember(false);
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
    const form = event.currentTarget;
    const data = new FormData(form);
    const keepOpen = another.current;
    another.current = false;
    if (isTransaction) {
      try {
        validateTransaction(data);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    lock.current = true;
    setBusy(true);
    setError("");
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
          description:
            v("description").trim() ||
            defaultDescription ||
            categories.find((c) => String(c.id) === v("category_id"))?.name ||
            "",
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
      if (state.type === "transaction" && remember && chosenCategory) {
        // The entry is already saved; a rule that fails to save must not undo it.
        try {
          await api("/settings/payee-rules", "PUT", {
            payee_rules: upsertRule(
              payeeRules,
              {
                match: description.trim().slice(0, 80),
                category_id: chosenCategory.id,
                account_id: kind === "expense" ? Number(source) : null,
              },
              kindCategoryIds,
            ),
          });
          message += ` “${description.trim()}” will be filed under ${chosenCategory.name} from now on.`;
        } catch (e) {
          message += ` The rule could not be saved: ${(e as Error).message}`;
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
      if (keepOpen && onSavedAnother) {
        // Keep the type, category, account and date; clear what changes per entry.
        setDescription("");
        setRemember(false);
        categoryPicked.current = Boolean(categoryId);
        for (const name of ["amount", "notes"]) {
          const field = form.elements.namedItem(name);
          if (
            field instanceof HTMLInputElement ||
            field instanceof HTMLTextAreaElement
          )
            if (field.type !== "hidden") field.value = "";
        }
        setReceived("");
        setSavedCount((count) => count + 1);
        onSavedAnother(message);
        amountInput.current?.focus();
      } else onSaved(message);
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
                  : typeChoice
                    ? "Add transaction"
                    : state.repeat
                      ? "Repeat expense"
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
                              : state.transaction &&
                                  state.type === "transaction"
                                ? "Edit transaction"
                                : state.type === "transaction" &&
                                    mode === "bitcoin"
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
              {savedCount > 0 && !error && (
                <p className="entry-saved full-width" role="status">
                  Saved {savedCount} {savedCount === 1 ? "entry" : "entries"}.
                  Ready for the next one.
                </p>
              )}
              {typeChoice && (
                <ChoiceField
                  label="Transaction type"
                  value={mode}
                  onChange={changeMode}
                  options={[
                    { value: "expense", label: "Expense" },
                    { value: "income", label: "Income" },
                    { value: "transfer", label: "Transfer" },
                    { value: "bitcoin", label: "Bitcoin buy" },
                    { value: "savings", label: "Move to savings" },
                    { value: "investing", label: "Fund investment account" },
                  ]}
                />
              )}
              {newExpense && (
                <ChoiceField
                  label="Payment"
                  value={paymentTiming}
                  hint={
                    paymentTiming === "upcoming"
                      ? "Saved as planned spending. Confirm it from Expenses when it is paid."
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
              )}
              <div
                className={`entry-amounts full-width${kind === "transfer" && crossCurrency ? " entry-amounts-pair" : ""}`}
              >
                <Field
                  label={
                    mode === "bitcoin" ? "Dollars" : `Amount · ${currency}`
                  }
                  hint={
                    mode === "bitcoin"
                      ? "Actual dollars exchanged. Record fees separately."
                      : currency === "bitcoin"
                        ? "Whole bitcoin units."
                        : undefined
                  }
                >
                  <input
                    ref={amountInput}
                    className="amount-input"
                    name="amount"
                    defaultValue={preset?.amount}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={amountUnit === "USD" ? "0.00" : "0"}
                    required
                  />
                </Field>
                {kind === "transfer" && crossCurrency && (
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
                      className="amount-input"
                      name="destination_amount"
                      maxLength={50}
                      inputMode="decimal"
                      autoComplete="off"
                      value={received}
                      onChange={(e) => setReceived(e.target.value)}
                      required
                      placeholder={
                        destination.currency !== "BITCOIN"
                          ? "0.00"
                          : receivedUnit === "BTC"
                            ? "0.00125000"
                            : "0"
                      }
                    />
                  </Field>
                )}
              </div>
              {mode !== "bitcoin" && (
                <div className="entry-description full-width">
                  <Field
                    label="Description · optional"
                    hint={
                      kind === "transfer" || payees.length
                        ? undefined
                        : "Left blank, the category name is used."
                    }
                  >
                    <input
                      name="description"
                      value={description}
                      onChange={(e) => describe(e.target.value)}
                      autoComplete="off"
                      placeholder={
                        kind === "income"
                          ? "Who paid you?"
                          : "What was this for?"
                      }
                      maxLength={500}
                    />
                  </Field>
                  {payees.length > 0 && (
                    <div
                      className="payee-suggestions"
                      role="group"
                      aria-label={
                        description.trim()
                          ? "Matching past entries"
                          : "Frequent entries"
                      }
                    >
                      <span>{description.trim() ? "Matches" : "Frequent"}</span>
                      {payees.map((payee) => (
                        <button
                          type="button"
                          key={payee.description}
                          onClick={() => applyPayee(payee)}
                          title="Fill the category, account and last amount"
                        >
                          {payee.description}
                          <small>
                            {formatMoney(
                              payee.amount,
                              payee.currency === "USD" ? "USD" : "BITCOIN",
                            )}
                          </small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {kind === "transfer" &&
                crossCurrency &&
                destination.currency === "BITCOIN" &&
                mode !== "bitcoin" && (
                  <ChoiceField
                    label="Bitcoin entry unit"
                    value={receivedUnit}
                    onChange={(value) => {
                      const next = value as "BTC" | "BITCOIN";
                      try {
                        if (received) {
                          const native = bitcoinInput(received, receivedUnit);
                          setReceived(
                            next === "BTC" ? bitcoinAsBtc(native) : native,
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
              {kind !== "transfer" && (
                <ChoiceField
                  label="Category"
                  name="category_id"
                  required
                  value={categoryId}
                  onChange={(next) => {
                    setCategoryId(next);
                    categoryPicked.current = true;
                    const suggested = suggestedAccount(next);
                    if (suggested) setSource(String(suggested.id));
                  }}
                  options={kindCategories.map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                />
              )}
              {kind !== "transfer" &&
                chosenCategory &&
                description.trim().length >= 2 &&
                !ruleAlreadySaved && (
                  <label className="check full-width entry-rule">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    Always file “{description.trim()}” under{" "}
                    {chosenCategory.name}
                  </label>
                )}
              <ChoiceField
                label={
                  kind === "transfer"
                    ? "From account"
                    : kind === "income"
                      ? "Received into"
                      : "Paid from"
                }
                value={source}
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
                <p className="alert full-width" role="status">
                  {mode === "bitcoin"
                    ? "Add an active USD checking account in Accounts before recording a Bitcoin buy."
                    : "Add an eligible active account in Accounts first."}
                </p>
              )}
              {kind === "transfer" && (
                <>
                  <ChoiceField
                    label={mode === "bitcoin" ? "Bitcoin wallet" : "To account"}
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
              <div className="transaction-date full-width">
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
                {!state.recurring && !state.bill && (
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
                )}
              </div>
              {newExpense && (
                <ChoiceField
                  label="Repeats"
                  name="frequency"
                  value={frequency}
                  onChange={setFrequency}
                  options={repeatOptions}
                  hint={
                    frequency === "once"
                      ? undefined
                      : paymentTiming === "paid"
                        ? "Records this expense now and saves the next bill to confirm later."
                        : "Each occurrence is recorded when you confirm its payment."
                  }
                />
              )}
              {state.bill && (
                <ChoiceField
                  label="Repeats"
                  name="frequency"
                  defaultValue={state.bill.frequency}
                  options={repeatOptions.map((option) =>
                    option.value === "once"
                      ? { ...option, label: "Once · planned expense" }
                      : option,
                  )}
                  hint="This is planned spending. Confirm payment when paid to include it in your budget's actual spending."
                />
              )}
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
                <>
                  <details
                    className="entry-notes full-width"
                    open={Boolean(preset?.notes)}
                  >
                    <summary>Add a note</summary>
                    <Field label="Notes · optional">
                      <textarea
                        name="notes"
                        defaultValue={preset?.notes}
                        maxLength={4000}
                        rows={2}
                      />
                    </Field>
                  </details>
                </>
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
          {isTransaction &&
            onSavedAnother &&
            !state.transaction &&
            !state.bill &&
            !state.recurring && (
              // Not a submit button: pressing Enter in the form must use the primary action.
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={(event) => {
                  another.current = true;
                  event.currentTarget.form?.requestSubmit();
                }}
              >
                Save and add another
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
                ? state.transaction || state.bill
                  ? "Save changes"
                  : state.recurring
                    ? "Save planned expense"
                    : `Record ${
                        mode === "expense"
                          ? "expense"
                          : mode === "income"
                            ? "income"
                            : mode === "bitcoin"
                              ? "bitcoin buy"
                              : "transfer"
                      }`
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
