import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Frame } from "../dashboard/charts";
import { Panel } from "../dashboard/panels";
import { Sheet, TwoStep } from "../dashboard/Sheets";
import type { DashboardData } from "../dashboard/types";
import { btc, cents, coordinate, fromCents, plural, usd } from "../lib/format";
import { subPath } from "../lib/router";
import type { Route } from "../lib/router";
import { AmountInput } from "../lib/AmountInput";
import { useSession } from "../lib/session";
import "./accounts.css";
import { AccountDetail } from "./Detail";
import { PaymentSheet } from "./Payment";
import { KIND, native } from "./shared";
import type { Account } from "./shared";

export type { Account } from "./shared";

type Card = DashboardData["debt"]["cards"][number];

/** Kinds offered when adding an account, in the order people usually need them. */
const ADD_KINDS = ["checking", "bitcoin_wallet", "credit_card", "savings", "cash", "loan", "mortgage", "brokerage", "real_estate", "vehicle", "other_asset", "other_liability"];
const DEBT_KINDS = ["credit_card", "loan", "mortgage", "other_liability"];
const GROUPS: { key: Account["holding_type"]; name: string; plain: string; empty: string }[] = [
  { key: "dollars", name: "Dollars", plain: "checking, savings and cash", empty: "No dollar accounts yet. Add your checking or cash account: bills are paid from it." },
  { key: "bitcoin", name: "Bitcoin", plain: "your stack, by wallet", empty: "No bitcoin wallet yet. Add one and the Stack panel turns on." },
  { key: "debt", name: "Cards and debt", plain: "what you owe", empty: "No cards or loans. Nothing owed." },
  { key: "valued_asset", name: "Investments and property", plain: "valued in dollars", empty: "Nothing here yet. Add a brokerage account, a home or a vehicle if you track them." },
];
const paysBills = (account: Account) => account.currency === "USD" && (account.kind === "checking" || account.kind === "cash") && !account.exclude_from_liquid_usd;
/** Exact sum of dollar values; null when any value has no price behind it. */
function sum(values: (string | null)[]) {
  let total = 0n;
  for (const value of values) {
    if (value === null) return null;
    total += cents(value);
  }
  return total;
}

