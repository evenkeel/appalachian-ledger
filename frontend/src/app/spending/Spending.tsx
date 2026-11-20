import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { categoryKey } from "../../lib/spendingAnalysis";
import { EntryTable } from "../activity/EntryTable";
import { BridgePanel, MoneyFlowPanel, TwoSystemsPanel, useAnalysis, useSpendingData } from "../dashboard/history";
import type { SpendingData } from "../dashboard/history";
import { PacePanel, Panel } from "../dashboard/panels";
import type { DashboardData } from "../dashboard/types";
import { btc, fromCents, longMonth, plural, usd } from "../lib/format";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";

/** Spend pace, Spending bridge and Money flow at full size, with the entries behind any number. */
export function Spending({ go, drill, onDrill }: { go: (route: Route) => void; drill: string | null; onDrill: (key: string | null) => void }) {
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
  return <Loaded data={data} spending={spending} go={go} drill={drill} onDrill={onDrill} />;
}

function Loaded({ data, spending, go, drill, onDrill }: { data: DashboardData; spending: SpendingData; go: (route: Route) => void; drill: string | null; onDrill: (key: string | null) => void }) {
  const { lens } = useSession();
  const analysis = useAnalysis(spending, data, lens);
  const picked = drill ? analysis.categories.find((category) => category.key === drill) : undefined;
  const rows = drill ? analysis.rows.filter((row) => categoryKey(row) === drill) : [];
  const total = picked?.current.value ?? null;
  return (
    <div className="page">
      <h1>Spending</h1>
      <p className="intro">
        {longMonth(data.month)} so far against the same days of {longMonth(analysis.previousMonth)}. Use <b>$</b> / <b className="btc">₿</b> in the top bar to price everything in bitcoin
        at each purchase date. Select a category in the bridge or the flow to see the entries behind it.
      </p>
      {spending.error && (
        <p className="gate-error" role="alert">
          {spending.error}
        </p>
      )}
      <div className="grid2">
        <PacePanel className="c5" data={data} lens={lens} go={go} />
        <BridgePanel className="c7" data={data} analysis={analysis} lens={lens} selected={drill} onDrill={onDrill} />
        <MoneyFlowPanel className="c12" data={data} report={spending.report} categories={spending.categories} lens={lens} onDrill={onDrill} />
        {drill ? (
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
        <TwoSystemsPanel className="c7" data={data} periods={spending.periods} onWhy={() => go("learn")} />
        <Panel className="c5" name="Budgets and history" plain="not rebuilt yet" inop>
          <div className="sub">Category allowances, the six-month category trends and the long-range history still live in the previous interface.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn sm" href="/legacy.html?page=Budgets">
              Open Budgets
            </a>
            <a className="btn sm" href="/legacy.html?page=Expenses">
              Open Expenses
            </a>
          </div>
        </Panel>
      </div>
    </div>
  );
}
