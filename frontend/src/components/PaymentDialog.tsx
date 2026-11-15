import { useModalDialog } from "../lib/useModalDialog";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { canMoveMoney, cashBalance } from "../lib/accountActions";
import { formatMoney } from "../lib/money";
import type { Account, Category } from "../lib/types";
import { Field, today } from "./EntryDialog";
import { Money } from "./Money";
import { Button } from "./ui/button";

function minor(value: string, currency: Account["currency"]) {
  const text = value.trim() || "0";
  if (!(currency === "USD" ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/).test(text))
    throw new Error(
      "Enter a valid payment amount in the account's original currency.",
    );
  const [whole, fraction = ""] = text.split(".");
  return currency === "USD"
    ? BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
    : BigInt(whole);
}
function original(value: bigint, currency: Account["currency"]) {
  return currency === "USD"
    ? `${value / 100n}.${String(value % 100n).padStart(2, "0")}`
    : String(value);
}
export function PaymentDialog({
  debt,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  debt: Account;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const sources = accounts.filter(
    (account) => canMoveMoney(account) && account.currency === debt.currency,
  );
  const [source, setSource] = useState(
    String(
      sources.find((account) => account.kind === "checking")?.id ||
        sources[0]?.id ||
        "",
    ),
  );
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  let principal: string | null = null,
    hasInterest = false;
  try {
    const charge = minor(interest, debt.currency),
      total = minor(amount, debt.currency);
    hasInterest = charge > 0n;
    if (total >= charge && amount)
      principal = original(total - charge, debt.currency);
  } catch {
    /* Validation is reported when saving. */
  }
  useModalDialog(dialog);
  useEffect(() => {
    amountInput.current?.focus();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const total = minor(amount, debt.currency),
        charge = minor(interest, debt.currency);
      if (total <= 0n || charge > total)
        throw new Error(
          "Payment must be positive and cover the interest and fees.",
        );
      await api(`/accounts/${debt.id}/payments`, "POST", {
        account_id: Number(source),
        date: form.get("date"),
        amount: original(total, debt.currency),
        interest: original(charge, debt.currency),
        category_id: hasInterest ? Number(form.get("category_id")) : null,
        notes: form.get("notes") || "",
      });
      onSaved(`Payment recorded: ${debt.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entry-dialog"
      aria-labelledby="payment-title"
      onCancel={(event) => {
        event.stopPropagation();
        if (lock.current) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="payment-title">
            {debt.kind === "credit_card" ? "Make payment" : "Record payment"}:{" "}
            {debt.name}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close payment"
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
          <p className="hint full-width">
            {debt.kind === "credit_card" ? "Card balance:" : "Recorded debt:"}{" "}
            <Money value={debt.balance} unit={debt.currency} />
          </p>
          {debt.kind === "credit_card" && (
            <p className="hint full-width">
              Choose the account you used to pay this card. Recording the
              payment updates both balances.
            </p>
          )}
          <Field label="Pay from account">
            <select
              value={source}
              required
              disabled={busy}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="" disabled>
                Select paying account
              </option>
              {sources.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ·{" "}
                  {formatMoney(cashBalance(account), account.currency)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`Payment amount · ${debt.currency === "BITCOIN" ? "bitcoin" : "USD"}`}
          >
            <input
              ref={amountInput}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              required
              disabled={busy}
            />
          </Field>
          <Field
            label={`Interest & fees · ${debt.currency === "BITCOIN" ? "bitcoin" : "USD"}`}
            hint="Included in the payment amount, not added on top. Leave zero if recorded separately."
          >
            <input
              value={interest}
              onChange={(event) => setInterest(event.target.value)}
              inputMode="decimal"
              disabled={busy}
            />
          </Field>
          {hasInterest && (
            <Field label="Interest & fees category">
              <select
                name="category_id"
                required
                defaultValue=""
                disabled={busy}
              >
                <option value="" disabled>
                  Select expense category
                </option>
                {categories
                  .filter((category) => category.kind === "expense")
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {principal !== null && (
            <p className="hint full-width">
              Reduces debt by <Money value={principal} unit={debt.currency} />.
              Only interest and fees count as budget spending.
            </p>
          )}
          <details className="full-width transfer-details">
            <summary>Date & notes · optional</summary>
            <div className="stack">
              <Field label="Payment date">
                <input
                  name="date"
                  type="date"
                  defaultValue={today()}
                  max={today()}
                  required
                  disabled={busy}
                />
              </Field>
              <Field label="Payment notes">
                <textarea
                  name="notes"
                  rows={2}
                  maxLength={4000}
                  disabled={busy}
                />
              </Field>
            </div>
          </details>
          {!sources.length && (
            <p className="alert full-width">
              Add an active cash account in the debt's currency before recording
              a payment.
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button disabled={busy || !source}>
            {busy ? "Saving…" : "Record payment"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
