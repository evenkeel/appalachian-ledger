import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Sheet } from "../dashboard/Sheets";
import { money, spendable, typed, untyped } from "./shared";
import type { Account } from "./shared";

interface CategoryRow {
  id: number;
  name: string;
  kind: string;
}

/** A payment toward a card or loan, from another account. Interest and fees inside it are recorded as an expense. */
export function PaymentSheet({ debt, accounts, today, onClose, onDone }: { debt: Account; accounts: Account[]; today: string; onClose: () => void; onDone: (message: string) => void }) {
  const sources = accounts
    .filter((account) => account.id !== debt.id && account.currency === debt.currency && spendable(account) !== null)
    .sort((a, b) => Number(b.kind === "checking") - Number(a.kind === "checking") || a.id - b.id);
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unit = debt.currency;
  const total = typed(amount, unit);
  const charge = interest.trim() === "" ? 0n : typed(interest, unit);
  const hasCharge = charge !== null && charge > 0n;
  const principal = total !== null && charge !== null && total >= charge ? total - charge : null;

  // Categories are only needed once some of the payment is interest or fees.
  useEffect(() => {
    if (!hasCharge || categories) return;
    let alive = true;
    api<CategoryRow[]>("/categories")
      .then((rows) => alive && setCategories(rows.filter((row) => row.kind === "expense")))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [hasCharge, categories]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (total === null || charge === null) return setError(unit === "USD" ? "Enter amounts as dollars and cents, like 250.00" : "Enter whole bitcoin units, like 125000");
    if (total <= 0n || charge > total) return setError("The payment must be more than zero and at least as large as the interest and fees inside it.");
    if (hasCharge && !fields.get("category_id")) return setError("Choose a category for the interest and fees.");
    setBusy(true);
    setError("");
    try {
      await api(`/accounts/${debt.id}/payments`, "POST", {
        account_id: Number(fields.get("account_id")),
        date: fields.get("date"),
        amount: untyped(total, unit),
        interest: untyped(charge, unit),
        category_id: hasCharge ? Number(fields.get("category_id")) : null,
        notes: String(fields.get("notes") ?? "").trim(),
      });
      onDone(`Payment to ${debt.name} recorded.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const title = `Pay ${debt.name}`;
  if (!sources.length)
    return (
      <Sheet label={title} onClose={onClose}>
        <h2>{title}</h2>
        <p className="sub">
          There is no account to pay from. A payment comes from a checking, savings, cash or bitcoin account in the same unit as the debt, or from a share account's
          uninvested cash.
        </p>
        <div className="acts">
          <button className="btn ghost" data-autofocus onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </Sheet>
    );
  return (
    <Sheet label={title} onClose={onClose}>
      <h2>{title}</h2>
      <p className="sub">
        Owed now: <b className="num">{money(debt.balance, unit)}</b>. Recording the payment lowers the paying account and the debt together.
      </p>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <div className="sheet-fields">
          <label className="field" style={{ gridColumn: "1/-1" }}>
            <span>Pay from</span>
            <select name="account_id">
              {sources.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {money(spendable(account), unit)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Amount{unit === "BITCOIN" ? " (₿)" : ""}</span>
            <input className="num" inputMode="decimal" placeholder={unit === "BITCOIN" ? "0" : "0.00"} value={amount} onChange={(event) => setAmount(event.target.value)} required data-autofocus />
          </label>
          <label className="field">
            <span>Interest and fees in it</span>
            <input className="num" inputMode="decimal" placeholder={unit === "BITCOIN" ? "0" : "0.00"} value={interest} onChange={(event) => setInterest(event.target.value)} />
          </label>
          {hasCharge && (
            <label className="field">
              <span>Interest category</span>
              <select name="category_id" defaultValue="" required>
                <option value="" disabled>
                  {categories ? "Choose a category" : "Loading…"}
                </option>
                {(categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Paid on</span>
            <input name="date" type="date" defaultValue={today} max={today} required />
          </label>
          <label className="field" style={{ gridColumn: "1/-1" }}>
            <span>Note</span>
            <input name="notes" maxLength={4000} placeholder="Optional" />
          </label>
        </div>
        <p className="hint">
          {principal !== null && total !== null && total > 0n ? (
            <>
              <b className="num">{money(untyped(principal, unit), unit)}</b> comes off the balance
              {hasCharge && (
                <>
                  ; <b className="num">{money(untyped(charge!, unit), unit)}</b> is recorded as an expense
                </>
              )}
              .
            </>
          ) : (
            "Interest and fees are part of the amount, not added on top. Leave it empty if there are none."
          )}
        </p>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            Record payment
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </Sheet>
  );
}
