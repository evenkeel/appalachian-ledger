import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { lastDay } from "../dashboard/history";
import { Panel } from "../dashboard/panels";
import type { DashboardData } from "../dashboard/types";
import { Choice, Pager, monthsBetween, partOfYear } from "../design/timeline";
import { btc, cents, coordinate, fromCents, longMonth, monthName, monthYear, plural, shortDate, usd } from "../lib/format";
import type { Lens } from "../lib/session";
import "./history.css";

interface Sum {
  count: number;
  usd: string | null;
  bitcoin: string | null;
  missing_usd: number;
  missing_bitcoin: number;
}
export interface Entry {
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
export interface History {
  totals: Sum;
  periods: (Sum & { period: string })[];
  categories: (Sum & { name: string })[];
  transactions: Entry[];
  transactions_truncated: boolean;
}
type View = "months" | "years";

const SHOWN = 40;
const entries = (count: number) => plural(count, "entry").replace("entrys", "entries");

/** An amount shared evenly over some months, to the cent or the whole bitcoin, rounded half to even. */
export function monthlyAverage(amount: string, months: number, lens: Lens) {
  const total = lens === "USD" ? cents(amount) : BigInt(amount.split(".")[0]);
  const by = BigInt(Math.max(1, months));
  const whole = total / by,
    twice = (total % by) * 2n;
  const rounded = twice > by || (twice === by && whole % 2n === 1n) ? whole + 1n : whole;
  return lens === "USD" ? fromCents(rounded) : rounded.toString();
}

/** Spending for every month and every year on record, and the categories and entries behind any month. */
export function HistoryPanel({ className, data, lens }: { className?: string; data: DashboardData; lens: Lens }) {
  const first = data.first_entry_date?.slice(0, 7) ?? null;
  const thisYear = data.month.slice(0, 4);
  const [view, setView] = useState<View>("months");
  const [year, setYear] = useState(thisYear);
  const [byMonthData, setByMonthData] = useState<History | null>(null);
  const [byYearData, setByYearData] = useState<History | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState<History | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState("");

  // Sums only, for every month since the first entry: paging through the years then needs no further request.
  useEffect(() => {
    if (!first) return;
    let alive = true;
    api<History>(`/spending-history?start=${first}-01&end=${data.today}&interval=month&summary=true`)
      .then((next) => alive && (setByMonthData(next), setError("")))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [first, data.today, data.bills.paid_this_month.count]);

  // Year totals are summed by the ledger, entry by entry, the first time the years are asked for.
  const wantYears = view === "years";
  useEffect(() => {
    if (!first || !wantYears) return;
    let alive = true;
    api<History>(`/spending-history?start=${first}-01&end=${data.today}&interval=year&summary=true`)
      .then((next) => alive && (setByYearData(next), setError("")))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [first, wantYears, data.today, data.bills.paid_this_month.count]);

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
  const short = (amount: string) => (lens === "USD" ? usdShort(amount) : btcShort(amount));
  const zero = lens === "USD" ? "0.00" : "0";
  const unit = lens === "USD" ? "in dollars" : "in bitcoin, at each day's price";

  if (!first)
    return (
      <Panel className={className} name="Spending history" plain="by month and by year" inop>
        <div className="sub">Record an expense and the months build up here, each one openable to its categories and entries.</div>
      </Panel>
    );

  const recorded = monthsBetween(first, data.month);
  const years = [...new Set(recorded.map((month) => month.slice(0, 4)))];
  const at = Math.max(0, years.indexOf(year));
  const byMonth = new Map((byMonthData?.periods ?? []).map((period) => [period.period, period]));
  const byYear = new Map((byYearData?.periods ?? []).map((period) => [period.period, period]));
  const amountOf = (sum: Sum | undefined) => (sum ? value(sum) : zero);
  // One scale for every page, so a tall year still looks tall after paging away from it.
  const topMonth = Math.max(1, ...recorded.map((month) => coordinate(amountOf(byMonth.get(month)))));
  const topYear = Math.max(1, ...years.map((each) => coordinate(amountOf(byYear.get(each)))));
  const inYear = (each: string) => recorded.filter((month) => month.startsWith(each));
  /** What a year that is not whole covers: "so far" for this one, its months for the first. */
  const part = (each: string) => {
    const months = inYear(each);
    if (each === thisYear) return { short: "so far", long: `so far, through ${longMonth(data.month)}` };
    if (months.length < 12) return { short: months.length === 1 ? monthName(months[0]) : `${monthName(months[0])}–${monthName(months[months.length - 1])}`, long: `a partial year, ${partOfYear(months[0], months[months.length - 1])} only` };
    return null;
  };
  const rows = detail ? (all ? detail.transactions : detail.transactions.slice(0, SHOWN)) : [];
  const ranked = detail ? [...detail.categories].sort((a, b) => coordinate(value(b)) - coordinate(value(a))) : [];
  const most = Math.max(1, ...ranked.map((category) => coordinate(value(category))));
  const open = (each: string) => {
    setYear(each);
    setView("months");
    setPicked(null);
  };
  // The year on the page, summed from its months so the heading is right before the years are ever asked for.
  const pageMonths = inYear(years[at]);
  const pageSums = pageMonths.map((month) => amountOf(byMonth.get(month)));
  const pageTotal = pageSums.some((amount) => amount === null)
    ? null
    : lens === "USD"
      ? fromCents(pageSums.reduce((sum, amount) => sum + cents(amount!), 0n))
      : pageSums.reduce((sum, amount) => sum + BigInt(amount!.split(".")[0]), 0n).toString();

  return (
    <Panel className={className} name="Spending history" plain={`${unit} · ${view === "months" ? "select a month" : "select a year"}`}>
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      <div className="tl-range">
        <Choice
          label="Spending history: months or years"
          options={[
            { value: "months", label: "Months" },
            { value: "years", label: "Years" },
          ]}
          value={view}
          onChange={(next) => {
            setView(next);
            setPicked(null);
          }}
        />
        {view === "months" ? (
          <>
            <span className="sub num hist-sum" aria-live="polite" style={byMonthData ? undefined : { visibility: "hidden" }}>
              {years[at]}
              {part(years[at]) ? ` ${part(years[at])!.short}` : ""} · <b style={{ color: lens === "USD" ? "var(--ink)" : "var(--btc)" }}>{show(pageTotal)}</b>
              {pageTotal !== null && pageMonths.length > 1 && ` · ${show(monthlyAverage(pageTotal, pageMonths.length, lens))} a month on average`}
            </span>
            <Pager
              label="Spending history: which year"
              what="year"
              earlier={at > 0}
              later={at < years.length - 1}
              onStep={(direction) => {
                setYear(years[at + direction]);
                setPicked(null);
              }}
            >
              {years[at]}
            </Pager>
          </>
        ) : (
          <span className="sub num hist-sum">
            {years[0]}–{years[years.length - 1]} · {plural(years.length, "year")}
          </span>
        )}
      </div>
      {!byMonthData ? (
        <div className="hist" aria-busy="true" />
      ) : view === "months" ? (
        <div className={`hist${lens === "BITCOIN" ? " btc" : ""}`} role="group" aria-label={`Spending by month, ${years[at]}`}>
          {Array.from({ length: 12 }, (_, index) => `${years[at]}-${String(index + 1).padStart(2, "0")}`).map((month) => {
            // Every year keeps twelve places, so the same month sits in the same place on every page.
            if (month < first || month > data.month)
              return (
                <span key={month} className="hist-none" aria-hidden="true">
                  <span className="hist-m">{monthName(month)}</span>
                </span>
              );
            const sum = byMonth.get(month);
            const amount = amountOf(sum);
            const height = amount === null ? 100 : (coordinate(amount) / topMonth) * 100;
            const label = `${monthYear(month)}: ${amount === null ? `partial, ${entries(sum!.missing_bitcoin)} without a bitcoin price` : show(amount)}${month === data.month ? ", so far" : ""}`;
            return (
              <button key={month} aria-pressed={picked === month} aria-label={label} title={label} onClick={() => setPicked(picked === month ? null : month)}>
                <span className="hist-v num">{amount === null ? "Partial" : short(amount)}</span>
                <span className="hist-col">
                  <i className={amount === null ? "partial" : month === data.month ? "now" : undefined} style={{ height: `${Math.max(height, amount === null ? 100 : 1.5).toFixed(1)}%` }} />
                </span>
                <span className="hist-m">{monthName(month)}</span>
              </button>
            );
          })}
        </div>
      ) : !byYearData ? (
        <div className="hist hist-years" aria-busy="true" />
      ) : (
        <div className={`hist hist-years${lens === "BITCOIN" ? " btc" : ""}`} role="group" aria-label="Spending by year">
          {years.map((each) => {
            const sum = byYear.get(each);
            const amount = amountOf(sum);
            const height = amount === null ? 100 : (coordinate(amount) / topYear) * 100;
            const months = inYear(each).length;
            const partial = part(each);
            const average = amount === null ? null : monthlyAverage(amount, months, lens);
            const label = `${each}${partial ? `, ${partial.long}` : ""}: ${
              amount === null ? `partial, ${entries(sum!.missing_bitcoin)} without a bitcoin price` : `${show(amount)}, ${show(average)} a month on average over ${plural(months, "month")}`
            }. Show its months.`;
            return (
              <button key={each} aria-label={label} title={label} onClick={() => open(each)}>
                <span className="hist-v num">
                  {amount === null ? "Partial" : short(amount)}
                  {average !== null && (
                    <small>
                      {short(average)}
                      <span className="hist-per"> a month</span>
                    </small>
                  )}
                </span>
                <span className="hist-col">
                  <i className={amount === null ? "partial" : partial ? "part" : undefined} style={{ height: `${Math.max(height, amount === null ? 100 : 1.5).toFixed(1)}%` }} />
                </span>
                <span className="hist-m">
                  <b>{each}</b>
                  {/* Always a second line, so every bar stands on the same baseline. */}
                  <small>{partial ? partial.short : "\u00a0"}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {view === "years" ? (
        <div className="hint">
          A lighter bar is a year that is not whole: the year the ledger began, and this year so far. The figure under each total is that year's average month.
          {lens === "BITCOIN" && " Each expense is priced on the day it was paid. A year with any unpriced expense reads Partial, not a guessed total."}
        </div>
      ) : !picked ? (
        <div className="hint">
          {lens === "BITCOIN"
            ? "Each expense is priced on the day it was paid. A month with any unpriced expense reads Partial, not a guessed total."
            : "The current month is the amount so far."}{" "}
          Bars keep one scale across every year.
        </div>
      ) : !detail ? (
        <div className="meter" aria-busy="true">
          <i style={{ width: "100%", opacity: 0.25 }} />
        </div>
      ) : (
        <div className="hist-detail" aria-live="polite">
          <div className="split" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "4px 12px" }}>
            <b className="lead">
              {monthYear(picked)}
              {picked === data.month ? " so far" : ""}
            </b>
            <span className="sub num">
              <b style={{ color: lens === "USD" ? "var(--ink)" : "var(--btc)" }}>{show(value(detail.totals))}</b> · {entries(detail.totals.count)}
              {lens === "BITCOIN" && detail.totals.missing_bitcoin > 0 && ` · ${detail.totals.missing_bitcoin} without a bitcoin price`}
            </span>
          </div>
          {detail.totals.count === 0 ? (
            <div className="sub">Nothing was spent in {monthYear(picked)}.</div>
          ) : (
            <div className="hist-two">
              <ul className="hist-cats" aria-label={`Categories in ${monthYear(picked)}`}>
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
                <EntryRows rows={rows} thisYear={thisYear} />
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

/** Expenses with what each cost in dollars and in bitcoin on its day. A date in another year says which. */
export function EntryRows({ rows, thisYear }: { rows: Entry[]; thisYear: string }) {
  return (
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
            <td className="num dim">
              {shortDate(row.date)}
              {row.date.slice(0, 4) !== thisYear ? `, ${row.date.slice(0, 4)}` : ""}
            </td>
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
  );
}

/** Compact labels above the bars. Labels only; the exact figure is in the bar's name and the detail. */
function usdShort(amount: string) {
  const dollars = BigInt(amount.split(".")[0]);
  if (dollars >= 10_000n) return `$${(dollars + 500n) / 1000n}k`;
  return `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
function btcShort(amount: string) {
  const units = BigInt(amount.split(".")[0]);
  if (units >= 10_000_000n) return `₿${(units + 500_000n) / 1_000_000n}M`;
  if (units >= 1_000_000n) return `₿${units / 1_000_000n}.${(units % 1_000_000n) / 100_000n}M`;
  if (units >= 10_000n) return `₿${(units + 500n) / 1000n}k`;
  return btc(amount);
}
