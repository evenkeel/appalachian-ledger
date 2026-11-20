import { useCallback, useState } from "react";
import { AlertDrawer, AlertsButton, useAlerts } from "./dashboard/Alerts";
import { Dashboard } from "./dashboard/Dashboard";
import type { DashboardData } from "./dashboard/types";
import { StackedLockup } from "./design/Logo";
import { useRoute } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { ComingSoon, Shell } from "./shell/Shell";
import type { PriceReading } from "./shell/Shell";
import { SignIn } from "./shell/SignIn";

function Screens() {
  const { phase, error, retry } = useSession();
  const [route, go] = useRoute();
  const [price, setPrice] = useState<PriceReading | null | undefined>(undefined);
  const onData = useCallback((data: DashboardData) => setPrice(data.price), []);
  const alerts = useAlerts(phase === "ready");
  // null = closed, "" = the full list, otherwise one alert's own detail.
  const [drawer, setDrawer] = useState<string | null>(null);
  const [payBill, setPayBill] = useState<number | null>(null);
  const handled = useCallback(() => setPayBill(null), []);

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
          />
        ) : (
          <ComingSoon route={route} />
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
