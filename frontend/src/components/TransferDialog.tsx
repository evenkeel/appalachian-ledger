import { useModalDialog } from "../lib/useModalDialog";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import { api } from "../lib/api";
import { bitcoinInput, bitcoinAsBtc } from "../lib/bitcoinInput";
import {
  canMoveMoney,
  cashBalance,
  isCashAccount,
  isBrokerageAccount,
} from "../lib/accountActions";
import { formatMoney } from "../lib/money";
import type { Account } from "../lib/types";
import { Field, today } from "./EntryDialog";
import { Money } from "./Money";
import { Button } from "./ui/button";

export function TransferDialog({
  accounts,
  initialAccount,
  cashMovement = false,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  initialAccount?: Account;
  cashMovement?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const available = accounts.filter(
    (account) =>
      canMoveMoney(account) && (isCashAccount(account) || cashMovement),
  );
  const initial =
    available.find((account) => account.id === initialAccount?.id) ||
    available.find((account) => account.kind === "checking") ||
    available[0];
  function suggestedDestination(from?: Account) {
    const matches = available.filter(
      (account) =>
        account.id !== from?.id && account.currency === from?.currency,
    );
    return matches.length === 1 ? String(matches[0].id) : "";
  }
  const [from, setFrom] = useState(String(initial?.id || ""));
  const [to, setTo] = useState(() => suggestedDestination(initial));
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"BITCOIN" | "BTC">("BITCOIN");
  const [receivedUnit, setReceivedUnit] = useState<"BITCOIN" | "BTC">(
    "BITCOIN",
  );
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const source = available.find((account) => String(account.id) === from);
  const destination = available.find((account) => String(account.id) === to);
  const crossCurrency =
    source && destination && source.currency !== destination.currency;
  useModalDialog(dialog);
  useEffect(() => {
    amountInput.current?.focus();
  }, []);
  function changeSource(id: string) {
    setFrom(id);
    setTo(
      suggestedDestination(
        available.find((account) => String(account.id) === id),
      ),
    );
    setAmount("");
    setReceived("");
    setUnit("BITCOIN");
    setReceivedUnit("BITCOIN");
    setError("");
  }
  function changeUnit(next: "BTC" | "BITCOIN") {
    try {
      if (amount) {
        const native = bitcoinInput(amount, unit);
        setAmount(next === "BTC" ? bitcoinAsBtc(native) : native);
      }
      setUnit(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (!source || !destination || source.id === destination.id)
        throw new Error("Choose two different accounts.");
      await api("/transactions", "POST", {
        kind: "transfer",
        date: form.get("date"),
        account_id: source.id,
        destination_id: destination.id,
        amount:
          source.currency === "BITCOIN" ? bitcoinInput(amount, unit) : amount,
        destination_amount: crossCurrency
          ? destination.currency === "BITCOIN"
            ? bitcoinInput(received, receivedUnit)
            : received
          : null,
        category_id: null,
        description: `${source.name} → ${destination.name}`,
        notes: form.get("notes") || "",
      });
      onSaved(`Transfer recorded: ${source.name} → ${destination.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const label = (account: Account) =>
    `${account.name} · ${formatMoney(cashBalance(account), account.currency)}${isBrokerageAccount(account) ? " cash" : ""}`;
  return (
    <dialog
      ref={dialog}
      className="entry-dialog"
      aria-labelledby="transfer-title"
      onCancel={(event) => {
        event.stopPropagation();
        if (lock.current) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="transfer-title">
            {cashMovement ? "Move brokerage cash" : "Transfer between accounts"}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close transfer"
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
          <Field label="From account">
            <select
              value={from}
              onChange={(event) => changeSource(event.target.value)}
              required
              disabled={busy}
            >
              <option value="" disabled>
                Select account
              </option>
              {available.map((account) => (
                <option key={account.id} value={account.id}>
                  {label(account)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To account">
            <select
              value={to}
              required
              disabled={busy}
              onChange={(event) => {
                setTo(event.target.value);
                setReceived("");
                setReceivedUnit("BITCOIN");
              }}
            >
              <option value="" disabled>
                Select destination
              </option>
              {available
                .filter((account) => String(account.id) !== from)
                .sort(
                  (a, b) =>
                    Number(b.currency === source?.currency) -
                    Number(a.currency === source?.currency),
                )
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {label(account)}
                  </option>
                ))}
            </select>
          </Field>
          {source && destination && (
            <div className="transfer-route full-width">
              <span>
                {source.name} → {destination.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                  setAmount("");
                  setReceived("");
                  setUnit("BITCOIN");
                  setReceivedUnit("BITCOIN");
                  setError("");
                }}
              >
                <ArrowLeftRight size={14} /> Swap accounts
              </Button>
            </div>
          )}
          {source?.currency === "BITCOIN" && (
            <Field label="Amount unit">
              <select
                value={unit}
                disabled={busy}
                onChange={(event) =>
                  changeUnit(event.target.value as "BTC" | "BITCOIN")
                }
              >
                <option value="BITCOIN">bitcoin · whole units</option>
                <option value="BTC">Legacy BTC · decimal</option>
              </select>
            </Field>
          )}
          <Field
            label={`Amount · ${source?.currency === "BITCOIN" ? (unit === "BTC" ? "BTC" : "bitcoin") : "USD"}`}
          >
            <input
              ref={amountInput}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              required
              autoFocus
              disabled={busy || !source}
            />
          </Field>
          {crossCurrency && (
            <>
              {destination.currency === "BITCOIN" && (
                <Field label="Received unit">
                  <select
                    value={receivedUnit}
                    disabled={busy}
                    onChange={(event) => {
                      setReceivedUnit(event.target.value as "BTC" | "BITCOIN");
                      setReceived("");
                    }}
                  >
                    <option value="BITCOIN">bitcoin · whole units</option>
                    <option value="BTC">Legacy BTC · decimal</option>
                  </select>
                </Field>
              )}
              <Field
                label={`Amount received · ${destination.currency === "BITCOIN" ? (receivedUnit === "BTC" ? "BTC" : "bitcoin") : "USD"}`}
                hint="Enter the amount actually received."
              >
                <input
                  value={received}
                  onChange={(event) => setReceived(event.target.value)}
                  inputMode="decimal"
                  required
                  disabled={busy}
                />
              </Field>
            </>
          )}
          {source && (
            <p className="hint full-width">
              {isBrokerageAccount(source)
                ? "Uninvested cash:"
                : "Account balance:"}{" "}
              <Money value={cashBalance(source)} unit={source.currency} />
              {source.currency === "BITCOIN" && unit === "BTC" && (
                <>
                  {" "}
                  ·{" "}
                  {source.balance.startsWith("-")
                    ? `-${bitcoinAsBtc(source.balance.slice(1))}`
                    : bitcoinAsBtc(source.balance)}{" "}
                  BTC
                </>
              )}
            </p>
          )}
          <details className="full-width transfer-details">
            <summary>Date & notes · optional</summary>
            <div className="stack">
              <Field label="Transfer date">
                <input
                  name="date"
                  type="date"
                  defaultValue={today()}
                  max={today()}
                  required
                  disabled={busy}
                />
              </Field>
              <Field label="Transfer notes">
                <textarea
                  name="notes"
                  maxLength={4000}
                  rows={2}
                  disabled={busy}
                />
              </Field>
            </div>
          </details>
          <p className="hint full-width">
            Transfers do not count as income or expenses. Record any fee as a
            separate expense.
          </p>
          {available.length < 2 && (
            <p className="alert full-width">
              {cashMovement
                ? "Set up holdings and cash for a brokerage account and add another active cash account."
                : "Add another active wallet or cash account before recording a transfer."}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button disabled={busy || !source || !destination}>
            {busy ? "Saving…" : "Record transfer"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
