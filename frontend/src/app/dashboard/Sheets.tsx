import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "../../lib/api";
import { AmountInput } from "../lib/AmountInput";
import { cents, fromCents, usd } from "../lib/format";
import type { Bill, DashboardData } from "./types";

export type BillMode = "pay" | "destroy" | "payoff";

/** A small modal: Escape cancels, focus starts on the main action and returns on close. */
export function Sheet({ label, onClose, wide, children }: { label: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
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
      <div ref={ref} className={wide ? "sheet wide" : "sheet"} role="dialog" aria-modal="true" aria-label={label}>
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
            <AmountInput name="amount" defaultValue={bill.amount} required />
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

/** Income the owner expects: a paycheck, tips, side work. It never posts by itself; it only tells the checking forecast when money lands. */
export interface Paycheck {
  id: number;
  account_id: number;
  account: string;
  name: string;
  amount: string;
  frequency: string;
  next_date: string;
  next_occurrence: string | null;
  /** The amount is a typical one, so the forecast treats it as an estimate. */
  varies?: boolean;
}

export function PaycheckSheet({ data, schedule, onClose, onDone }: { data: DashboardData; schedule?: Paycheck; onClose: () => void; onDone: () => void }) {
  if (!schedule) return <IncomeRows data={data} onClose={onClose} onDone={onDone} />;
  return <PaycheckForm data={data} schedule={schedule} onClose={onClose} onDone={onDone} />;
}

function PaycheckForm({ data, schedule, onClose, onDone }: { data: DashboardData; schedule?: Paycheck; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [varies, setVaries] = useState(schedule?.varies ?? false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(schedule ? `/income-schedules/${schedule.id}` : "/income-schedules", schedule ? "PUT" : "POST", {
        varies,
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
    <Sheet label={schedule ? `Change ${schedule.name}` : "Add income you expect"} onClose={onClose}>
      <h2>{schedule ? `Change ${schedule.name}` : "Add income you expect"}</h2>
      <p className="sub">A paycheck, tips, side work: anything you can count on. It shows whether checking covers your bills until the money lands, and never records income by itself.</p>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <div className="sheet-fields">
          <label className="field">
            <span>Name</span>
            <input name="name" defaultValue={schedule?.name ?? "Paycheck"} required maxLength={120} data-autofocus />
          </label>
          <label className="field">
            <span>{varies ? "Typical amount" : "Take-home amount"}</span>
            <AmountInput name="amount" placeholder="0.00" defaultValue={schedule?.amount} required />
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
            <span>{varies ? "Next time you expect it" : "Next payday"}</span>
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
          <label className="check-line" style={{ gridColumn: "1/-1" }}>
            <input type="checkbox" checked={varies} onChange={(event) => setVaries(event.target.checked)} /> The amount varies, like tips or side work
          </label>
        </div>
        {varies && <p className="hint">Enter what you usually get. The forecast shows it as an estimate and tells you if your bills depend on it.</p>}
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            Save income
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Income people often count on, shown greyed out until something is typed. */
const INCOME_EXAMPLES = [
  { name: "Paycheck", amount: "2,150.00", frequency: "biweekly", varies: false },
  { name: "Tips", amount: "300.00", frequency: "weekly", varies: true },
  { name: "Side work", amount: "400.00", frequency: "monthly", varies: true },
  { name: "Second job", amount: "900.00", frequency: "biweekly", varies: false },
];
const INCOME_FREQUENCIES: [string, string][] = [
  ["weekly", "Every week"],
  ["biweekly", "Every two weeks"],
  ["semimonthly", "Twice a month"],
  ["monthly", "Once a month"],
];
interface IncomeRow {
  key: number;
  name: string;
  amount: string;
  frequency: string;
  next: string;
  varies: boolean;
  error?: string;
}
const blankIncome = (key: number): IncomeRow => {
  const example = INCOME_EXAMPLES[key % INCOME_EXAMPLES.length];
  return { key, name: "", amount: "", frequency: example.frequency, next: "", varies: example.varies };
};
const incomeFilled = (row: IncomeRow) => Boolean(row.name.trim() || row.amount.trim() || row.next);

/** Add several kinds of expected income at once: one row each, empty rows are skipped. */
function IncomeRows({ data, onClose, onDone }: { data: DashboardData; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<IncomeRow[]>(() => [0, 1, 2].map(blankIncome));
  const [into, setInto] = useState<number | undefined>(data.checking.accounts[0]?.id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const edit = (key: number, change: Partial<IncomeRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change, error: undefined } : row)));
  const more = () => setRows((current) => [...current, blankIncome(Math.max(...current.map((row) => row.key)) + 1)]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wanted = rows.filter(incomeFilled);
    if (!wanted.length) return setError("Fill in at least one row: a name, an amount and when it next comes.");
    const problem = (row: IncomeRow) => (!row.name.trim() ? "Give this income a name." : !row.amount.trim() ? "Enter how much it usually is." : !row.next ? "Enter when it next comes." : "");
    const bad = new Map(wanted.map((row) => [row.key, problem(row)]).filter(([, message]) => message) as [number, string][]);
    if (bad.size) {
      setRows((current) => current.map((row) => (bad.has(row.key) ? { ...row, error: bad.get(row.key) } : row)));
      return setError("");
    }
    setBusy(true);
    setError("");
    const saved: string[] = [];
    const failed = new Map<number, string>();
    for (const row of wanted) {
      try {
        await api("/income-schedules", "POST", {
          varies: row.varies,
          account_id: into,
          name: row.name.trim(),
          amount: row.amount.replace(/[$,\s]/g, ""),
          frequency: row.frequency,
          next_date: row.next,
        });
        saved.push(row.name.trim());
      } catch (e) {
        failed.set(row.key, (e as Error).message);
      }
    }
    setBusy(false);
    if (!failed.size) return onDone();
    setAdded([...added, ...saved]);
    setRows((current) => current.filter((row) => failed.has(row.key) || !incomeFilled(row)).map((row) => ({ ...row, error: failed.get(row.key) })));
  }

  return (
    <Sheet label="Add income you expect" onClose={onClose} wide>
      <h2>Add income you expect</h2>
      <p className="sub">One row for each kind of money you can count on: a paycheck, tips, side work. The grey text is only an example. It never records income by itself.</p>
      {added.length > 0 && <p className="hint" role="status">Added {added.join(", ")}. The rows below did not save yet.</p>}
      <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
        <div className="rows" style={{ ["--cols" as string]: "minmax(140px, 1.3fr) minmax(110px, 1fr) minmax(130px, 1fr) minmax(130px, 1fr) 70px" }}>
          <div className="rows-head" aria-hidden="true">
            <span>Name</span>
            <span>Take-home amount</span>
            <span>How often</span>
            <span>Next time</span>
            <span style={{ textAlign: "center" }}>Varies</span>
          </div>
          {rows.map((row, index) => {
            const example = INCOME_EXAMPLES[row.key % INCOME_EXAMPLES.length];
            return (
              <div key={row.key} className="rows-line" aria-invalid={row.error ? true : undefined} role="group" aria-label={`Income ${index + 1}`}>
                <input className="wide-cell" aria-label={`Name of income ${index + 1}`} maxLength={120} placeholder={example.name} value={row.name} onChange={(event) => edit(row.key, { name: event.target.value })} data-autofocus={index === 0 ? true : undefined} />
                <span className="unit">
                  <b aria-hidden="true">$</b>
                  <AmountInput aria-label={`Amount of income ${index + 1}`} placeholder={example.amount} value={row.amount} onChange={(event) => edit(row.key, { amount: event.target.value })} />
                </span>
                <select aria-label={`How often income ${index + 1} comes`} value={row.frequency} onChange={(event) => edit(row.key, { frequency: event.target.value })}>
                  {INCOME_FREQUENCIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input type="date" aria-label={`Next date of income ${index + 1}`} min={data.today} value={row.next} onChange={(event) => edit(row.key, { next: event.target.value })} />
                <label className="rows-check" title="The amount varies, like tips or side work">
                  <input type="checkbox" aria-label={`Income ${index + 1} varies`} checked={row.varies} onChange={(event) => edit(row.key, { varies: event.target.checked })} />
                </label>
                {row.error && (
                  <p className="rows-error" role="alert">
                    {row.error}
                  </p>
                )}
              </div>
            );
          })}
          <button type="button" className="btn sm ghost rows-more" onClick={more}>
            + Add another row
          </button>
        </div>
        <div className="rows-shared">
          <label className="field">
            <span>Lands in</span>
            <select value={into} onChange={(event) => setInto(Number(event.target.value))}>
              {data.checking.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <p className="hint" style={{ flex: "1 1 260px" }}>
            Tick Varies for tips or side work: enter what you usually get, and the forecast shows it as an estimate.
          </p>
        </div>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            {busy ? "Adding…" : "Add income"}
          </button>
          <button type="button" className="btn ghost" onClick={added.length ? onDone : onClose}>
            {added.length ? "Done" : "Cancel"} <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </Sheet>
  );
}
