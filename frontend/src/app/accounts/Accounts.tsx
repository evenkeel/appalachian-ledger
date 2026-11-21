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
  { key: "dollars", name: "Dollars", plain: "checking, savings and cash", empty: "No dollar accounts yet. Add your checking account: bills are paid from it." },
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
            <div className="sub">Add your checking account first. Bills are paid from it, and it turns on Cash ahead and Spend pace.</div>
            <div>
              <button className="btn sm primary" onClick={() => setSheet("new")}>
                Add an account
              </button>
            </div>
          </Panel>
        ) : (
          <Panel className="c12" name="What you have" plain="at today's price">
            <div className="kv worth">
              <div>
                <span>Net worth</span>
                <b className={lens === "BITCOIN" ? "btc" : undefined}>{lens === "BITCOIN" ? (netBitcoin === null ? "Needs a price" : btc(netBitcoin.toString())) : net === null ? "Needs a price" : usd(fromCents(net))}</b>
              </div>
              <div>
                <span>Bitcoin</span>
                <b className="btc">{btc(held.toString())}</b>
                <small className="num">{totals.bitcoin === null ? "no price" : usd(fromCents(totals.bitcoin))}</small>
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
            Add an account
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
                  <span>{native(account)}</span>
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
      {sheet === "new" && <AddSheet today={data.today} first={asked === "add-bitcoin" ? "bitcoin_wallet" : "checking"} onClose={() => setSheet(null)} onDone={done} />}
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
        <span className={account.currency === "BITCOIN" ? "btc" : undefined}>{native(account)}</span>
        {account.role === "liability" ? <small>owed</small> : other && <small>{other}</small>}
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
      <Frame height={14} label={`Of what you hold: ${parts.map((part) => `${part.name} ${percent(part.value)}`).join(", ")}.`}>
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
            {part.name} <b className="num">{percent(part.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function AddSheet({ today, first, onClose, onDone }: { today: string; first: string; onClose: () => void; onDone: (message: string) => void }) {
  const [kind, setKind] = useState(first);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const debt = DEBT_KINDS.includes(kind);
  const bitcoin = kind === "bitcoin_wallet";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name")).trim();
    const limit = String(fields.get("credit_limit") ?? "").replace(/[$,\s]/g, "");
    const dueDay = String(fields.get("due_day") ?? "");
    setBusy(true);
    setError("");
    try {
      const created = await api<{ id: number }>("/accounts", "POST", {
        name,
        kind,
        currency: bitcoin ? "BITCOIN" : "USD",
        opening_balance: String(fields.get("balance") || "0").replace(/[$₿,\s]/g, ""),
        date: fields.get("date"),
      });
      if (kind === "credit_card" && (limit || dueDay))
        await api(`/accounts/${created.id}/card-terms`, "PUT", { credit_limit: limit || null, due_day: dueDay ? Number(dueDay) : null });
      onDone(`Added ${name}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet label="Add an account" onClose={onClose}>
      <h2>Add an account</h2>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <div className="sheet-fields">
          <label className="field">
            <span>Kind</span>
            <select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} data-autofocus>
              {ADD_KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={120} placeholder={bitcoin ? "Cold storage" : debt ? "Visa" : "Checking"} />
          </label>
          <label className="field">
            <span>{debt ? "Owed today" : bitcoin ? "Bitcoin held (₿)" : "Balance today"}</span>
            <input name="balance" className="num" inputMode="decimal" placeholder={bitcoin ? "0" : "0.00"} />
          </label>
          <label className="field">
            <span>As of</span>
            <input name="date" type="date" defaultValue={today} max={today} required />
          </label>
          {kind === "credit_card" && (
            <>
              <label className="field">
                <span>Credit limit</span>
                <input name="credit_limit" className="num" inputMode="decimal" placeholder="Optional" />
              </label>
              <label className="field">
                <span>Payment due day</span>
                <input name="due_day" className="num" type="number" min={1} max={31} placeholder="1–31" />
              </label>
            </>
          )}
        </div>
        <p className="hint">
          {bitcoin
            ? "Whole bitcoin units: ₿125,000 is the same as 0.00125 BTC."
            : kind === "credit_card"
              ? "The limit turns on the credit use light; the due day turns on the card due light."
              : "The starting balance is recorded as an opening entry on that date."}
        </p>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            Add account
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
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
                <input name="credit_limit" className="num" inputMode="decimal" placeholder="Not set" defaultValue={card?.limit ?? ""} />
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
                <input name="balance" className="num" inputMode="decimal" defaultValue={account.balance} />
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
