import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AmountInput } from "../lib/AmountInput";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { Sheet } from "../dashboard/Sheets";
import { cents, plural, shortDate, usd } from "../lib/format";
import { KIND, holdsShares, moment, money, native, signed, typed, untyped, valuedByHand } from "./shared";
import type { Account } from "./shared";

interface ActivityRow {
  id: number;
  date: string;
  kind: string;
  description: string;
  counterparty: string | null;
  direction: "in" | "out" | null;
  category: string | null;
  change: string;
  change_minor: string;
  balance: string;
  reverses_id: number | null;
  reversed: boolean;
}
interface Activity {
  account_id: number;
  balance: string;
  rows: ActivityRow[];
}
interface AssetRow {
  id: number;
  account_id: number;
  history: { date: string; value: string }[];
}

const PAGE = 20;
const ENTRY_KIND: Record<string, string> = {
  opening: "Opening balance",
  valuation: "Value update",
  adjustment: "Correction",
  reversal: "Reversal",
};

/** One account in full: what it holds, how it is valued, and every entry that moved its balance. */
export function AccountDetail({
  account,
  today,
  version,
  onActivity,
  onDone,
  onPay,
  onChange,
  onClose,
}: {
  account: Account;
  today: string;
  /** Bumped whenever the ledger changes, so the entries are read again. */
  version: number;
  onActivity: () => void;
  onDone: (message: string) => void;
  onPay: () => void;
  onChange: () => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [asset, setAsset] = useState<AssetRow | null | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [said, setSaid] = useState("");
  const shares = holdsShares(account);
  const byHand = !account.portfolio && account.role === "asset" && account.holding_type === "valued_asset";

  // Opening a different account moves the reader to it.
  useEffect(() => {
    setShown(PAGE);
    setSaid("");
    setProblem("");
    heading.current?.scrollIntoView?.({ block: "nearest" });
    heading.current?.focus({ preventScroll: true });
  }, [account.id]);

  useEffect(() => {
    let alive = true;
    api<Activity>(`/accounts/${account.id}/activity`)
      .then((next) => alive && setActivity(next))
      .catch((e) => alive && setProblem((e as Error).message));
    if (byHand)
      api<AssetRow[]>("/assets")
        .then((rows) => alive && setAsset(rows.find((row) => row.account_id === account.id) ?? null))
        .catch((e) => alive && setProblem((e as Error).message));
    else setAsset(undefined);
    return () => {
      alive = false;
    };
  }, [account.id, byHand, version]);

  async function refresh() {
    setRefreshing(true);
    setProblem("");
    setSaid("");
    try {
      const result = await api<{ changed: boolean }>("/investments/refresh", "POST");
      const message = result.changed ? "Quotes refreshed." : "Quotes were already refreshed in the last minute. Nothing changed.";
      setSaid(message);
      onDone(message);
    } catch (e) {
      // What is on screen stays as it was: the last saved quotes.
      setProblem((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const rows = activity?.account_id === account.id ? activity.rows : null;
  const portfolio = account.portfolio ?? null;
  const canValue = byHand && (valuedByHand(account) || !!asset);
  const history = asset ? [...asset.history].reverse() : [];

  return (
    <Panel className="c12" name="Account detail" plain={KIND[account.kind] ?? account.kind}>
      <div className="acc-head">
        <h2 ref={heading} tabIndex={-1}>
          {account.name}
        </h2>
        <span className={`acc-bal${account.currency === "BITCOIN" ? " btc" : ""}`}>
          {native(account)}
          {account.role === "liability" && <small className="sub"> owed</small>}
        </span>
        <span className="acc-grow" />
        <div className="acc-acts">
          {account.role === "liability" && (
            <button className="btn sm" onClick={onPay}>
              Record a payment
            </button>
          )}
          <button className="btn sm ghost" onClick={onChange}>
            Change
          </button>
          <button className="btn sm ghost" onClick={onClose} aria-label={`Close the detail for ${account.name}`}>
            Close
          </button>
        </div>
      </div>
      {problem && (
        <p className="gate-error" role="alert">
          {problem}
        </p>
      )}

      {shares && (
        <section className="acc-part" aria-label="Holdings">
          <h3>Holdings</h3>
          {portfolio ? (
            <>
              {portfolio.error && (
                <p className="sub">
                  <b className="warnc">The last quote update failed.</b> {portfolio.error} The values below are from the last quotes that were saved.
                </p>
              )}
              {portfolio.holdings.length ? (
                <div className="acc-scroll">
                  <table className="log">
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th className="r">Shares</th>
                        <th className="r">Last quote</th>
                        <th className="r">Value</th>
                        <th className="hide-s">Quoted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.holdings.map((holding) => {
                        const gain = holding.gain === null ? null : cents(holding.gain);
                        return (
                          <tr key={holding.symbol}>
                            <td>
                              <b>{holding.symbol}</b>
                            </td>
                            <td className="num r">{holding.shares}</td>
                            <td className="num r">
                              {holding.price === null ? <span className="tag miss">missing</span> : usd(holding.price)}
                              {holding.price !== null && holding.stale && (
                                <>
                                  {" "}
                                  <span className="tag miss">stale</span>
                                </>
                              )}
                            </td>
                            <td className="num r">
                              {usd(holding.value)}
                              {gain !== null && (
                                <small className={gain >= 0n ? "acc-up" : "acc-down"}>
                                  {signed(gain, "USD")} against cost
                                  {holding.gain_percent !== null && ` · ${holding.gain_percent}%`}
                                </small>
                              )}
                            </td>
                            <td className="dim hide-s">{moment(holding.observed_at) ?? "No quote saved"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="sub">No shares held. This account is uninvested cash only.</div>
              )}
              <div className="sub">
                Uninvested cash <b className="num">{usd(portfolio.cash)}</b> · quotes from {portfolio.source} · valued from shares since {shortDate(portfolio.started_on)}
              </div>
            </>
          ) : (
            <div className="sub">
              This account's value was entered by hand. Enter its shares and cash and it is valued from quotes instead; the entries already recorded stay as they are.
            </div>
          )}
          <div className="acc-acts">
            <button className="btn sm" onClick={() => setEditing(true)}>
              {portfolio ? "Edit holdings and cash" : "Set up holdings and cash"}
            </button>
            {portfolio && portfolio.holdings.length > 0 && (
              <button className="btn sm ghost" disabled={refreshing} onClick={() => void refresh()}>
                {refreshing ? "Fetching quotes…" : "Refresh quotes"}
              </button>
            )}
            {said && <span className="sub">{said}</span>}
          </div>
          <p className="hint">
            Quotes are fetched only when you press Refresh or save holdings. That sends the ticker symbols, and nothing else, to Yahoo Finance. A quote that is missing or
            stale is marked; no price is guessed. A value change from a quote is recorded as a dated value update, never as income.
          </p>
        </section>
      )}

      {byHand && !shares && (
        <section className="acc-part" aria-label="Value">
          <h3>Value</h3>
          {asset === undefined ? (
            <div className="meter" style={{ width: "30%" }} aria-busy="true">
              <i style={{ width: "100%", opacity: 0.25 }} />
            </div>
          ) : (
            <>
              {history.length ? (
                <ul className="acc-values" aria-label="Recorded values, newest first">
                  {history.map((item) => (
                    <li key={item.date}>
                      <span className="num dim">{item.date}</span>
                      <span className="num">{money(item.value, account.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="sub">No value has been recorded since the account was added. Its value is the opening balance, {native(account)}.</div>
              )}
              {canValue ? (
                <ValueForm account={account} asset={asset} today={today} onDone={onDone} />
              ) : (
                <div className="sub">This kind of account is not valued by hand here.</div>
              )}
            </>
          )}
        </section>
      )}

      <section className="acc-part" aria-label="Entries">
        <h3>Entries</h3>
        {rows === null ? (
          !problem && (
            <div className="meter" style={{ width: "30%" }} aria-busy="true">
              <i style={{ width: "100%", opacity: 0.25 }} />
            </div>
          )
        ) : rows.length ? (
          <>
            <div className="acc-scroll">
              <table className="log">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Entry</th>
                    <th className="r">Change</th>
                    <th className="r">{account.role === "liability" ? "Owed after" : "Balance after"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((row) => {
                    const change = BigInt(row.change_minor);
                    const about = [
                      ENTRY_KIND[row.kind],
                      row.counterparty && (row.direction === "in" ? `from ${row.counterparty}` : `to ${row.counterparty}`),
                      row.category,
                    ].filter(Boolean);
                    return (
                      <tr key={row.id}>
                        <td className="num dim">{row.date}</td>
                        <td className="w">
                          <span className={row.reversed ? "acc-struck" : undefined}>{row.description}</span>
                          {row.reversed && (
                            <>
                              {" "}
                              <span className="tag">reversed</span>
                            </>
                          )}
                          {about.length > 0 && <small>{about.join(" · ")}</small>}
                        </td>
                        <td className={`num r ${change >= 0n ? "acc-up" : "acc-down"}`}>{signed(change, account.currency)}</td>
                        <td className="num r">{money(row.balance, account.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="acc-acts">
              <span className="sub">
                Showing {Math.min(shown, rows.length)} of {plural(rows.length, "entry").replace("entrys", "entries")}, newest first
              </span>
              {shown < rows.length && (
                <button className="btn sm ghost" onClick={() => setShown(shown + PAGE)}>
                  Show more
                </button>
              )}
              <button className="inst-link" onClick={onActivity}>
                Change or remove entries in Transactions →
              </button>
            </div>
          </>
        ) : (
          <div className="sub">Nothing has been recorded on this account yet.</div>
        )}
      </section>

      {editing && (
        <HoldingsSheet
          account={account}
          onClose={() => setEditing(false)}
          onDone={(message) => {
            setEditing(false);
            setSaid(message);
            onDone(message);
          }}
        />
      )}
    </Panel>
  );
}

/** A new value for something valued by hand. It is a dated record after the last one; earlier values are never rewritten. */
function ValueForm({ account, asset, today, onDone }: { account: Account; asset: AssetRow | null; today: string; onDone: (message: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const last = asset?.history.length ? asset.history[asset.history.length - 1].date : null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const date = String(fields.get("date"));
    const value = typed(String(fields.get("value")), account.currency);
    if (value === null) return setError(account.currency === "USD" ? "Enter the whole value as dollars, like 412500 or 412500.50" : "Enter the whole value in bitcoin units, like 125000");
    if (date > today) return setError("A value cannot be dated in the future.");
    if (last && date <= last) return setError(`A new value must be dated after the last one, ${last}. Earlier values are never rewritten.`);
    setBusy(true);
    setError("");
    try {
      await api(asset ? `/assets/${asset.id}/valuations` : `/accounts/${account.id}/valuations`, "POST", { date, value: untyped(value, account.currency) });
      form.reset();
      onDone(`Recorded a new value for ${account.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="acc-form" onSubmit={save} aria-label={`New value for ${account.name}`}>
      <label className="field">
        <span>Worth now{account.currency === "BITCOIN" ? " (₿)" : ""}</span>
        <AmountInput name="value" placeholder={account.currency === "BITCOIN" ? "0" : "0.00"} required />
      </label>
      <label className="field">
        <span>As of</span>
        <input name="date" type="date" defaultValue={today} max={today} required />
      </label>
      <button className="btn sm" disabled={busy}>
        Record value
      </button>
      <p className="hint" style={{ flexBasis: "100%", margin: 0 }}>
        Enter the whole value, not the change. The difference from the last value is recorded as a dated value update, never as income or spending.
      </p>
      {error && (
        <p className="gate-error" role="alert" style={{ flexBasis: "100%", margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}

interface Line {
  symbol: string;
  shares: string;
  cost: string;
}
const TICKER = /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/;

/** Shares and uninvested cash for an account valued from quotes. */
function HoldingsSheet({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: (message: string) => void }) {
  const [lines, setLines] = useState<Line[]>(() =>
    account.portfolio
      ? account.portfolio.holdings.map((holding) => ({ symbol: holding.symbol, shares: holding.shares, cost: holding.cost_basis ?? "" }))
      : [{ symbol: TICKER.test(account.name) ? account.name : (account.name.match(/\(([A-Z][A-Z0-9.-]{0,9})\)/)?.[1] ?? ""), shares: "", cost: "" }],
  );
  const [cash, setCash] = useState(account.portfolio?.cash ?? "0.00");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (index: number, field: keyof Line, value: string) => setLines(lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const holdings: { symbol: string; shares: string; cost_basis: string | null }[] = [];
    for (const [index, line] of lines.entries()) {
      const symbol = line.symbol.trim().toUpperCase();
      const shares = line.shares.replace(/[,\s]/g, "");
      const cost = line.cost.trim() === "" ? null : typed(line.cost, "USD");
      if (!TICKER.test(symbol)) return setError(`Holding ${index + 1}: enter the ticker symbol, like VTI.`);
      if (!/^\d+(\.\d{1,8})?$/.test(shares) || /^0+(\.0+)?$/.test(shares)) return setError(`${symbol}: enter the number of shares, with up to eight decimals.`);
      if (line.cost.trim() !== "" && cost === null) return setError(`${symbol}: enter the total cost as dollars and cents, or leave it empty.`);
      if (holdings.some((other) => other.symbol === symbol)) return setError(`${symbol} is listed twice. Enter each ticker once.`);
      holdings.push({ symbol, shares, cost_basis: cost === null ? null : untyped(cost, "USD") });
    }
    const uninvested = typed(cash.trim() === "" ? "0" : cash, "USD");
    if (uninvested === null) return setError("Enter the uninvested cash as dollars and cents.");
    setBusy(true);
    setError("");
    try {
      await api(`/accounts/${account.id}/holdings`, "PUT", { cash: untyped(uninvested, "USD"), holdings });
      onDone(`Holdings saved for ${account.name}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const title = `Holdings in ${account.name}`;
  return (
    <Sheet label={title} onClose={onClose}>
      <h2>{title}</h2>
      <p className="sub">
        {account.portfolio
          ? "Value is shares × the latest quote, plus cash. Keep this current after trades or splits."
          : `This replaces the hand-entered value of ${native(account)} with the value of the shares and cash below. Entries already recorded are kept.`}
      </p>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <div className="acc-holdings">
          {lines.map((line, index) => (
            <div className="acc-holding" key={index}>
              <label className="field">
                <span>Ticker {index + 1}</span>
                <input value={line.symbol} maxLength={15} placeholder="VTI" autoCapitalize="characters" onChange={(event) => update(index, "symbol", event.target.value)} required data-autofocus={index === 0 ? true : undefined} />
              </label>
              <label className="field">
                <span>Shares {index + 1}</span>
                <input className="num" value={line.shares} inputMode="decimal" placeholder="10.5" onChange={(event) => update(index, "shares", event.target.value)} required />
              </label>
              <label className="field">
                <span>Total cost {index + 1}</span>
                <input className="num" value={line.cost} inputMode="decimal" placeholder="Optional" onChange={(event) => update(index, "cost", event.target.value)} />
              </label>
              <button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, i) => i !== index))} aria-label={`Remove holding ${index + 1}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="sheet-fields">
          <label className="field">
            <span>Uninvested cash</span>
            <input className="num" value={cash} inputMode="decimal" onChange={(event) => setCash(event.target.value)} />
          </label>
          <div style={{ alignSelf: "end" }}>
            <button type="button" className="btn sm" disabled={lines.length >= 25} onClick={() => setLines([...lines, { symbol: "", shares: "", cost: "" }])}>
              Add a holding
            </button>
          </div>
        </div>
        <p className="hint">
          Saving fetches a quote for each ticker from Yahoo Finance. Only the ticker symbols are sent; share counts and cost stay here. If any quote cannot be fetched,
          nothing is saved. Total cost is what you paid for the shares you still hold, not per share. Use a transfer in Transactions for deposits and withdrawals.
        </p>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="btn primary" disabled={busy}>
            {busy ? "Fetching quotes…" : "Save and fetch quotes"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </Sheet>
  );
}
