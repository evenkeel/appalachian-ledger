import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { shift } from "../dashboard/charts";
import { Panel } from "../dashboard/panels";
import type { DashboardData } from "../dashboard/types";
import { btc, coordinate, longMonth, monthName, plural, shortDate, usd } from "../lib/format";
import type { Lens } from "../lib/session";

interface Sum {
  count: number;
  usd: string | null;
  bitcoin: string | null;
  missing_usd: number;
  missing_bitcoin: number;
}
interface Entry {
  id: number;
  date: string;
  description: string;
  category: string;
  account: string;
  amount: string;
  currency: "USD" | "BITCOIN";
  usd: string | null;
  bitcoin: string | null;
}
interface History {
  totals: Sum;
  periods: (Sum & { period: string })[];
  categories: (Sum & { name: string })[];
  transactions: Entry[];
  transactions_truncated: boolean;
}

const lastDay = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}`;
};
const SHOWN = 40;

/** Spending by month for up to a year, and the categories and entries behind any month. */
export function HistoryPanel({ className, data, lens }: { className?: string; data: DashboardData; lens: Lens }) {
  const first = data.first_entry_date?.slice(0, 7) ?? null;
  const earliest = shift(data.month, -11);
  const from = first && first > earliest ? first : earliest;
  const [range, setRange] = useState<History | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState<History | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!first) return;
    let alive = true;
    api<History>(`/spending-history?start=${from}-01&end=${data.today}&interval=month`)
      .then((next) => alive && (setRange(next), setError("")))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [first, from, data.today, data.bills.paid_this_month.count]);

  useEffect(() => {
    if (!picked) return;
    let alive = true;
    setDetail(null);
    setAll(false);
    api<History>(`/spending-history?start=${picked}-01&end=${picked === data.month ? data.today : lastDay(picked)}&interval=month`)
      .then((next) => alive && (setDetail(next), setError("")))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [picked, data.month, data.today]);

  const value = (sum: Sum) => (lens === "USD" ? sum.usd : sum.missing_bitcoin > 0 ? null : sum.bitcoin);
  const show = (amount: string | null) => (amount === null ? "Partial" : lens === "USD" ? usd(amount) : btc(amount));

  if (!first)
    return (
      <Panel className={className} name="By month" plain="up to a year" inop>
        <div className="sub">Record an expense and the months build up here, each one openable to its categories and entries.</div>
      </Panel>
    );

  // Every month in the range gets a column, including months with nothing spent.
  const months: string[] = [];
  for (let month = from; month <= data.month; month = shift(month, 1)) months.push(month);
  const byMonth = new Map((range?.periods ?? []).map((period) => [period.period, period]));
  const top = Math.max(1, ...months.map((month) => coordinate(byMonth.get(month) ? value(byMonth.get(month)!) : null)));
  const rows = detail ? (all ? detail.transactions : detail.transactions.slice(0, SHOWN)) : [];
  const ranked = detail ? [...detail.categories].sort((a, b) => coordinate(value(b)) - coordinate(value(a))) : [];
  const most = Math.max(1, ...ranked.map((category) => coordinate(value(category))));

  return (
    <Panel className={className} name="By month" plain={`${lens === "USD" ? "in dollars" : "in bitcoin, at each day's price"} · select a month`}>
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      <div className={`hist${lens === "BITCOIN" ? " btc" : ""}`} role="group" aria-label="Spending by month">
        {months.map((month) => {
          const sum = byMonth.get(month);
          const amount = sum ? value(sum) : lens === "USD" ? "0.00" : "0";
          const height = amount === null ? 100 : (coordinate(amount) / top) * 100;
          const label = `${longMonth(month)} ${month.slice(0, 4)}: ${amount === null ? `partial, ${plural(sum!.missing_bitcoin, "entry").replace("entrys", "entries")} without a bitcoin price` : show(amount)}${month === data.month ? ", so far" : ""}`;
          return (
            <button key={month} aria-pressed={picked === month} aria-label={label} title={label} onClick={() => setPicked(picked === month ? null : month)}>
              <span className="hist-v num">{amount === null ? "Partial" : lens === "USD" ? usdShort(amount) : btcShort(amount)}</span>
              <span className="hist-col">
                <i className={amount === null ? "partial" : month === data.month ? "now" : undefined} style={{ height: `${Math.max(height, amount === null ? 100 : 1.5).toFixed(1)}%` }} />
              </span>
              <span className="hist-m">
                {monthName(month)}
                {month.endsWith("-01") || month === from ? ` ’${month.slice(2, 4)}` : ""}
              </span>
            </button>
          );
        })}
      </div>
      {!picked ? (
        <div className="hint">
          {lens === "BITCOIN"
            ? "Each expense is priced on the day it was paid. A month with any unpriced expense reads Partial, not a guessed total."
            : "The current month is the amount so far."}
        </div>
      ) : !detail ? (
        <div className="meter" aria-busy="true">
          <i style={{ width: "100%", opacity: 0.25 }} />
        </div>
      ) : (
        <div className="hist-detail" aria-live="polite">
          <div className="split" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "4px 12px" }}>
            <b className="lead">
              {longMonth(picked)} {picked.slice(0, 4)}
              {picked === data.month ? " so far" : ""}
            </b>
            <span className="sub num">
              <b style={{ color: lens === "USD" ? "var(--ink)" : "var(--btc)" }}>{show(value(detail.totals))}</b> · {plural(detail.totals.count, "entry").replace("entrys", "entries")}
              {lens === "BITCOIN" && detail.totals.missing_bitcoin > 0 && ` · ${detail.totals.missing_bitcoin} without a bitcoin price`}
            </span>
          </div>
          {detail.totals.count === 0 ? (
            <div className="sub">Nothing was spent in {longMonth(picked)}.</div>
          ) : (
            <div className="hist-two">
              <ul className="hist-cats" aria-label={`Categories in ${longMonth(picked)}`}>
                {ranked.map((category) => (
                  <li key={category.name}>
                    <span className="nm">{category.name}</span>
                    <span className="num">{show(value(category))}</span>
                    <span className="bar" aria-hidden="true">
                      <i style={{ width: `${((coordinate(value(category)) / most) * 100).toFixed(1)}%`, background: lens === "USD" ? "var(--usd)" : "var(--btc)" }} />
                    </span>
                  </li>
                ))}
              </ul>
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <table className="log">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entry</th>
                      <th className="hide-s">Category</th>
                      <th className="r">Dollars</th>
                      <th className="r">Bitcoin that day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="num dim">{shortDate(row.date)}</td>
                        <td className="w">{row.description}</td>
                        <td className="hide-s">
                          <span className="tag">{row.category}</span>
                        </td>
                        <td className="num r">{row.usd === null ? <span className="tag miss">no price</span> : usd(row.usd)}</td>
                        <td className="num r">{row.bitcoin === null ? <span className="tag miss">no price</span> : btc(row.bitcoin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(detail.transactions.length > SHOWN || detail.transactions_truncated) && (
                  <div className="sub" style={{ paddingTop: 6 }}>
                    {!all && detail.transactions.length > SHOWN ? (
                      <button className="inst-link" onClick={() => setAll(true)}>
                        Show all {detail.transactions.length} →
                      </button>
                    ) : (
                      detail.transactions_truncated && "Showing the first 500 entries of this month."
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Compact labels above the bars. Labels only; the exact figure is in the month's detail. */
function usdShort(amount: string) {
  const dollars = BigInt(amount.split(".")[0]);
  if (dollars >= 10_000n) return `$${(dollars + 500n) / 1000n}k`;
  return `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
function btcShort(amount: string) {
  const units = BigInt(amount);
  if (units >= 10_000_000n) return `₿${(units + 500_000n) / 1_000_000n}M`;
  if (units >= 1_000_000n) return `₿${units / 1_000_000n}.${(units % 1_000_000n) / 100_000n}M`;
  if (units >= 10_000n) return `₿${(units + 500n) / 1000n}k`;
  return btc(amount);
}
