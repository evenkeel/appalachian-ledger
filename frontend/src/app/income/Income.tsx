import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { btc, longMonth, monthYear, plural, shortDate, shortMonthYear, usd } from "../lib/format";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";
import type { Lens } from "../lib/session";
import "./income.css";

interface Total {
  usd: string | null;
  bitcoin: string | null;
  missing_usd: number;
  missing_bitcoin: number;
  paychecks: number;
}
interface Expected {
  date: string;
  expected: string;
  actual: string | null;
  received_on: string | null;
  status: "received" | "short" | "late" | "missing" | "due";
  days_late: number;
  short_by: string | null;
}
export interface Source {
  id: number;
  name: string;
  ended_on: string | null;
  category: string | null;
  currency: "USD" | "BITCOIN";
  paychecks: number;
  first_date: string | null;
  last_date: string | null;
  typical: string | null;
  year: Total;
  all_time: Total;
  expected: { schedule: { id: number; name: string; amount: string; frequency: string; next_occurrence: string | null; currency: "USD" | "BITCOIN" }; paychecks: Expected[] }[];
}
export interface Month extends Total {
  month: string;
  sources: Record<string, Total>;
  saved_usd: string;
  saved_bitcoin: string;
  stack_rate: string | null;
}
export interface IncomeData {
  today: string;
  status: "ready" | "needs_income";
  months_of_history: number;
  sources: Source[];
  months: Month[];
  changes: { date: string; kind: "raise" | "cut" | "job"; source_id: number; source: string; direction: "up" | "down"; text: string }[];
  problems: { source: string; status: string; date: string }[];
  recent: { id: number; date: string; description: string; source_id: number; usd: string | null; bitcoin: string | null }[];
}

/** A total in the chosen unit. One with a paycheck that has no saved price says so; it is never estimated. */
const money = (lens: Lens, total: { usd: string | null; bitcoin: string | null }) => {
  const value = lens === "USD" ? total.usd : total.bitcoin;
  return value === null ? "No price" : lens === "USD" ? usd(value) : btc(value);
};
const amount = (currency: "USD" | "BITCOIN", value: string | null) => (currency === "USD" ? usd(value) : btc(value));
const missing = (lens: Lens, total: Total) => (lens === "USD" ? total.missing_usd : total.missing_bitcoin);
const STATUS: Record<Expected["status"], string> = { received: "Arrived", short: "Short", late: "Late", missing: "Missing", due: "Due today" };

