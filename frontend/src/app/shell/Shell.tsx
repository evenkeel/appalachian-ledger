import { useState } from "react";
import type { ReactNode } from "react";
import { Sheet } from "../dashboard/Sheets";
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
// The phone bar holds four screens; everything else is under More.
const TABS: Route[] = ["dashboard", "bills", "stack"];
const MORE: Route[] = ["activity", "spending", "accounts", "retirement", "learn", "settings"];

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
  const [more, setMore] = useState(false);
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
  const tabButton = (tab: Route) => (
    <button key={tab} aria-current={route === tab ? "page" : undefined} onClick={() => go(tab)}>
      {NavIcon[tab]}
      {NAV.find((item) => item.route === tab)!.label}
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
        {TABS.slice(0, 2).map(tabButton)}
        <button aria-label="Add entry" onClick={() => go("activity")}>
          <span className="plus">{NavIcon.plus}</span>
        </button>
        {TABS.slice(2).map(tabButton)}
        <button aria-current={MORE.includes(route) ? "page" : undefined} aria-haspopup="dialog" onClick={() => setMore(true)}>
          {NavIcon.more}
          More
        </button>
      </nav>
      {more && (
        <Sheet label="More screens" onClose={() => setMore(false)}>
          <h2>More</h2>
          <div className="more">
            {MORE.map((item, index) => (
              <button
                key={item}
                className="nav"
                data-autofocus={index === 0 ? true : undefined}
                aria-current={route === item ? "page" : undefined}
                onClick={() => {
                  setMore(false);
                  go(item);
                }}
              >
                {NavIcon[item]}
                <span>{item === "settings" ? "Settings" : item === "activity" ? "Transactions" : NAV.find((entry) => entry.route === item)!.label}</span>
              </button>
            ))}
            <button className="nav" onClick={() => setTheme(theme === "night" ? "day" : "night")}>
              {theme === "night" ? NavIcon.sun : NavIcon.moon}
              <span>{theme === "night" ? "Day theme" : "Night theme"}</span>
            </button>
            <button
              className="nav"
              onClick={() => {
                setMore(false);
                void signOut();
              }}
            >
              {NavIcon.lock}
              <span>Lock</span>
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
