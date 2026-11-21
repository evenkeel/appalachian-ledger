import { useEffect, useState } from "react";

export const ROUTES = [
  "dashboard",
  "activity",
  "spending",
  "bills",
  "stack",
  "markets",
  "accounts",
  "retirement",
  "learn",
  "settings",
] as const;
export type Route = (typeof ROUTES)[number];

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : "dashboard";
}

/** Hash routing: every screen has a link, and no server configuration is needed. */
/** The part of the address after the screen name, such as "add" in #/bills/add. */
export function subPath(hash = window.location.hash) {
  return hash.replace(/^#\/?/, "").split("/").slice(1).join("/").split("?")[0];
}

export function useRoute(): [Route, (route: Route, sub?: string) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return [
    route,
    (next, sub) => {
      window.location.hash = sub ? `/${next}/${sub}` : `/${next}`;
      window.scrollTo(0, 0);
    },
  ];
}
