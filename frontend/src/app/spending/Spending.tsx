import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { categoryKey } from "../../lib/spendingAnalysis";
import type { Report } from "../../lib/types";
import { EntryTable } from "../activity/EntryTable";
import { BridgePanel, MoneyFlowPanel, CostOfLivingPanel, lastDay, useAnalysis, useSpendingData } from "../dashboard/history";
import type { SpendingData } from "../dashboard/history";
import { PacePanel, Panel } from "../dashboard/panels";
import type { DashboardData } from "../dashboard/types";
import { MonthStepper, monthsBetween } from "../design/timeline";
import { btc, fromCents, longMonth, monthYear, plural, usd } from "../lib/format";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";
import { AllowancesPanel } from "./Allowances";
import { EntryRows, HistoryPanel } from "./History";
import type { History } from "./History";

/** Spend pace, Spending bridge and Money flow at full size, with the entries behind any number. */
export function Spending({ go, drill, onDrill, onChanged }: { go: (route: Route, sub?: string) => void; drill: string | null; onDrill: (key: string | null) => void; onChanged?: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<DashboardData>("/dashboard")
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  const spending = useSpendingData(data);
  if (!data)
    return (
      <div className="page">
        <h1>Spending</h1>
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
  return (
    <Loaded
      data={data}
      spending={spending}
      go={go}
      drill={drill}
      onDrill={onDrill}
      onChanged={() => {
        load();
        onChanged?.();
      }}
    />
  );
}

function Loaded({ data, spending, go, drill, onDrill, onChanged }: { data: DashboardData; spending: SpendingData; go: (route: Route, sub?: string) => void; drill: string | null; onDrill: (key: string | null) => void; onChanged: () => void }) {
  const { lens } = useSession();
  const analysis = useAnalysis(spending, data, lens);
  const picked = drill ? analysis.categories.find((category) => category.key === drill) : undefined;
  const rows = drill ? analysis.rows.filter((row) => categoryKey(row) === drill) : [];
  const total = picked?.current.value ?? null;

  // Money flow can show any month on record. Months that are over are read once each and kept.
  const months = useMemo(() => monthsBetween(data.first_entry_date?.slice(0, 7) ?? data.month, data.month), [data.first_entry_date, data.month]);
  const [flowMonth, setFlowMonth] = useState(data.month);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [flowError, setFlowError] = useState("");
  // The entries behind one category of an earlier month, chosen in the flow.
  const [past, setPast] = useState<{ month: string; key: string } | null>(null);
  const [pastRows, setPastRows] = useState<History | null>(null);
  const earlier = flowMonth !== data.month;
  // A change anywhere in the ledger may reach an earlier month, so a new reading discards the kept ones.
  useEffect(() => setReports({}), [data]);
  const kept = reports[flowMonth];
  useEffect(() => {
    if (!earlier || kept) return;
    let alive = true;
    api<Report>(`/reports?month=${flowMonth}&months=1&denomination=USD`)
      .then((next) => alive && (setReports((before) => ({ ...before, [flowMonth]: next })), setFlowError("")))
      .catch((e) => alive && setFlowError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [flowMonth, earlier, kept]);
  useEffect(() => {
    if (!past) return;
    let alive = true;
    setPastRows(null);
    api<History>(`/spending-history?start=${past.month}-01&end=${lastDay(past.month)}&interval=month&category_id=${past.key}`)
      .then((next) => alive && (setPastRows(next), setFlowError("")))
      .catch((e) => alive && setFlowError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [past]);
  const pastName = past ? (spending.categories.find((category) => String(category.id) === past.key)?.name ?? "Category") : "";
  const pastTotal = pastRows ? (lens === "USD" ? pastRows.totals.usd : pastRows.totals.missing_bitcoin > 0 ? null : pastRows.totals.bitcoin) : null;
  return (
    <div className="page">
      <h1>Spending</h1>
      <p className="intro">
        {longMonth(data.month)} so far against the same days of {longMonth(analysis.previousMonth)}. Use <b>$</b> / <b className="btc">₿</b> in the top bar to price everything in bitcoin
        at each purchase date. Select a category in the bridge or the flow to see the entries behind it.
      </p>
      {(spending.error || flowError) && (
        <p className="gate-error" role="alert">
          {spending.error || flowError}
        </p>
      )}
      <div className="grid2">
        <PacePanel className="c5" data={data} lens={lens} go={go} />
        <BridgePanel className="c7" data={data} analysis={analysis} lens={lens} selected={drill} onDrill={onDrill} />
        <MoneyFlowPanel
          className="c12"
          data={data}
          report={earlier ? (kept ?? null) : spending.report}
          loading={earlier && !kept && !flowError}
          categories={spending.categories}
          lens={lens}
          month={flowMonth}
          control={
            months.length > 1 && (
              <MonthStepper
                label="Money flow month"
                months={months}
                value={flowMonth}
                current={data.month}
                onChange={(month) => {
                  setFlowMonth(month);
                  setPast(null);
                }}
              />
            )
          }
          onDrill={(key) => (earlier ? setPast({ month: flowMonth, key }) : onDrill(key))}
        />
        {past ? (
          <Panel
            className="c12"
            name={pastName}
            plain={
              pastRows
                ? `${plural(pastRows.totals.count, "entry").replace("entrys", "entries")} in ${monthYear(past.month)} · ${pastTotal === null ? "partial" : lens === "USD" ? usd(pastTotal) : btc(pastTotal)}`
                : `in ${monthYear(past.month)}`
            }
            link={{ label: "Clear", onClick: () => setPast(null) }}
          >
            {!pastRows ? (
              <div className="meter" aria-busy="true">
                <i style={{ width: "100%", opacity: 0.25 }} />
              </div>
            ) : pastRows.transactions.length ? (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <EntryRows rows={pastRows.transactions} thisYear={data.month.slice(0, 4)} />
              </div>
            ) : (
              <div className="sub">No entries in this category in {monthYear(past.month)}.</div>
            )}
          </Panel>
        ) : drill ? (
          <Panel
            className="c12"
            name={picked?.name ?? "Category"}
            plain={`${plural(rows.length, "entry").replace("entrys", "entries")} this month${total !== null ? ` · ${lens === "USD" ? usd(fromCents(total)) : btc(total.toString())}` : ""}`}
            link={{ label: "Clear", onClick: () => onDrill(null) }}
          >
            {rows.length ? <EntryTable rows={rows} /> : <div className="sub">No entries in this category this month; the change comes from last month.</div>}
          </Panel>
        ) : (
          <p className="hint" style={{ gridColumn: "1/-1" }}>
            Select a bridge row or a spending stream to list its entries here.
          </p>
        )}
        <CostOfLivingPanel className="c7" data={data} periods={spending.periods} onWhy={() => go("learn", "cost-of-living")} />
        <AllowancesPanel className="c5" month={data.month} elapsed={data.budgets.month_elapsed_percent} categories={spending.categories} onChanged={onChanged} />
        <HistoryPanel className="c12" data={data} lens={lens} />
      </div>
    </div>
  );
}
