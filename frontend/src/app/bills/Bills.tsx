import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { BillsLane } from "../dashboard/charts";
import { CashAheadPanel, Panel } from "../dashboard/panels";
import { BillSheet, PaycheckSheet, Sheet, TwoStep } from "../dashboard/Sheets";
import type { BillMode, Paycheck } from "../dashboard/Sheets";
import type { Bill, DashboardData } from "../dashboard/types";
import { LevelIcon } from "../design/icons";
import { bitcoinFor, btc, cents, fromCents, plural, shortDate, usd } from "../lib/format";
import { subPath } from "../lib/router";
import type { Route } from "../lib/router";
import { AmountInput } from "../lib/AmountInput";

interface Destroyed {
  id: number;
  name: string;
  amount: string;
  currency: "USD" | "BITCOIN";
  frequency: string;
  monthly_amount: string;
  destroyed_on: string;
  account: string;
  category: string;
  paid_off: boolean;
}
interface SavedBill {
  id: number;
  account_id: number;
  category_id: number;
  description: string;
  notes: string;
  amount: string;
  frequency: string;
  next_due: string;
}
interface AccountRow {
  id: number;
  name: string;
  kind: string;
  role: "asset" | "liability";
  currency: "USD" | "BITCOIN";
  archived: boolean;
}
interface CategoryRow {
  id: number;
  name: string;
  kind: string;
}
interface Loaded {
  data: DashboardData;
  paychecks: Paycheck[];
  destroyed: Destroyed[];
}

const EVERY: Record<string, string> = {
  once: "one time",
  weekly: "every week",
  biweekly: "every two weeks",
  semimonthly: "twice a month",
  monthly: "every month",
  quarterly: "every 3 months",
  semiannual: "every 6 months",
  yearly: "every year",
};
const PAY_FROM = ["checking", "credit_card", "cash", "savings", "bitcoin_wallet"];
const money = (amount: string | null, currency: "USD" | "BITCOIN" = "USD") => (currency === "USD" ? usd(amount) : btc(amount));
const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function when(bill: Bill) {
  if (bill.overdue) return `${plural(-bill.days_until, "day")} overdue`;
  if (bill.days_until === 0) return "due today";
  if (bill.days_until === 1) return "tomorrow";
  return `in ${plural(bill.days_until, "day")}`;
}