/** Everything you hold and owe, by kind, with the bitcoin and dollar value of each. */
export function Accounts({ go, onChanged }: { go: (route: Route) => void; onChanged?: () => void }) {
  const { lens } = useSession();
  const [state, setState] = useState<{ accounts: Account[]; data: DashboardData } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // #/accounts/add and #/accounts/add-bitcoin open the form straight away, for the setup checklist.
  const asked = subPath();
  const [sheet, setSheet] = useState<"new" | Account | null>(asked.startsWith("add") ? "new" : null);
  const [showClosed, setShowClosed] = useState(false);
  // The account whose detail is open, the debt being paid, and a counter that tells the detail to read its entries again.
  const [detail, setDetail] = useState<number | null>(null);
  const [paying, setPaying] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const [accounts, data] = await Promise.all([api<Account[]>("/accounts"), api<DashboardData>("/dashboard")]);
      setState({ accounts, data });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (!state)
    return (
      <div className="page">
        <h1>Accounts</h1>
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

  const { accounts, data } = state;
  const open = accounts.filter((account) => !account.archived);
  const closed = accounts.filter((account) => account.archived);
  const cards = new Map(data.debt.cards.map((card) => [card.account_id, card]));
  const of = (key: Account["holding_type"]) => open.filter((account) => account.holding_type === key);
  const totals = {
    bitcoin: sum(of("bitcoin").map((account) => account.usd)),
    dollars: sum(of("dollars").map((account) => account.usd)),
    other: sum(of("valued_asset").map((account) => account.usd)),
    debt: sum(of("debt").map((account) => account.usd)),
  };
  const held = of("bitcoin").reduce((total, account) => total + BigInt(account.balance_minor), 0n);
  const net = totals.bitcoin !== null && totals.dollars !== null && totals.other !== null && totals.debt !== null ? totals.bitcoin + totals.dollars + totals.other - totals.debt : null;
  const netBitcoin = (() => {
    let total = 0n;
    for (const account of open) {
      if (account.bitcoin === null) return null;
      total += account.role === "liability" ? -BigInt(account.bitcoin) : BigInt(account.bitcoin);
    }
    return total;
  })();
  const done = (message: string) => {
    setSheet(null);
    setPaying(null);
    setNotice(message);
    setVersion((n) => n + 1);
    void load();
    onChanged?.();
  };
  const opened = open.find((account) => account.id === detail);
  const debt = open.find((account) => account.id === paying);

  return (
    <div className="page">
      <h1>Accounts</h1>
      <p className="intro">Everything you hold and everything you owe. Balances come from the ledger; correcting one adds an entry and never rewrites history.</p>
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      <div className="sr" role="status">
        {notice}
      </div>
      <div className="grid2">
        {open.length === 0 ? (
          <Panel className="c6" name="Start here" plain="add your first account" inop>
            <div className="sub">Add your checking or cash account first. Bills are paid from it, and it turns on Checking forecast and Spend pace.</div>
            <div>
              <button className="btn sm primary" onClick={() => setSheet("new")}>
                Add your accounts
              </button>
            </div>
          </Panel>
        ) : (
          <Panel className="c12" name="What you have" plain="at today's price">
            <div className="kv worth">
              <div>
                <span>Net worth</span>
                <b className={lens === "BITCOIN" ? "btc private" : "private"}>{lens === "BITCOIN" ? (netBitcoin === null ? "Needs a price" : btc(netBitcoin.toString())) : net === null ? "Needs a price" : usd(fromCents(net))}</b>
              </div>
              <div>
                <span>Bitcoin</span>
                <b className="btc private">{btc(held.toString())}</b>
                <small className="num private">{totals.bitcoin === null ? "no price" : usd(fromCents(totals.bitcoin))}</small>
              </div>
              <div>
                <span>Dollars</span>
                <b>{usd(fromCents(totals.dollars ?? 0n))}</b>
                <small className="num">{usd(data.checking.total)} in checking</small>
              </div>
              <div>
                <span>Investments and property</span>
                <b>{totals.other === null ? "Needs a price" : usd(fromCents(totals.other))}</b>
              </div>
              <div>
                <span>Debt</span>
                <b>{totals.debt === null ? "Needs a price" : usd(fromCents(totals.debt))}</b>
              </div>
            </div>
            {totals.bitcoin !== null && totals.dollars !== null && totals.other !== null && totals.bitcoin + totals.dollars + totals.other > 0n && (
              <Mix bitcoin={totals.bitcoin} dollars={totals.dollars} other={totals.other} />
            )}
            {!data.price && of("bitcoin").length > 0 && (
              <div className="hint">
                There is no bitcoin price yet, so bitcoin has no dollar value here. Nothing is guessed.{" "}
                <button className="inst-link" onClick={() => go("settings")}>
                  Choose a price source →
                </button>
              </div>
            )}
          </Panel>
        )}

        {open.length > 0 &&
          GROUPS.map((group) => {
            const rows = of(group.key);
            return (
              <Panel key={group.key} className="c6" name={group.name} plain={rows.length ? `${plural(rows.length, "account")} · ${group.plain}` : group.plain} inop={!rows.length}>
                {rows.length ? (
                  <ul className="bl two">
                    {rows.map((account) => (
                      <Row
                        key={account.id}
                        account={account}
                        card={cards.get(account.id)}
                        open={detail === account.id}
                        onDetail={() => setDetail(detail === account.id ? null : account.id)}
                        onPay={() => setPaying(account.id)}
                        onChange={() => setSheet(account)}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="sub">{group.empty}</div>
                )}
              </Panel>
            );
          })}
        {opened && (
          <AccountDetail
            account={opened}
            today={data.today}
            version={version}
            onActivity={() => go("activity")}
            onDone={done}
            onPay={() => setPaying(opened.id)}
            onChange={() => setSheet(opened)}
            onClose={() => setDetail(null)}
          />
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {open.length > 0 && (
          <button className="btn sm primary" onClick={() => setSheet("new")}>
            Add accounts
          </button>
        )}
        {closed.length > 0 && (
          <button className="btn sm ghost" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "Hide" : "Show"} {plural(closed.length, "closed account")}
          </button>
        )}
      </div>
      {showClosed && closed.length > 0 && (
        <Panel name="Closed accounts" plain="kept for the record" className="narrow">
          <ul className="bl two">
            {closed.map((account) => (
              <li key={account.id}>
                <div className="bl-name">
                  <b>{account.name}</b>
                  <small>{KIND[account.kind] ?? account.kind}</small>
                </div>
                <div className="bl-amt num">
                  <span className={account.currency === "BITCOIN" ? "private" : undefined}>{native(account)}</span>
                </div>
                <div className="bl-acts">
                  <button
                    className="btn sm ghost"
                    aria-label={`Reopen ${account.name}`}
                    onClick={() =>
                      api(`/accounts/${account.id}`, "PATCH", { name: account.name, archived: false })
                        .then(() => done(`Reopened ${account.name}.`))
                        .catch((e) => setError((e as Error).message))
                    }
                  >
                    Reopen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {sheet === "new" && (
        <AddSheet
          today={data.today}
          first={asked === "add-bitcoin" ? "bitcoin_wallet" : "checking"}
          onClose={() => setSheet(null)}
          onDone={done}
          onSome={() => {
            void load();
            onChanged?.();
          }}
        />
      )}
      {sheet !== null && sheet !== "new" && <ChangeSheet account={sheet} card={cards.get(sheet.id)} today={data.today} onClose={() => setSheet(null)} onDone={done} />}
      {debt && <PaymentSheet debt={debt} accounts={open} today={data.today} onClose={() => setPaying(null)} onDone={done} />}
    </div>
  );
}

function Row({ account, card, open, onDetail, onPay, onChange }: { account: Account; card?: Card; open: boolean; onDetail: () => void; onPay: () => void; onChange: () => void }) {
  const other = account.currency === "USD" ? null : account.usd === null ? "no price" : usd(account.usd);
  const use = card?.utilization != null ? Math.min(100, coordinate(card.utilization)) : null;
  return (
    <li>
      <div className="bl-name">
        <b>{account.name}</b>
        <small>
          {KIND[account.kind] ?? account.kind}
          {paysBills(account) && " · pays the bills"}
          {account.portfolio && ` · ${account.portfolio.holdings.length === 1 ? "1 holding" : `${account.portfolio.holdings.length} holdings`}${account.portfolio.holdings.some((holding) => holding.stale) ? " · quote stale" : ""}`}
          {account.kind === "credit_card" &&
            (card?.limit ? ` · ${card.utilization ?? "0"}% of ${usd(card.limit)} used` : " · no limit set")}
          {account.kind === "credit_card" && (card?.due_day ? ` · due on day ${card.due_day}` : " · no due day set")}
        </small>
        {use !== null && (
          <div className={`bar${use >= 90 ? " over" : use >= 30 ? " warn" : ""}`} role="img" aria-label={`${card!.utilization}% of the credit limit used`}>
            <i style={{ width: `${use.toFixed(1)}%` }} />
          </div>
        )}
      </div>
      <div className="bl-amt num">
        <span className={account.currency === "BITCOIN" ? "btc private" : undefined}>{native(account)}</span>
        {account.role === "liability" ? <small>owed</small> : other && <small className={account.currency === "BITCOIN" ? "private" : undefined}>{other}</small>}
      </div>
      <div className="bl-acts">
        {account.role === "liability" && (
          <button className="btn sm" onClick={onPay} aria-label={`Record a payment to ${account.name}`}>
            Pay
          </button>
        )}
        <button className="btn sm ghost" aria-expanded={open} onClick={onDetail} aria-label={`${open ? "Hide" : "Show"} the detail for ${account.name}`}>
          {open ? "Hide" : "Details"}
        </button>
        <button className="btn sm ghost" onClick={onChange} aria-label={`Change ${account.name}`}>
          Change
        </button>
      </div>
    </li>
  );
}

/** One bar: how much of what you hold is bitcoin, dollars and everything else. */
function Mix({ bitcoin, dollars, other }: { bitcoin: bigint; dollars: bigint; other: bigint }) {
  const total = Number(bitcoin + dollars + other);
  const parts = [
    { name: "Bitcoin", value: Number(bitcoin), fill: "var(--btc)" },
    { name: "Dollars", value: Number(dollars), fill: "var(--usd)" },
    { name: "Investments and property", value: Number(other), fill: "var(--ink-3)" },
  ].filter((part) => part.value > 0);
  const percent = (value: number) => `${((value / total) * 100).toFixed(1)}%`;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <Frame className="private" height={14} label={`Of what you hold: ${parts.map((part) => `${part.name} ${percent(part.value)}`).join(", ")}.`}>
        {(W) => {
          let x = 0;
          return (
            <>
              {parts.map((part) => {
                const width = (part.value / total) * W;
                const rect = <rect key={part.name} x={x} y={0} width={Math.max(0, width - 2)} height={14} rx={3} fill={part.fill} />;
                x += width;
                return rect;
              })}
            </>
          );
        }}
      </Frame>
      <div className="key">
        {parts.map((part) => (
          <span key={part.name}>
            <i style={{ background: part.fill }} />
            {part.name} <b className="num private">{percent(part.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** What a row of each kind usually holds, shown greyed out until something is typed. */
const EXAMPLE: Record<string, { name: string; amount: string }> = {
  checking: { name: "Everyday checking", amount: "2,450.00" },
  savings: { name: "Emergency savings", amount: "6,000.00" },
  cash: { name: "Cash at home", amount: "200.00" },
  credit_card: { name: "Visa card", amount: "640.00" },
  bitcoin_wallet: { name: "Cold storage", amount: "1,250,000" },
  loan: { name: "Car loan", amount: "11,800.00" },
  mortgage: { name: "Home loan", amount: "182,000.00" },
  brokerage: { name: "401(k)", amount: "24,000.00" },
  real_estate: { name: "House", amount: "240,000.00" },
  vehicle: { name: "Truck", amount: "14,000.00" },
  other_asset: { name: "Gold coins", amount: "1,500.00" },
  other_liability: { name: "Owed to family", amount: "500.00" },
};
/** The rows a new form starts with, and the kinds offered as more rows are added. */
const START_KINDS = ["checking", "savings", "credit_card", "bitcoin_wallet", "loan"];
const MORE_KINDS = ["cash", "brokerage", "mortgage", "vehicle", "other_asset"];

interface AccountRow {
  key: number;
  kind: string;
  name: string;
  amount: string;
  limit: string;
  due: string;
  error?: string;
}
const blankRow = (key: number, kind: string): AccountRow => ({ key, kind, name: "", amount: "", limit: "", due: "" });
const filled = (row: AccountRow) => Boolean(row.name.trim() || row.amount.trim() || row.limit.trim() || row.due.trim());

/** Add several accounts at once: one row each, empty rows are skipped. */
function AddSheet({ today, first, onClose, onDone, onSome }: { today: string; first: string; onClose: () => void; onDone: (message: string) => void; onSome: () => void }) {
  const [rows, setRows] = useState<AccountRow[]>(() => {
    const kinds = first === "bitcoin_wallet" ? ["bitcoin_wallet", ...START_KINDS.filter((kind) => kind !== "bitcoin_wallet")] : START_KINDS;
    return kinds.map((kind, index) => blankRow(index, kind));
  });
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const edit = (key: number, change: Partial<AccountRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change, error: undefined } : row)));
  const more = () =>
    setRows((current) => {
      const used = new Set(current.map((row) => row.kind));
      const kind = MORE_KINDS.find((value) => !used.has(value)) ?? "checking";
      return [...current, blankRow(Math.max(...current.map((row) => row.key)) + 1, kind)];
    });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wanted = rows.filter(filled);
    if (!wanted.length) return setError("Fill in at least one row: a name and a balance.");
    const missing = wanted.filter((row) => !row.name.trim());
    if (missing.length) {
      setRows((current) => current.map((row) => (missing.includes(row) ? { ...row, error: "Give this account a name." } : row)));
      return setError("");
    }
    setBusy(true);
    setError("");
    const saved: string[] = [];
    const failed = new Map<number, string>();
    for (const row of wanted) {
      const name = row.name.trim();
      const bitcoin = row.kind === "bitcoin_wallet";
      try {
        const created = await api<{ id: number }>("/accounts", "POST", {
          name,
          kind: row.kind,
          currency: bitcoin ? "BITCOIN" : "USD",
          opening_balance: row.amount.replace(/[$₿,\s]/g, "") || "0",
          date,
        });
        const limit = row.limit.replace(/[$,\s]/g, "");
        if (row.kind === "credit_card" && (limit || row.due))
          await api(`/accounts/${created.id}/card-terms`, "PUT", { credit_limit: limit || null, due_day: row.due ? Number(row.due) : null });
        saved.push(name);
      } catch (e) {
        failed.set(row.key, (e as Error).message);
      }
    }
    setBusy(false);
    const all = [...added, ...saved];
    if (!failed.size) return onDone(`Added ${all.join(", ")}.`);
    // Keep only the rows that did not save, each with its own reason; the rest are in the ledger already.
    setAdded(all);
    setRows((current) => current.filter((row) => failed.has(row.key) || !filled(row)).map((row) => ({ ...row, error: failed.get(row.key) })));
    if (saved.length) onSome();
  }

  return (
    <Sheet label="Add accounts" onClose={onClose} wide>
      <h2>Add your accounts</h2>
      <p className="sub">One row for each account you have: checking, savings, cards, loans, bitcoin. The grey text is only an example. Empty rows are skipped.</p>
      {added.length > 0 && <p className="hint" role="status">Added {added.join(", ")}. The rows below did not save yet.</p>}
      <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
        <div className="rows" style={{ ["--cols" as string]: "minmax(130px, 0.9fr) minmax(150px, 1.4fr) minmax(130px, 1fr)" }}>
          <div className="rows-head" aria-hidden="true">
            <span>Kind</span>
            <span>Name</span>
            <span>Balance or owed today</span>
          </div>
          {rows.map((row, index) => {
            const example = EXAMPLE[row.kind] ?? EXAMPLE.checking;
            const bitcoin = row.kind === "bitcoin_wallet";
            const debt = DEBT_KINDS.includes(row.kind);
            return (
              <div key={row.key} className="rows-line" aria-invalid={row.error ? true : undefined} role="group" aria-label={`Account ${index + 1}`}>
                <select aria-label={`Kind of account ${index + 1}`} value={row.kind} onChange={(event) => edit(row.key, { kind: event.target.value })} data-autofocus={index === 0 ? true : undefined}>
                  {ADD_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {KIND[value]}
                    </option>
                  ))}
                </select>
                <input aria-label={`Name of account ${index + 1}`} className="wide-cell" maxLength={120} placeholder={example.name} value={row.name} onChange={(event) => edit(row.key, { name: event.target.value })} />
                <span className="unit">
                  <b className={bitcoin ? "btc" : undefined} aria-hidden="true">
                    {bitcoin ? "₿" : "$"}
                  </b>
                  <AmountInput aria-label={`${debt ? "Owed today on" : bitcoin ? "Bitcoin held in" : "Balance today of"} account ${index + 1}`} placeholder={example.amount.replace(/^\$/, "")} value={row.amount} onChange={(event) => edit(row.key, { amount: event.target.value })} />
                </span>
                {row.kind === "credit_card" && (
                  <div className="rows-extra">
                    <span>Limit</span>
                    <span className="unit">
                      <b aria-hidden="true">$</b>
                      <AmountInput aria-label={`Credit limit of account ${index + 1}`} placeholder="5,000.00" value={row.limit} onChange={(event) => edit(row.key, { limit: event.target.value })} />
                    </span>
                    <span>Due on day</span>
                    <input className="num day" type="number" min={1} max={31} aria-label={`Payment due day of account ${index + 1}`} placeholder="15" value={row.due} onChange={(event) => edit(row.key, { due: event.target.value })} />
                    <span>both optional</span>
                  </div>
                )}
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
            <span>Balances as of</span>
            <input type="date" value={date} max={today} required onChange={(event) => setDate(event.target.value)} />
          </label>
          <p className="hint" style={{ flex: "1 1 260px" }}>
            Bitcoin is counted in whole units: ₿1,250,000 is 0.0125 BTC. Each starting balance is recorded as an opening entry on that date.
          </p>
        </div>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            {busy ? "Adding…" : "Add accounts"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            {added.length ? "Done" : "Cancel"} <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function ChangeSheet({ account, card, today, onClose, onDone }: { account: Account; card?: Card; today: string; onClose: () => void; onDone: (message: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ledgerBalance = account.holding_type !== "valued_asset";
  const checking = account.kind === "checking" && account.currency === "USD";
  // The mortgage is never consumer debt, so the choice is offered for other debts only.
  const consumer = account.role === "liability" && account.kind !== "mortgage";
  const clean = (value: FormDataEntryValue | null) => String(value ?? "").replace(/[$₿,\s]/g, "");

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      onDone(await action());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name")).trim();
    void run(async () => {
      const wanted = clean(fields.get("balance"));
      // Check the new balance before anything is saved, so a typo changes nothing.
      let difference: string | null = null;
      if (ledgerBalance && wanted !== "" && wanted !== account.balance) {
        if (!(account.currency === "USD" ? /^-?\d+(\.\d{1,2})?$/ : /^-?\d+$/).test(wanted))
          throw new Error(account.currency === "USD" ? "Enter the balance as dollars and cents, like 1250.00" : "Enter whole bitcoin units, like 125000");
        const reason = String(fields.get("reason") ?? "").trim();
        if (reason.length < 3) throw new Error("Say why the balance changed, in a few words");
        const change = (account.currency === "USD" ? cents(wanted) : BigInt(wanted)) - BigInt(account.balance_minor);
        if (change !== 0n) difference = account.currency === "USD" ? fromCents(change) : change.toString();
      }
      await api(`/accounts/${account.id}`, "PATCH", {
        name,
        archived: false,
        ...(checking ? { exclude_from_liquid_usd: fields.get("for_bills") !== "on" } : {}),
        ...(consumer ? { exclude_from_consumer_debt: fields.get("not_consumer") === "on" } : {}),
      });
      if (account.kind === "credit_card") {
        const limit = clean(fields.get("credit_limit"));
        const dueDay = String(fields.get("due_day") ?? "");
        await api(`/accounts/${account.id}/card-terms`, "PUT", { credit_limit: limit || null, due_day: dueDay ? Number(dueDay) : null });
      }
      if (difference !== null)
        await api(`/accounts/${account.id}/adjustments`, "POST", { date: today, amount: difference, description: String(fields.get("reason")).trim() });
      return `Saved ${name}.`;
    });
  }
  return (
    <Sheet label={`Change ${account.name}`} onClose={onClose}>
      <h2>Change {account.name}</h2>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <div className="sheet-fields">
          <label className="field" style={{ gridColumn: "1/-1" }}>
            <span>Name</span>
            <input name="name" defaultValue={account.name} required maxLength={120} data-autofocus />
          </label>
          {account.kind === "credit_card" && (
            <>
              <label className="field">
                <span>Credit limit</span>
                <AmountInput name="credit_limit" placeholder="Not set" defaultValue={card?.limit ?? ""} />
              </label>
              <label className="field">
                <span>Payment due day</span>
                <input name="due_day" className="num" type="number" min={1} max={31} placeholder="1–31" defaultValue={card?.due_day ?? ""} />
              </label>
            </>
          )}
          {ledgerBalance && (
            <>
              <label className="field">
                <span>{account.role === "liability" ? "Owed now" : account.currency === "BITCOIN" ? "Bitcoin held (₿)" : "Balance now"}</span>
                <AmountInput name="balance" defaultValue={account.balance} />
              </label>
              <label className="field">
                <span>Why it changed</span>
                <input name="reason" maxLength={500} placeholder="Only if you change it" />
              </label>
            </>
          )}
        </div>
        {checking && (
          <label className="check-line">
            <input type="checkbox" name="for_bills" defaultChecked={!account.exclude_from_liquid_usd} /> Count this account as dollars in checking
          </label>
        )}
        {consumer && (
          <label className="check-line">
            <input type="checkbox" name="not_consumer" defaultChecked={account.exclude_from_consumer_debt ?? false} /> Leave this out of consumer debt
          </label>
        )}
        <p className="hint">
          {ledgerBalance
            ? "Changing the balance adds a dated correction entry for the difference. Earlier entries stay as they were."
            : "This account is valued, not counted: record a new value or edit its holdings from Details."}
          {consumer && " Leaving a debt out only changes the consumer debt figure in reports; it still counts toward total debt and net worth."}
        </p>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            Save
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
          <TwoStep
            ask="Close account"
            confirm="Yes, close it"
            disabled={busy}
            onConfirm={() =>
              void run(async () => {
                await api(`/accounts/${account.id}`, "PATCH", { name: account.name, archived: true });
                return `Closed ${account.name}.`;
              })
            }
          />
        </div>
      </form>
    </Sheet>
  );
}