/** Your pay over the years: who pays, how much, whether it came, and how much became bitcoin. */
export function Income({ go, onChanged }: { go: (route: Route, sub?: string) => void; onChanged?: () => void }) {
  const { lens } = useSession();
  const [data, setData] = useState<IncomeData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<IncomeData>("/income")
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  const changed = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  if (!data)
    return (
      <div className="page">
        <h1>Income</h1>
        {error ? (
          <p className="gate-error" role="alert">
            {error}{" "}
            <button className="inst-link" onClick={load}>
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

  if (data.status === "needs_income")
    return (
      <div className="page">
        <h1>Income</h1>
        <div className="grid2">
          <Panel className="c7" name="No income recorded yet" plain="nothing to show" inop>
            <div className="lead">Record your first paycheck and this screen starts working.</div>
            <div className="sub">
              Each job or side gig becomes its own source. You will see what each one pays month by month, in dollars and in bitcoin, whether a paycheck came in late or short, and how much of
              each month's income you turned into bitcoin.
            </div>
            <div>
              <button className="btn primary" onClick={() => go("activity")}>
                Record income
              </button>
            </div>
          </Panel>
        </div>
      </div>
    );

  const month = data.months[data.months.length - 1];
  const year = data.months.slice(-12);
  const yearTotal = sum(year);
  return (
    <div className="page">
      <h1>Income</h1>
      <p className="intro">What you were paid, by source and by month, each paycheck at the bitcoin price of the day it arrived. Switch between $ and ₿ at the top.</p>
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      <div className="grid2">
        <Panel className="c4" name="This month" plain={longMonth(month.month)}>
          <div className={`num hero${lens === "BITCOIN" ? " btc" : ""}`}>{money(lens, month)}</div>
          <div className="sub">
            {month.paychecks === 0 ? "No income recorded yet this month." : `${plural(month.paychecks, "paycheck")} recorded.`}
            {missing(lens, month) > 0 && ` ${plural(missing(lens, month), "paycheck")} had no saved price, so there is no total in bitcoin.`}
          </div>
          <div className="kv inc-kv">
            <div>
              <span>{year.length < 12 ? `Last ${plural(year.length, "month")}` : "Last 12 months"}</span>
              <b className={`num${lens === "BITCOIN" ? " btc" : ""}`}>{money(lens, yearTotal)}</b>
            </div>
            <div>
              <span>Saved in bitcoin this month</span>
              <b className="num btc">{month.stack_rate === null ? "—" : `${month.stack_rate}%`}</b>
            </div>
          </div>
        </Panel>
        <HistoryPanel className="c8" data={data} lens={lens} />
        <SourcesPanel className="c7" data={data} lens={lens} onChanged={changed} onError={setError} />
        <ChangesPanel className="c5" data={data} />
        <ExpectedPanel className="c7" data={data} go={go} />
        <SavedPanel className="c5" data={data} lens={lens} go={go} />
      </div>
    </div>
  );
}

function sum(months: Month[]) {
  let dollars = 0n;
  let coins = 0n;
  let lostUsd = 0;
  let lostBitcoin = 0;
  for (const month of months) {
    if (month.usd === null) lostUsd += month.missing_usd;
    else dollars += BigInt(month.usd.replace(".", ""));
    if (month.bitcoin === null) lostBitcoin += month.missing_bitcoin;
    else coins += BigInt(month.bitcoin);
  }
  const cents = dollars.toString().padStart(3, "0");
  return {
    usd: lostUsd ? null : `${cents.slice(0, -2)}.${cents.slice(-2)}`,
    bitcoin: lostBitcoin ? null : coins.toString(),
    missing_usd: lostUsd,
    missing_bitcoin: lostBitcoin,
    paychecks: 0,
  };
}

/** One bar a month, split by source. A month with a paycheck that has no saved price is drawn empty, never guessed. */
function HistoryPanel({ className, data, lens }: { className: string; data: IncomeData; lens: Lens }) {
  const [at, setAt] = useState<number | null>(null);
  const months = data.months;
  const unit = lens === "USD" ? "usd" : "bitcoin";
  const value = (total: Total | undefined) => (total && total[unit] !== null ? Number(total[unit]) : 0);
  const top = Math.max(...months.map((month) => value(month)), 1);
  const sources = data.sources.slice(0, 4);
  const gaps = months.filter((month) => month[unit] === null).length;
  const shown = at === null ? null : months[at];
  const width = 100 / months.length;
  return (
    <Panel className={className} name="Income by month" plain={months.length > 1 ? `${shortMonthYear(months[0].month)} to ${shortMonthYear(months[months.length - 1].month)}` : longMonth(months[0].month)}>
      <div className="inc-read sub" aria-live="polite">
        {shown ? (
          <>
            <b>{monthYear(shown.month)}</b> · <span className={`num${lens === "BITCOIN" ? " btc" : ""}`}>{money(lens, shown)}</span>
            {shown[unit] === null && ` · ${plural(missing(lens, shown), "paycheck")} with no saved price`}
            {sources
              .filter((source) => shown.sources[source.id])
              .map((source) => (
                <span key={source.id}>
                  {" "}
                  · {source.name} {money(lens, shown.sources[source.id])}
                </span>
              ))}
          </>
        ) : months.length < 3 ? (
          "Each month you record adds a bar. Trends show once there are a few months to compare."
        ) : (
          "Point at a month to read it."
        )}
      </div>
      <svg className="inc-chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`Income by month in ${lens === "USD" ? "dollars" : "bitcoin"}, ${plural(months.length, "month")}.`} onMouseLeave={() => setAt(null)}>
        {months.map((month, index) => {
          let floor = 40;
          const parts = sources.map((source, order) => {
            const height = (value(month.sources[source.id]) / top) * 38;
            floor -= height;
            return <rect key={source.id} className={`inc-s${order}`} x={index * width + width * 0.12} y={floor} width={width * 0.76} height={height} />;
          });
          const rest = (value(month) / top) * 38 - (40 - floor);
          return (
            <g key={month.month} onMouseEnter={() => setAt(index)} opacity={at === null || at === index ? 1 : 0.55}>
              <rect x={index * width} y={0} width={width} height={40} fill="transparent" />
              {month[unit] === null ? <rect className="inc-gap" x={index * width + width * 0.12} y={2} width={width * 0.76} height={38} /> : parts}
              {month[unit] !== null && rest > 0.05 && <rect className="inc-rest" x={index * width + width * 0.12} y={floor - rest} width={width * 0.76} height={rest} />}
            </g>
          );
        })}
      </svg>
      <div className="inc-legend sub">
        {sources.map((source, order) => (
          <span key={source.id}>
            <i className={`inc-s${order}`} /> {source.name}
          </span>
        ))}
        {data.sources.length > sources.length && (
          <span>
            <i className="inc-rest" /> Everything else
          </span>
        )}
        {gaps > 0 && (
          <span>
            <i className="inc-gap" /> {plural(gaps, "month")} with a paycheck that has no saved {lens === "USD" ? "dollar" : "bitcoin"} price
          </span>
        )}
      </div>
    </Panel>
  );
}

function SourcesPanel({ className, data, lens, onChanged, onError }: { className: string; data: IncomeData; lens: Lens; onChanged: () => void; onError: (message: string) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (work: Promise<unknown>) => {
    setBusy(true);
    onError("");
    work
      .then(() => {
        setEditing(null);
        onChanged();
      })
      .catch((e) => onError((e as Error).message))
      .finally(() => setBusy(false));
  };
  function save(source: Source, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const into = Number(form.get("into") || 0);
    if (into) return run(api(`/income/sources/${source.id}/merge`, "POST", { into }));
    run(api(`/income/sources/${source.id}`, "PUT", { name: String(form.get("name") ?? ""), ended_on: form.get("ended_on") || null }));
  }
  return (
    <Panel className={className} name="Where it comes from" plain="each job, side gig or other income">
      <ul className="rows inc-sources">
        {data.sources.map((source) => (
          <li key={source.id}>
            <div className="inc-source">
              <span className="nm">
                {source.name}
                {source.ended_on && <span className="tag">Ended {shortDate(source.ended_on)}</span>}
              </span>
              <small>
                {plural(source.paychecks, "paycheck")}
                {source.first_date && ` since ${shortMonthYear(source.first_date.slice(0, 7))}`}
                {source.typical && ` · a typical one is ${amount(source.currency, source.typical)}`}
              </small>
            </div>
            <span className={`num r${lens === "BITCOIN" ? " btc" : ""}`} title="Last 12 months">
              {money(lens, source.year)}
            </span>
            <button className="btn sm" onClick={() => setEditing(editing === source.id ? null : source.id)} aria-expanded={editing === source.id}>
              Change
            </button>
            {editing === source.id && (
              <form className="inc-edit" onSubmit={(event) => save(source, event)} aria-label={`Change ${source.name}`}>
                <label className="field">
                  <span>Name</span>
                  <input name="name" defaultValue={source.name} maxLength={120} required />
                </label>
                <label className="field">
                  <span>Ended on (leave empty if it still pays)</span>
                  <input name="ended_on" type="date" defaultValue={source.ended_on ?? ""} max={data.today} />
                </label>
                {data.sources.length > 1 && (
                  <label className="field">
                    <span>Or merge into another source</span>
                    <select name="into" defaultValue="">
                      <option value="">Keep it on its own</option>
                      {data.sources
                        .filter((other) => other.id !== source.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <div className="sub">Renaming, ending or merging keeps every paycheck already recorded.</div>
                <div className="inc-actions">
                  <button className="btn primary sm" disabled={busy}>
                    Save
                  </button>
                  <button type="button" className="btn sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      <div className="sub">The figure on the right is the last 12 months. A new paycheck joins a source by its description; change a source here if two names are the same job.</div>
    </Panel>
  );
}

function ChangesPanel({ className, data }: { className: string; data: IncomeData }) {
  const several = data.sources.filter((source) => !source.ended_on).length > 1;
  return (
    <Panel className={className} name="Raises and cuts" plain="when your usual paycheck changed">
      {data.changes.length === 0 ? (
        <div className="sub">
          {data.months_of_history < 3
            ? "A raise or a cut shows here once a paycheck amount has repeated and then changed. There is not enough history yet."
            : "No change in your usual paycheck so far. One-off overtime or a short week is not counted as a raise or a cut."}
        </div>
      ) : (
        <ul className="rows inc-changes">
          {data.changes.map((change) => (
            <li key={`${change.source_id}-${change.date}-${change.kind}`}>
              <span className={`inc-dir ${change.direction}`} aria-hidden="true">
                {change.direction === "up" ? "▲" : "▼"}
              </span>
              <div className="inc-source">
                <span className="nm">{change.text}</span>
                {(several || change.kind === "job") && <small>{change.source}</small>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ExpectedPanel({ className, data, go }: { className: string; data: IncomeData; go: (route: Route, sub?: string) => void }) {
  const scheduled = data.sources.filter((source) => source.expected.length > 0);
  return (
    <Panel className={className} name="Expected and actual" plain="each pay schedule against what came in">
      {scheduled.length === 0 ? (
        <>
          <div className="sub">Tell the app what you expect to be paid and when. It then checks each payday and warns you when a paycheck is late, short or missing.</div>
          <div>
            <button className="btn" onClick={() => go("dashboard")}>
              Add the income you expect
            </button>
          </div>
        </>
      ) : (
        scheduled.map((source) =>
          source.expected.map(({ schedule, paychecks }) => (
            <div key={schedule.id} className="inc-expected">
              <div className="split">
                <b>{source.name}</b>
                <span className="sub num">
                  {amount(schedule.currency, schedule.amount)} {schedule.frequency}
                  {schedule.next_occurrence && ` · next ${shortDate(schedule.next_occurrence)}`}
                </span>
              </div>
              {paychecks.length === 0 ? (
                <div className="sub">Nothing to compare yet. Record a paycheck from this source and each payday after it is checked.</div>
              ) : (
                <ul className="rows">
                  {[...paychecks].reverse().map((row) => (
                    <li key={row.date}>
                      <span className="nm">{shortDate(row.date)}</span>
                      <span className={`tag inc-${row.status}`}>{STATUS[row.status]}</span>
                      <small>
                        {row.status === "short" && `${amount(schedule.currency, row.short_by)} under`}
                        {(row.status === "late" || row.status === "missing") && `${plural(row.days_late, "day")} late, nothing recorded`}
                        {row.status === "received" && row.received_on !== row.date && row.received_on && `came ${shortDate(row.received_on)}`}
                      </small>
                      <span className="num r">{row.actual ? amount(schedule.currency, row.actual) : "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )),
        )
      )}
    </Panel>
  );
}

/** The stack rate over time: what part of each month's income became bitcoin. */
function SavedPanel({ className, data, lens, go }: { className: string; data: IncomeData; lens: Lens; go: (route: Route, sub?: string) => void }) {
  const [all, setAll] = useState(false);
  const months = [...data.months].reverse();
  const shown = all ? months : months.slice(0, 12);
  return (
    <Panel className={className} name="Share saved in bitcoin" plain="of each month's income" link={{ label: "Stack", onClick: () => go("stack") }}>
      <table className="inc-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="r">Income</th>
            <th className="r">Into bitcoin</th>
            <th className="r">Share</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((month) => (
            <tr key={month.month}>
              <td>{shortMonthYear(month.month)}</td>
              <td className={`num r${lens === "BITCOIN" ? " btc" : ""}`}>{money(lens, month)}</td>
              <td className="num r btc">{lens === "USD" ? usd(month.saved_usd) : btc(month.saved_bitcoin)}</td>
              <td className="num r">{month.stack_rate === null ? "—" : `${month.stack_rate}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {months.length > 12 && (
        <button className="inst-link" onClick={() => setAll(!all)}>
          {all ? "Show the last 12 months" : `Show all ${months.length} months`}
        </button>
      )}
      <div className="sub">"No price" means a paycheck that month has no saved price for its day. Nothing is filled in from today's price.</div>
    </Panel>
  );
}
