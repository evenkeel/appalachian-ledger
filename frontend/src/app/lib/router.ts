import { useEffect, useState } from "react";

export const ROUTES = [
  "dashboard",
  "activity",
  "spending",
  "bills",
  "stack",
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
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return [
    route,
    (next) => {
      window.location.hash = `/${next}`;
      window.scrollTo(0, 0);
    },
  ];
}
