import type { ReactNode } from "react";
import { NavIcon } from "../design/icons";
import { btc } from "../lib/format";
import { Lockup, Tile } from "../design/Logo";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";

const NAV: { route: Route; label: string }[] = [
  { route: "dashboard", label: "Dashboard" },
  { route: "activity", label: "Activity" },
  { route: "spending", label: "Spending" },
  { route: "bills", label: "Bills" },
  { route: "stack", label: "Stack" },
  { route: "accounts", label: "Accounts" },
  { route: "retirement", label: "Retirement" },
  { route: "learn", label: "Learn" },
];
const TITLE: Record<Route, string> = {
  dashboard: "Dashboard",
  activity: "Transactions",
  spending: "Spending",
  bills: "Bills",
  stack: "Stack · your bitcoin",
  accounts: "Accounts",
  retirement: "Retirement",
  learn: "Learn",
  settings: "Settings",
};
const TABS: Route[] = ["dashboard", "activity", "bills", "stack"];

export interface PriceReading {
  bitcoin_per_usd: string;
  usd_per_btc: string;
  source: string;
  day: string;
  stale: boolean;
}

export function Shell({
  route,
  go,
  price,
  alerts,
  children,
}: {
  route: Route;
  go: (route: Route) => void;
  price: PriceReading | null | undefined;
  alerts?: ReactNode;
  children: ReactNode;
}) {
  const { lens, setLens, theme, setTheme, signOut, username, demo } = useSession();
  const link = (item: { route: Route; label: string }) => (
    <button
      key={item.route}
      className="nav"
      aria-current={route === item.route ? "page" : undefined}
      onClick={() => go(item.route)}
    >
      {NavIcon[item.route]}
      <span>{item.label}</span>
    </button>
  );
  return (
    <>
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <div className="rail-mark">
            <Tile />
          </div>
          {NAV.map(link)}
          <div className="grow" />
          {link({ route: "settings", label: "Settings" })}
          <button className="nav" onClick={() => void signOut()} title={`Lock (${username})`}>
            {NavIcon.lock}
            <span>Lock</span>
          </button>
        </nav>
        <div className="main">
          <header className="glare">
            <div className="rail-mark" style={{ padding: 0 }}>
              <Tile size={32} />
            </div>
            <Lockup />
            <span className="crumb">{TITLE[route]}</span>
            {demo && <span className="tag">Fictional demo</span>}
            <span className="grow" />
            {price ? (
              <div
                className="price"
                title={`$${price.usd_per_btc} per BTC · ${price.source} · ${price.day}`}
              >
                <span className="num q btc">{btc(price.bitcoin_per_usd)}</span>
                <span className="per">per $1</span>
                <span className="prov">
                  {price.source} · {price.day}
                  {price.stale ? " · stale" : ""}
                </span>
              </div>
            ) : price === null ? (
              <button className="price" onClick={() => go("settings")}>
                <span className="q dim">No price source</span>
                <span className="prov">Choose one in settings</span>
              </button>
            ) : null}
            <div className="lens" role="group" aria-label="Price analysis in">
              <button aria-pressed={lens === "USD"} aria-label="Dollars" onClick={() => setLens("USD")}>
                $
              </button>
              <button
                className="b"
                aria-pressed={lens === "BITCOIN"}
                aria-label="Bitcoin"
                onClick={() => setLens("BITCOIN")}
              >
                ₿
              </button>
            </div>
            <button
              className="icon-btn theme-toggle"
              aria-label={theme === "night" ? "Switch to day theme" : "Switch to night theme"}
              onClick={() => setTheme(theme === "night" ? "day" : "night")}
            >
              {theme === "night" ? NavIcon.sun : NavIcon.moon}
            </button>
            {alerts}
            <button className="add" onClick={() => go("activity")}>
              <span>Add entry</span>
              <b aria-hidden="true">+</b>
            </button>
          </header>
          <main>{children}</main>
        </div>
      </div>
      <nav className="tabbar" aria-label="Main">
        {TABS.slice(0, 2).map((tab) => (
          <button key={tab} aria-current={route === tab ? "page" : undefined} onClick={() => go(tab)}>
            {NavIcon[tab]}
            {NAV.find((item) => item.route === tab)!.label}
          </button>
        ))}
        <button aria-label="Add entry" onClick={() => go("activity")}>
          <span className="plus">{NavIcon.plus}</span>
        </button>
        {TABS.slice(2).map((tab) => (
          <button key={tab} aria-current={route === tab ? "page" : undefined} onClick={() => go(tab)}>
            {NavIcon[tab]}
            {NAV.find((item) => item.route === tab)!.label}
          </button>
        ))}
      </nav>
    </>
  );
}

/** Screens that are not rebuilt yet open in the previous interface, on the same ledger. */
const LEGACY: Partial<Record<Route, { page: string; note: string }>> = {
  activity: { page: "Transactions", note: "Add, correct and search transactions." },
  spending: { page: "Expenses", note: "Spend pace, spending bridge and category history." },
  bills: { page: "Expenses", note: "Recurring bills and the upcoming calendar." },
  stack: { page: "Stacking", note: "Bitcoin buys and holdings over time." },
  accounts: { page: "Accounts", note: "Accounts, cards, assets and loans." },
  retirement: { page: "Retirement", note: "Saved scenarios and projections." },
  settings: { page: "Settings", note: "Prices, backup, security, categories and export." },
};

export function ComingSoon({ route }: { route: Route }) {
  const legacy = LEGACY[route];
  return (
    <div className="page">
      <h1>{TITLE[route]}</h1>
      <section className="inst inop" style={{ maxWidth: 560 }}>
        <div className="inst-h">
          <span className="inst-name">Being rebuilt</span>
        </div>
        <p className="sub" style={{ margin: 0 }}>
          {legacy
            ? `${legacy.note} This screen has not moved to the new design yet. It still works in the previous interface, on the same ledger.`
            : "This section is planned and has not been built yet."}
        </p>
        {legacy && (
          <div>
            <a className="btn primary" href={`/legacy.html?page=${encodeURIComponent(legacy.page)}`}>
              Open {legacy.page} in the previous interface
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
