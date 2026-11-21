import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { EntryTable } from "../activity/EntryTable";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";
import { Lights } from "./Alerts";
import type { AlertsData } from "./Alerts";
import { BridgePanel, MoneyFlowPanel, CostOfLivingPanel, useAnalysis, useSpendingData } from "./history";
import type { SpendingData } from "./history";
import { BillsPanel, BudgetsPanel, CashAheadPanel, DebtPanel, PacePanel, Panel, SetupPanel, StackPanel } from "./panels";
import { BillSheet, PaycheckSheet } from "./Sheets";
import type { BillMode } from "./Sheets";
import type { Flag } from "./panels";
import type { Bill, DashboardData } from "./types";

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Dashboard({
  go,
  onData,
  alerts,
  onAlert,
  onChanged,
  payBill,
  onPayBillHandled,
  onDrill,
}: {
  go: (route: Route, sub?: string) => void;
  onData: (data: DashboardData) => void;
  /** Alert readings; null when the server has none to give. */
  alerts?: AlertsData | null;
  onAlert?: (id: string) => void;
  /** Called after anything that could change the alert lights. */
  onChanged?: () => void;
  /** A bill the alert drawer asked to pay. */
  payBill?: number | null;
  onPayBillHandled?: () => void;
  /** Open the Spending screen on one category's entries. */
  onDrill?: (categoryKey: string) => void;
}) {
  const { lens, demoEnabled } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<{ bill: Bill; mode: BillMode } | null>(null);
  const [paycheck, setPaycheck] = useState(false);
  const [gone, setGone] = useState<{ id: number; mode: BillMode } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<DashboardData>("/dashboard");
      setData(next);
      setError("");
      onData(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onData]);
  useEffect(() => {
    void load();
  }, [load]);
  const spending = useSpendingData(data);
  useEffect(() => {
    if (payBill == null || !data) return;
    const bill = data.bills.items.find((item) => item.id === payBill);
    if (bill) setSheet({ bill, mode: "pay" });
    onPayBillHandled?.();
  }, [payBill, data, onPayBillHandled]);

  if (!data)
    return error ? (
      <div className="page">
        <section className="inst" style={{ maxWidth: 520 }} role="alert">
          <div className="inst-h">
            <span className="inst-name">Can't reach your ledger</span>
          </div>
          <p className="sub" style={{ margin: 0 }}>
            {error}
          </p>
          <div>
            <button className="btn sm" onClick={() => void load()}>
              Retry
            </button>
          </div>
        </section>
      </div>
    ) : (
      <div className="panel" aria-busy="true" aria-label="Loading your dashboard">
        {["c5", "c3", "c4", "c3", "c5", "c4"].map((span, index) => (
          <section key={index} className={`inst ${span}`} style={{ minHeight: 220 }}>
            <div className="meter" style={{ width: "40%" }}>
              <i style={{ width: "100%", opacity: 0.25 }} />
            </div>
            <div className="meter" style={{ height: 24, width: "60%" }}>
              <i style={{ width: "100%", opacity: 0.25 }} />
            </div>
          </section>
        ))}
      </div>
    );

  const setupDone = Object.values(data.setup).every(Boolean);
  const recent = spending.transactions.filter((row) => row.date.startsWith(data.month));
  const flag = (panel: string): Flag => {
    const alert = alerts?.active
      .filter((item) => item.panel === panel)
      .sort((a, b) => (a.level === b.level ? 0 : a.level === "warning" || (a.level === "caution" && b.level === "advisory") ? -1 : 1))[0];
    return alert && { level: alert.level, onOpen: () => onAlert?.(alert.id) };
  };
  function finished(mode: BillMode) {
    const id = sheet!.bill.id;
    setSheet(null);
    setGone({ id, mode });
    // Let the target fade or burst before the fresh reading replaces it.
    window.setTimeout(
      () => {
        setGone(null);
        void load();
        onChanged?.();
      },
      reducedMotion() ? 0 : 520,
    );
  }

  const loadDemo = () => {
    api("/demo", "POST")
      .then(() => {
        void load();
        onChanged?.();
      })
      .catch((e) => setError((e as Error).message));
  };

  // A brand-new ledger: the checklist leads, and each panel says in a line what it will show.
  if (!data.setup.has_account)
    return (
      <>
        {alerts && <Lights data={alerts} onOpen={(id) => onAlert?.(id)} />}
        <div className="panel">
          <SetupPanel className="c5" data={data} demoEnabled={demoEnabled} go={go} onPaycheck={() => setPaycheck(true)} onDemo={loadDemo} />
          <div className="c7 col" style={{ gridTemplateRows: "none", alignContent: "start" }}>
            <CashAheadPanel data={data} go={go} onPaycheck={() => setPaycheck(true)} />
            <BillsPanel data={data} go={go} gone={null} onAct={() => {}} onStack={() => {}} />
            <StackPanel data={data} go={go} />
            <PacePanel data={data} lens={lens} go={go} />
          </div>
        </div>
      </>
    );

  return (
    <>
      {error && (
        <div className="banner" role="alert">
          Can't refresh right now: {error}. Showing the last reading.{" "}
          <button className="inst-link" onClick={() => void load()}>
            Retry →
          </button>
        </div>
      )}
      {alerts && <Lights data={alerts} onOpen={(id) => onAlert?.(id)} />}
      <div className="panel">
        {setupDone ? (
          <CostOfLivingPanel className="c4" data={data} periods={spending.periods} onWhy={() => go("learn", "cost-of-living")} />
        ) : (
          <SetupPanel
            className="c4"
            data={data}
            demoEnabled={demoEnabled} go={go}
            onPaycheck={() => setPaycheck(true)}
            onDemo={loadDemo}
          />
        )}
        <CashAheadPanel className="c5" flag={flag("cash")} data={data} go={go} onPaycheck={() => setPaycheck(true)} />
        <StackPanel className="c3" flag={flag("stack")} data={data} go={go} />
        <PacePanel className="c3" flag={flag("pace")} data={data} lens={lens} go={go} />
        <BillsPanel className="c5" flag={flag("bills")} data={data} go={go} gone={gone} onAct={(bill, mode) => setSheet({ bill, mode })} onStack={() => go("stack")} />
        <div className="c4 col">
          <DebtPanel flag={flag("debt")} data={data} go={go} />
          <BudgetsPanel flag={flag("budgets")} data={data} go={go} />
        </div>
        <div className="band">Month in detail</div>
        <MonthDetail data={data} spending={spending} onDrill={(key) => onDrill?.(key)} go={go} />
        <Panel className={setupDone ? "c12" : "c8"} name="Transactions" plain="latest entries" link={{ label: "All activity", onClick: () => go("activity") }}>
          {recent.length ? <EntryTable rows={recent.slice(0, 6)} account={false} /> : <div className="sub">Nothing recorded this month yet.</div>}
        </Panel>
        {!setupDone && <CostOfLivingPanel className="c4" data={data} periods={spending.periods} onWhy={() => go("learn", "cost-of-living")} />}
      </div>
      {sheet && (
        <BillSheet
          bill={sheet.bill}
          mode={sheet.mode}
          data={data}
          onMode={(mode) => setSheet({ bill: sheet.bill, mode })}
          onClose={() => setSheet(null)}
          onDone={finished}
        />
      )}
      {paycheck && (
        <PaycheckSheet
          data={data}
          onClose={() => setPaycheck(false)}
          onDone={() => {
            setPaycheck(false);
            void load();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

/** Money flow and Spending bridge share one spending analysis in the current lens. */
function MonthDetail({ data, spending, go, onDrill }: { data: DashboardData; spending: SpendingData; go: (route: Route, sub?: string) => void; onDrill: (key: string) => void }) {
  const { lens } = useSession();
  const analysis = useAnalysis(spending, data, lens);
  return (
    <>
      <MoneyFlowPanel className="c7" data={data} report={spending.report} categories={spending.categories} lens={lens} onDrill={onDrill} onExplore={() => go("spending")} />
      <BridgePanel className="c5" data={data} analysis={analysis} lens={lens} onDrill={onDrill} onExplore={() => go("spending")} />
    </>
  );
}
