import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Accounts } from "./accounts/Accounts";
import { Activity } from "./activity/Activity";
import { Bills } from "./bills/Bills";
import { AlertDrawer, AlertsButton, useAlerts } from "./dashboard/Alerts";
import { Dashboard } from "./dashboard/Dashboard";
import type { DashboardData } from "./dashboard/types";
import { StackedLockup } from "./design/Logo";
import { Learn } from "./learn/Learn";
import { useRoute } from "./lib/router";
import { Retirement } from "./retirement/Retirement";
import { SessionProvider, useSession } from "./lib/session";
import { Settings } from "./settings/Settings";
import { Shell } from "./shell/Shell";
import type { PriceReading } from "./shell/Shell";
import { SignIn } from "./shell/SignIn";
import { Spending } from "./spending/Spending";
import { Stack } from "./stack/Stack";

// The charting code is only fetched when the Markets screen is opened.
const Markets = lazy(() => import("./markets/Markets").then((module) => ({ default: module.Markets })));

function Screens() {
  const { phase, error, retry } = useSession();
  const [route, go] = useRoute();
  const [price, setPrice] = useState<PriceReading | null | undefined>(undefined);
  const onData = useCallback((data: DashboardData) => setPrice(data.price), []);
  const alerts = useAlerts(phase === "ready");
  const refreshAlerts = alerts.refresh;
  // The top bar's price is read here too, so it is right on every screen and after any change.
  const refreshPrice = useCallback(() => {
    api<DashboardData>("/dashboard")
      .then((data) => setPrice(data.price))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (phase === "ready") refreshPrice();
  }, [phase, refreshPrice]);
  const changed = useCallback(() => {
    void refreshAlerts();
    refreshPrice();
  }, [refreshAlerts, refreshPrice]);
  // null = closed, "" = the full list, otherwise one alert's own detail.
  const [drawer, setDrawer] = useState<string | null>(null);
  const [payBill, setPayBill] = useState<number | null>(null);
  const handled = useCallback(() => setPayBill(null), []);
  // The category whose entries the Spending screen is showing.
  const [drill, setDrill] = useState<string | null>(null);

  if (phase === "booting")
    return (
      <main className="gate" aria-busy="true">
        <StackedLockup />
        <p className="sub">Connecting to your ledger…</p>
      </main>
    );
  if (phase === "offline")
    return (
      <main className="gate">
        <StackedLockup />
        <section className="inst gate-form" role="alert">
          <h1>Can't reach your ledger</h1>
          <p className="sub">{error || "The local server did not answer."} Nothing is shown from memory.</p>
          <button className="btn primary" onClick={retry}>
            Try again
          </button>
        </section>
      </main>
    );
  if (phase === "setup" || phase === "locked") return <SignIn />;
  return (
    <>
      <Shell
        route={route}
        go={go}
        price={price}
        alerts={
          alerts.data && (
            <AlertsButton
              data={alerts.data}
              onOpen={() => {
                // Pressing the button acknowledges every caution and warning, then lists them.
                void alerts.acknowledge();
                setDrawer("");
              }}
            />
          )
        }
      >
        {route === "dashboard" ? (
          <Dashboard
            go={go}
            onData={onData}
            alerts={alerts.data}
            onAlert={setDrawer}
            onChanged={() => void alerts.refresh()}
            payBill={payBill}
            onPayBillHandled={handled}
            onDrill={(key) => {
              setDrill(key);
              go("spending");
            }}
          />
        ) : route === "activity" ? (
          <Activity onChanged={changed} />
        ) : route === "spending" ? (
          <Spending go={go} drill={drill} onDrill={setDrill} onChanged={changed} />
        ) : route === "bills" ? (
          <Bills go={go} onChanged={changed} />
        ) : route === "learn" ? (
          <Learn go={go} />
        ) : route === "retirement" ? (
          <Retirement go={go} />
        ) : route === "stack" ? (
          <Stack go={go} />
        ) : route === "markets" ? (
          <Suspense
            fallback={
              <div className="page" aria-busy="true">
                <h1>Markets</h1>
                <p className="sub">Loading charts…</p>
              </div>
            }
          >
            <Markets />
          </Suspense>
        ) : route === "settings" ? (
          <Settings go={go} onChanged={changed} />
        ) : (
          <Accounts go={go} onChanged={changed} />
        )}
      </Shell>
      {drawer !== null && alerts.data && (
        <AlertDrawer
          data={alerts.data}
          open={drawer}
          onOpen={setDrawer}
          onClose={() => setDrawer(null)}
          onAcknowledge={(id) => void alerts.acknowledge(id)}
          onRoute={(next) => {
            setDrawer(null);
            go(next);
          }}
          onPayBill={(id) => {
            setDrawer(null);
            go("dashboard");
            setPayBill(id);
          }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Screens />
    </SessionProvider>
  );
}
