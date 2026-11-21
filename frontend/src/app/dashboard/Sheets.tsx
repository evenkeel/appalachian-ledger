import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "../../lib/api";
import { cents, fromCents, usd } from "../lib/format";
import type { Bill, DashboardData } from "./types";

export type BillMode = "pay" | "destroy" | "payoff";

/** A small modal: Escape cancels, focus starts on the main action and returns on close. */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !ref.current) return;
      const items = ref.current.querySelectorAll<HTMLElement>("button:not([disabled]),input,select,a[href]");
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

/** A button that needs a second, separate press: a double-click on the first one does nothing more. */
export function TwoStep({ ask, confirm, disabled, onConfirm }: { ask: string; confirm: string; disabled?: boolean; onConfirm: () => void }) {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  return (
    <button
      type="button"
      className="btn ghost"
      style={{ marginLeft: "auto" }}
      disabled={disabled}
      onClick={() => {
        if (armedAt === null) setArmedAt(Date.now());
        else if (Date.now() - armedAt > 400) onConfirm();
      }}
    >
      {armedAt === null ? ask : confirm}
    </button>
  );
}

/** Pay records this month's payment. Destroy cancels a bill for good. Pay off clears a debt and destroys its bill. */
export function BillSheet({
  bill,
  mode,
  data,
  onMode,
  onClose,
  onDone,
}: {
  bill: Bill;
  mode: BillMode;
  data: DashboardData;
  onMode: (mode: BillMode) => void;
  onClose: () => void;
  onDone: (mode: BillMode) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const paying = data.checking.accounts.find((account) => account.id === bill.account_id);
  const debt = bill.pays_account_id !== null && bill.payoff !== null;
  const label = bill.name.replace(/ payment$/i, "");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onDone(mode);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const problem = error && (
    <p className="gate-error" role="alert">
      {error}
    </p>
  );

  if (mode === "payoff" && debt) {
    const enough = !paying || cents(bill.payoff!) <= cents(paying.balance);
    return (
      <Sheet label={`Pay off ${label}`} onClose={onClose}>
        <h2>Pay off {label} and destroy it?</h2>
        <p className="sub">
          This pays the whole balance, <b className="num">{usd(bill.payoff)}</b>, from {bill.account}. The bill is
          destroyed and stops coming back, which frees <b className="num">{usd(bill.monthly_amount)}</b> a month.
        </p>
        {enough ? (
          paying && (
            <div className="sub num">
              Left in {paying.name} after this: <b>{usd(fromCents(cents(paying.balance) - cents(bill.payoff!)))}</b>
            </div>
          )
        ) : (
          <p className="sub">
            <b className="warnc">Not enough in checking.</b> {paying!.name} holds <span className="num">{usd(paying!.balance)}</span>
            ; you need <b className="num">{usd(fromCents(cents(bill.payoff!) - cents(paying!.balance)))}</b> more.
          </p>
        )}
        {problem}
        <div className="acts">
          <button
            className="btn primary"
            data-autofocus
            disabled={busy || !enough}
            onClick={() => run(() => api(`/recurring-bills/${bill.id}/pay-off`, "POST", { date: data.today }))}
          >
            Pay off
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      </Sheet>
    );
  }

  if (mode === "destroy") {
    const yearly = fromCents(cents(bill.monthly_amount) * 12n);
    return (
      <Sheet label={`Destroy ${bill.name}`} onClose={onClose}>
        <h2>Destroy {bill.name} for good?</h2>
        <p className="sub">
          It stops coming back. That frees <b className="num">{usd(bill.monthly_amount)}</b> a month,{" "}
          <b className="num">{usd(yearly)}</b> a year you could stack instead.
        </p>
        <p className="hint">This removes the bill here only. Cancel it with the provider too, or it will still be charged.</p>
        {problem}
        <div className="acts">
          <button
            className="btn primary"
            data-autofocus
            disabled={busy}
            onClick={() => run(() => api(`/recurring-bills/${bill.id}/destroy`, "POST"))}
          >
            Destroy
          </button>
          <button className="btn ghost" onClick={onClose}>
            Keep it <kbd>Esc</kbd>
          </button>
        </div>
      </Sheet>
    );
  }

  function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      api(`/recurring-bills/${bill.id}/record`, "POST", {
        due_date: bill.due_date,
        date: form.get("date"),
        amount: String(form.get("amount")).replace(/[$,\s]/g, ""),
      }),
    );
  }
  return (
    <Sheet label={`Pay ${bill.name}`} onClose={onClose}>
      <h2>Pay {bill.name}</h2>
      <p className="sub">
        This records the payment in your ledger. Change the date or amount if the real payment was different.
      </p>
      <form onSubmit={pay} style={{ display: "grid", gap: 10 }}>
        <div className="sheet-fields">
          <label className="field">
            <span>Paid on</span>
            <input name="date" type="date" defaultValue={data.today} max={data.today} required />
          </label>
          <label className="field">
            <span>Amount</span>
            <input name="amount" className="num" inputMode="decimal" defaultValue={bill.amount} required />
          </label>
        </div>
        <div className="sub">
          From {bill.account}
          {paying && (
            <>
              {" "}
              · left in {paying.name} after this: <b className="num">{usd(fromCents(cents(paying.balance) - cents(bill.amount)))}</b>
            </>
          )}
          {bill.frequency !== "once" && !debt && " · it comes back next time it is due"}
        </div>
        {problem}
        <div className="acts">
          <button className="btn primary" data-autofocus disabled={busy}>
            Pay
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
          <button type="button" className="btn ghost" style={{ marginLeft: "auto" }} onClick={() => onMode(debt ? "payoff" : "destroy")}>
            {debt ? "Pay it off instead" : "Destroy it for good instead"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** A planned paycheck. It never posts by itself; it only tells Cash ahead when money lands in checking. */
export interface Paycheck {
  id: number;
  account_id: number;
  account: string;
  name: string;
  amount: string;
  frequency: string;
  next_date: string;
  next_occurrence: string | null;
}

export function PaycheckSheet({ data, schedule, onClose, onDone }: { data: DashboardData; schedule?: Paycheck; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(schedule ? `/income-schedules/${schedule.id}` : "/income-schedules", schedule ? "PUT" : "POST", {
        account_id: Number(form.get("account_id")),
        name: form.get("name"),
        amount: String(form.get("amount")).replace(/[$,\s]/g, ""),
        frequency: form.get("frequency"),
        next_date: form.get("next_date"),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet label={schedule ? `Change ${schedule.name}` : "Set your next paycheck"} onClose={onClose}>
      <h2>{schedule ? `Change ${schedule.name}` : "Set your next paycheck"}</h2>
      <p className="sub">Used to show whether checking covers your bills until payday. It never records income by itself.</p>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <div className="sheet-fields">
          <label className="field">
            <span>Name</span>
            <input name="name" defaultValue={schedule?.name ?? "Paycheck"} required maxLength={120} data-autofocus />
          </label>
          <label className="field">
            <span>Take-home amount</span>
            <input name="amount" className="num" inputMode="decimal" placeholder="0.00" defaultValue={schedule?.amount} required />
          </label>
          <label className="field">
            <span>How often</span>
            <select name="frequency" defaultValue={schedule?.frequency ?? "biweekly"}>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every two weeks</option>
              <option value="semimonthly">Twice a month</option>
              <option value="monthly">Once a month</option>
            </select>
          </label>
          <label className="field">
            <span>Next payday</span>
            <input name="next_date" type="date" min={schedule ? undefined : data.today} defaultValue={schedule?.next_occurrence ?? schedule?.next_date} required />
          </label>
          <label className="field" style={{ gridColumn: "1/-1" }}>
            <span>Lands in</span>
            <select name="account_id" defaultValue={schedule?.account_id}>
              {data.checking.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            Save paycheck
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </Sheet>
  );
}