/** Every bill, the income expected in checking, and the bills destroyed for good. */
export function Bills({ go, onChanged }: { go: (route: Route) => void; onChanged?: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<{ bill: Bill; mode: BillMode } | null>(null);
  const [gone, setGone] = useState<{ id: number; mode: BillMode } | null>(null);
  // "new" adds a bill; a number edits that bill.
  const [form, setForm] = useState<"new" | number | null>(subPath() === "add" ? "new" : null);
  const [paycheck, setPaycheck] = useState<"new" | Paycheck | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [data, paychecks, destroyed] = await Promise.all([
        api<DashboardData>("/dashboard"),
        api<Paycheck[]>("/income-schedules"),
        api<Destroyed[]>("/recurring-bills/destroyed"),
      ]);
      setLoaded({ data, paychecks, destroyed });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const changed = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  if (!loaded)
    return (
      <div className="page">
        <h1>Bills</h1>
        {error ? (
          <p className="gate-error" role="alert">
            {error}{" "}
            <button className="inst-link" onClick={() => void load()}>
              Retry →
            </button>
          </p>
        ) : (
          <div className="meter" style={{ width: "40%" }} aria-busy="true">
            <i style={{ width: "100%", opacity: 0.25 }} />
          </div>
        )}
      </div>
    );

  const { data, paychecks, destroyed } = loaded;
  const bills = data.bills;

  function finished(mode: BillMode) {
    const { bill } = sheet!;
    setSheet(null);
    setGone({ id: bill.id, mode });
    setNotice(mode === "pay" ? `Paid ${bill.name}.` : mode === "payoff" ? `Paid off and destroyed ${bill.name}.` : `Destroyed ${bill.name}.`);
    // Let the target fade or burst before the fresh reading replaces it.
    window.setTimeout(
      () => {
        setGone(null);
        changed();
      },
      reducedMotion() ? 0 : 520,
    );
  }
  async function act(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      setNotice(done);
      setError("");
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!data.setup.has_account)
    return (
      <div className="page">
        <h1>Bills</h1>
        <Panel name="Bills" plain="what is due" inop className="narrow">
          <div className="sub">Add your checking or cash account first. Bills are paid from it.</div>
          <div>
            <button className="btn sm primary" onClick={() => go("accounts")}>
              Add an account
            </button>
          </div>
        </Panel>
      </div>
    );

  const monthly = bills.items.filter((bill) => bill.currency === "USD").reduce((sum, bill) => sum + cents(bill.monthly_amount), 0n);
  const freed = destroyed.filter((bill) => bill.currency === "USD").reduce((sum, bill) => sum + cents(bill.monthly_amount), 0n);
  const freedBitcoin = data.price && freed > 0n ? bitcoinFor(freed, data.price.bitcoin_per_usd) : null;
  const sorted = [...bills.items].sort((a, b) => a.days_until - b.days_until || a.id - b.id);

  return (
    <div className="page">
      <h1>Bills</h1>
      <p className="intro">
        Pay a bill and it comes back the next time it is due. Destroy a bill when you cancel it for good. Pay off a debt and its bill is destroyed with it.
      </p>
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      <div className="sr" role="status">
        {notice}
      </div>
      <div className="grid2">
        <CashAheadPanel className="c7" data={data} go={go} onPaycheck={() => setPaycheck("new")} onChanged={changed} own />
        <Panel className="c5" name="At a glance" plain="this month's bills">
          <div className="kv glance">
            <div>
              <span>Dollars in checking</span>
              <b>{usd(data.checking.total)}</b>
            </div>
            <div>
              <span>Due before payday</span>
              <b>{usd(data.cash_ahead.due_before_paycheck)}</b>
            </div>
            <div>
              <span>Next 7 days</span>
              <b>{bills.next_7 === null ? "No price" : usd(bills.next_7)}</b>
            </div>
            <div>
              <span>Next 30 days</span>
              <b>{bills.next_30 === null ? "No price" : usd(bills.next_30)}</b>
            </div>
            <div>
              <span>Paid this month</span>
              <b>
                {bills.paid_this_month.count}
                {bills.paid_this_month.total !== null && <small> · {usd(bills.paid_this_month.total)}</small>}
              </b>
            </div>
            <div>
              <span>All bills, a month</span>
              <b>{usd(fromCents(monthly))}</b>
            </div>
          </div>
          {data.cash_ahead.short ? (
            <div className="sub">
              <b className="warnc">{usd(data.cash_ahead.short.amount)} short</b> on {shortDate(data.cash_ahead.short.date)}. Move money in, or pay a smaller bill first.
            </div>
          ) : !sorted.length ? (
            <div className="sub">No bills yet, so nothing is due.</div>
          ) : cents(data.cash_ahead.due_before_paycheck) > 0n ? (
            <div className="sub ok">{LevelIcon.ok} Enough in checking for every bill and card payment before the next payday.</div>
          ) : (
            <div className="sub ok">{LevelIcon.ok} Nothing left to pay before the next payday.</div>
          )}
        </Panel>

        <Panel className="c12" name="All bills" plain={sorted.length ? `${plural(sorted.length, "bill")} · soonest first` : "none yet"}>
          {sorted.length > 0 && <BillsLane data={data} gone={gone} onPick={(bill) => setSheet({ bill, mode: "pay" })} />}
          {sorted.length ? (
            <ul className="bl">
              {sorted.map((bill) => (
                <li key={bill.id}>
                  <div className="bl-name">
                    <b>{bill.name}</b>
                    <small>
                      {bill.category} · {EVERY[bill.frequency] ?? bill.frequency} · from {bill.account}
                    </small>
                  </div>
                  <div className="bl-due num">
                    <span>{shortDate(bill.due_date)}</span>
                    <small className={bill.overdue ? "overdue" : undefined}>{when(bill)}</small>
                  </div>
                  <div className="bl-amt num">
                    <span>{money(bill.amount, bill.currency)}</span>
                    {bill.payoff !== null ? (
                      <small>{money(bill.payoff, bill.currency)} owed</small>
                    ) : (
                      bill.frequency !== "monthly" && bill.frequency !== "once" && <small>{money(bill.monthly_amount, bill.currency)} a month</small>
                    )}
                  </div>
                  <div className="bl-acts">
                    <button className="btn sm" disabled={!!gone} onClick={() => setSheet({ bill, mode: "pay" })} aria-label={`Pay ${bill.name}`}>
                      Pay
                    </button>
                    {bill.pays_account_id !== null ? (
                      <button className="btn sm ghost" disabled={!!gone} onClick={() => setSheet({ bill, mode: "payoff" })} aria-label={`Pay off ${bill.name} in full and destroy it`}>
                        Pay off
                      </button>
                    ) : (
                      <button className="btn sm ghost" disabled={!!gone} onClick={() => setSheet({ bill, mode: "destroy" })} aria-label={`Destroy ${bill.name} for good`}>
                        Destroy
                      </button>
                    )}
                    <button className="btn sm ghost" disabled={!!gone} onClick={() => setForm(bill.id)} aria-label={`Change ${bill.name}`}>
                      Change
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sub">No bills yet. Add rent, a subscription or a card payment and it shows up here as a target.</div>
          )}
          <div>
            <button className="btn sm primary" onClick={() => setForm("new")}>
              Add bills
            </button>
          </div>
        </Panel>

        <Panel className="c5" name="Income you expect" plain="money coming into checking">
          {paychecks.length ? (
            <ul className="bl two">
              {paychecks.map((item) => (
                <li key={item.id}>
                  <div className="bl-name">
                    <b>{item.name}</b>
                    <small>
                      {EVERY[item.frequency] ?? item.frequency} · into {item.account}
                      {item.varies ? " · amount varies" : ""}
                    </small>
                  </div>
                  <div className="bl-amt num">
                    <span>
                      {item.varies ? "about " : ""}
                      {usd(item.amount)}
                    </span>
                    {item.next_occurrence && <small>next {shortDate(item.next_occurrence)}</small>}
                  </div>
                  <div className="bl-acts">
                    {removing === item.id ? (
                      <>
                        <button
                          className="btn sm"
                          onClick={() => {
                            setRemoving(null);
                            void act(() => api(`/income-schedules/${item.id}`, "DELETE"), `Removed ${item.name}.`);
                          }}
                        >
                          Remove it
                        </button>
                        <button className="btn sm ghost" onClick={() => setRemoving(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn sm ghost" onClick={() => setPaycheck(item)} aria-label={`Change ${item.name}`}>
                          Change
                        </button>
                        <button className="btn sm ghost" onClick={() => setRemoving(item.id)} aria-label={`Remove ${item.name}`}>
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sub">Nothing set. Add a paycheck, tips or side work and the checking forecast shows whether checking covers your bills until the money lands.</div>
          )}
          <div className="hint">Expected income never records itself. Record the real amount in Transactions when it lands.</div>
          <div>
            <button className="btn sm" onClick={() => setPaycheck("new")}>
              Add income
            </button>
          </div>
        </Panel>

        <Panel className="c7" name="Destroyed" plain="cancelled or paid off for good">
          {destroyed.length ? (
            <>
              <div className="lead">
                <b className="num">{usd(fromCents(freed))}</b> a month freed, <b className="num">{usd(fromCents(freed * 12n))}</b> a year.
                {freedBitcoin !== null && (
                  <>
                    {" "}
                    Stacked instead, that is about <b className="num btc">{btc(freedBitcoin.toString())}</b> a month at today's price.
                  </>
                )}
              </div>
              <ul className="bl two">
                {destroyed.map((bill) => (
                  <li key={bill.id}>
                    <div className="bl-name">
                      <b>{bill.name}</b>
                      <small>
                        {bill.paid_off ? "Paid off" : "Cancelled"} {shortDate(bill.destroyed_on)} · {bill.category}
                      </small>
                    </div>
                    <div className="bl-amt num">
                      <span>{money(bill.monthly_amount, bill.currency)}</span>
                      <small>a month freed</small>
                    </div>
                    <div className="bl-acts">
                      <button
                        className="btn sm ghost"
                        onClick={() => void act(() => api(`/recurring-bills/${bill.id}/restore`, "POST"), `Brought back ${bill.name}.`)}
                        aria-label={`Bring back ${bill.name}`}
                      >
                        Bring back
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="sub">
              Nothing destroyed yet. Cancel a subscription or pay off a debt, then destroy its bill here: every one frees money you could stack instead.
            </div>
          )}
        </Panel>
      </div>

      {sheet && (
        <BillSheet bill={sheet.bill} mode={sheet.mode} data={data} onMode={(mode) => setSheet({ bill: sheet.bill, mode })} onClose={() => setSheet(null)} onDone={finished} />
      )}
      {form !== null && (
        <BillForm
          data={data}
          bill={form === "new" ? undefined : bills.items.find((bill) => bill.id === form)}
          onClose={() => setForm(null)}
          onDone={(message) => {
            setForm(null);
            setNotice(message);
            changed();
          }}
          onSome={changed}
        />
      )}
      {paycheck !== null && (
        <PaycheckSheet
          data={data}
          schedule={paycheck === "new" ? undefined : paycheck}
          onClose={() => setPaycheck(null)}
          onDone={() => {
            setPaycheck(null);
            setNotice("Income saved.");
            changed();
          }}
        />
      )}
    </div>
  );
}

/** Add a bill or change one. Saving never records a payment. */
function BillForm({ data, bill, onClose, onDone, onSome }: { data: DashboardData; bill?: Bill; onClose: () => void; onDone: (message: string) => void; onSome?: () => void }) {
  const [options, setOptions] = useState<{ accounts: AccountRow[]; categories: CategoryRow[]; saved?: SavedBill } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState<number | null>(bill?.account_id ?? null);

  useEffect(() => {
    let alive = true;
    Promise.all([api<AccountRow[]>("/accounts"), api<CategoryRow[]>("/categories"), bill ? api<SavedBill[]>("/recurring-bills") : Promise.resolve([] as SavedBill[])])
      .then(([accounts, categories, saved]) => {
        if (!alive) return;
        const usable = accounts
          .filter((account) => !account.archived)
          .sort((a, b) => PAY_FROM.indexOf(a.kind) - PAY_FROM.indexOf(b.kind) || a.id - b.id);
        setOptions({ accounts: usable, categories: categories.filter((category) => category.kind === "expense"), saved: saved.find((row) => row.id === bill?.id) });
        setFrom((current) => current ?? usable.find((account) => PAY_FROM.includes(account.kind))?.id ?? null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [bill]);

  const title = bill ? `Change ${bill.name}` : "Add a bill";
  if (!options)
    return (
      <Sheet label={title} onClose={onClose}>
        <h2>{title}</h2>
        {error ? (
          <p className="gate-error" role="alert">
            {error}
          </p>
        ) : (
          <div className="meter" aria-busy="true">
            <i style={{ width: "100%", opacity: 0.25 }} />
          </div>
        )}
        <div className="acts">
          <button className="btn ghost" data-autofocus onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      </Sheet>
    );

  const payFrom = options.accounts.filter((account) => PAY_FROM.includes(account.kind));
  const source = payFrom.find((account) => account.id === from);
  const debts = options.accounts.filter((account) => account.role === "liability" && account.currency === source?.currency && account.id !== source?.id);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name")).trim();
    const pays = fields.get("pays") ? Number(fields.get("pays")) : null;
    setBusy(true);
    setError("");
    try {
      const body = {
        transaction: {
          kind: "expense",
          date: fields.get("due"),
          account_id: Number(fields.get("account_id")),
          category_id: Number(fields.get("category_id")),
          amount: String(fields.get("amount")).replace(/[$₿,\s]/g, ""),
          description: name,
          notes: options!.saved?.notes ?? "",
        },
        frequency: fields.get("frequency"),
        record_now: false,
      };
      const saved = await api<{ id: number }>(bill ? `/recurring-bills/${bill.id}` : "/recurring-bills", bill ? "PUT" : "POST", body);
      if (pays !== (bill?.pays_account_id ?? null)) await api(`/recurring-bills/${saved.id}/pays-account`, "PUT", { account_id: pays });
      onDone(bill ? `Saved ${name}.` : `Added ${name}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/recurring-bills/${bill!.id}`, "DELETE");
      onDone(`Removed ${bill!.name}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!payFrom.length || !options.categories.length)
    return (
      <Sheet label={title} onClose={onClose}>
        <h2>{title}</h2>
        <p className="sub">
          {payFrom.length ? "A bill needs an expense category, and this ledger has none yet." : "A bill needs an account to be paid from, and this ledger has none yet."}
        </p>
        <div className="acts">
          <button className="btn ghost" data-autofocus onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </Sheet>
    );

  if (!bill) return <BillRows data={data} payFrom={payFrom} categories={options.categories} onClose={onClose} onDone={onDone} onSome={onSome} />;

  return (
    <Sheet label={title} onClose={onClose}>
      <h2>{title}</h2>
      <p className="sub">Saving a bill never records a payment. Pay it when the money actually leaves.</p>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <div className="sheet-fields">
          <label className="field" style={{ gridColumn: "1/-1" }}>
            <span>Name</span>
            <input name="name" defaultValue={bill?.name} placeholder="Rent, internet, a subscription…" required maxLength={500} data-autofocus />
          </label>
          <label className="field">
            <span>Amount{source?.currency === "BITCOIN" ? " (₿)" : ""}</span>
            <AmountInput name="amount" placeholder={source?.currency === "BITCOIN" ? "0" : "0.00"} defaultValue={bill?.amount} required />
          </label>
          <label className="field">
            <span>How often</span>
            <select name="frequency" defaultValue={bill?.frequency ?? "monthly"}>
              <option value="monthly">Every month</option>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every two weeks</option>
              <option value="quarterly">Every 3 months</option>
              <option value="semiannual">Every 6 months</option>
              <option value="yearly">Every year</option>
              <option value="once">One time</option>
            </select>
          </label>
          <label className="field">
            <span>Next due</span>
            <input name="due" type="date" defaultValue={bill?.due_date ?? data.today} required />
          </label>
          <label className="field">
            <span>Category</span>
            <select name="category_id" defaultValue={options.saved?.category_id}>
              {options.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Paid from</span>
            <select name="account_id" value={from ?? ""} onChange={(event) => setFrom(Number(event.target.value))}>
              {payFrom.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pays down a debt</span>
            <select name="pays" defaultValue={bill?.pays_account_id ?? ""} key={source?.currency}>
              <option value="">No, a regular bill</option>
              {debts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">Link a card or loan payment to its debt and you can pay the whole balance off, which destroys the bill.</p>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            {bill ? "Save" : "Add bill"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
          {bill && <TwoStep ask="Added by mistake? Remove" confirm="Yes, remove it" disabled={busy} onConfirm={() => void remove()} />}
        </div>
      </form>
    </Sheet>
  );
}

/** Bills people usually have, shown greyed out until something is typed. */
const BILL_EXAMPLES = [
  { name: "Rent", amount: "1,400.00", category: "Housing" },
  { name: "Electric", amount: "95.00", category: "Utilities" },
  { name: "Phone", amount: "65.00", category: "Utilities" },
  { name: "Car insurance", amount: "120.00", category: "Transport" },
  { name: "Streaming service", amount: "15.49", category: "Shopping" },
  { name: "Internet", amount: "60.00", category: "Utilities" },
  { name: "Gym", amount: "30.00", category: "Health" },
  { name: "Student loan", amount: "210.00", category: "Other expense" },
];
const FREQUENCIES: [string, string][] = [
  ["monthly", "Every month"],
  ["weekly", "Every week"],
  ["biweekly", "Every two weeks"],
  ["quarterly", "Every 3 months"],
  ["semiannual", "Every 6 months"],
  ["yearly", "Every year"],
  ["once", "One time"],
];
interface BillRow {
  key: number;
  name: string;
  amount: string;
  frequency: string;
  due: string;
  category: string;
  error?: string;
}
const blankBill = (key: number): BillRow => ({ key, name: "", amount: "", frequency: "monthly", due: "", category: "" });
const billFilled = (row: BillRow) => Boolean(row.name.trim() || row.amount.trim() || row.due || row.category);

/** Add several bills at once: one row each, empty rows are skipped. Saving never records a payment. */
function BillRows({
  data,
  payFrom,
  categories,
  onClose,
  onDone,
  onSome,
}: {
  data: DashboardData;
  payFrom: AccountRow[];
  categories: CategoryRow[];
  onClose: () => void;
  onDone: (message: string) => void;
  onSome?: () => void;
}) {
  const [rows, setRows] = useState<BillRow[]>(() => [0, 1, 2, 3, 4].map(blankBill));
  const [from, setFrom] = useState<number>(payFrom[0].id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const source = payFrom.find((account) => account.id === from) ?? payFrom[0];
  const bitcoin = source.currency === "BITCOIN";

  const edit = (key: number, change: Partial<BillRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change, error: undefined } : row)));
  const more = () => setRows((current) => [...current, blankBill(Math.max(...current.map((row) => row.key)) + 1)]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wanted = rows.filter(billFilled);
    if (!wanted.length) return setError("Fill in at least one row: a name, an amount and when it is next due.");
    const problem = (row: BillRow) =>
      !row.name.trim() ? "Give this bill a name." : !row.amount.trim() ? "Enter how much it is." : !row.due ? "Enter when it is next due." : !row.category ? "Pick a category." : "";
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
      const name = row.name.trim();
      try {
        await api("/recurring-bills", "POST", {
          transaction: {
            kind: "expense",
            date: row.due,
            account_id: source.id,
            category_id: Number(row.category),
            amount: row.amount.replace(/[$₿,\s]/g, ""),
            description: name,
            notes: "",
          },
          frequency: row.frequency,
          record_now: false,
        });
        saved.push(name);
      } catch (e) {
        failed.set(row.key, (e as Error).message);
      }
    }
    setBusy(false);
    const all = [...added, ...saved];
    if (!failed.size) return onDone(`Added ${all.join(", ")}.`);
    setAdded(all);
    setRows((current) => current.filter((row) => failed.has(row.key) || !billFilled(row)).map((row) => ({ ...row, error: failed.get(row.key) })));
    if (saved.length) onSome?.();
  }

  return (
    <Sheet label="Add bills" onClose={onClose} wide>
      <h2>Add your bills</h2>
      <p className="sub">One row for each bill that comes back: rent, utilities, phone, insurance, subscriptions. The grey text is only an example. Saving never records a payment.</p>
      {added.length > 0 && <p className="hint" role="status">Added {added.join(", ")}. The rows below did not save yet.</p>}
      <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
        <div className="rows" style={{ ["--cols" as string]: "minmax(140px, 1.4fr) minmax(110px, 0.9fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(130px, 1fr)" }}>
          <div className="rows-head" aria-hidden="true">
            <span>Name</span>
            <span>Amount</span>
            <span>How often</span>
            <span>Next due</span>
            <span>Category</span>
          </div>
          {rows.map((row, index) => {
            const example = BILL_EXAMPLES[index % BILL_EXAMPLES.length];
            return (
              <div key={row.key} className="rows-line" aria-invalid={row.error ? true : undefined} role="group" aria-label={`Bill ${index + 1}`}>
                <input className="wide-cell" aria-label={`Name of bill ${index + 1}`} maxLength={500} placeholder={example.name} value={row.name} onChange={(event) => edit(row.key, { name: event.target.value })} data-autofocus={index === 0 ? true : undefined} />
                <span className="unit">
                  <b className={bitcoin ? "btc" : undefined} aria-hidden="true">
                    {bitcoin ? "₿" : "$"}
                  </b>
                  <AmountInput aria-label={`Amount of bill ${index + 1}`} placeholder={bitcoin ? "12,000" : example.amount} value={row.amount} onChange={(event) => edit(row.key, { amount: event.target.value })} />
                </span>
                <select aria-label={`How often bill ${index + 1} comes`} value={row.frequency} onChange={(event) => edit(row.key, { frequency: event.target.value })}>
                  {FREQUENCIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input type="date" aria-label={`Next due date of bill ${index + 1}`} min={data.today} value={row.due} onChange={(event) => edit(row.key, { due: event.target.value })} />
                <select aria-label={`Category of bill ${index + 1}`} className={row.category ? undefined : "unset"} value={row.category} onChange={(event) => edit(row.key, { category: event.target.value })}>
                  <option value="">{categories.some((category) => category.name === example.category) ? example.category : "Category"}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
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
            <span>Paid from</span>
            <select value={from} onChange={(event) => setFrom(Number(event.target.value))}>
              {payFrom.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <p className="hint" style={{ flex: "1 1 260px" }}>
            Paying a card or loan? Add it here, then use Change on that bill to link it to the debt, so you can pay the whole balance off and destroy the bill.
          </p>
        </div>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            {busy ? "Adding…" : "Add bills"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            {added.length ? "Done" : "Cancel"} <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </Sheet>
  );
}
