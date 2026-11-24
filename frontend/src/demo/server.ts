/**
 * The website demo's stand-in for the server.
 *
 * Every answer is something the real server said about the fictional ledger when the demo was
 * built (`scripts/web_demo.py`), saved as a file beside the page. Nothing is computed here
 * except picking rows out of those answers, and adding saved months together for a longer span
 * (see `compose.ts`). Nothing is sent anywhere and nothing is saved: the few changes the demo
 * allows (theme, dollars or bitcoin, marking alerts seen) live in memory until the page reloads.
 * Anything that would change the ledger is declined with a plain sentence.
 */
import type { StandIn } from "../lib/api";
import { composeSpending, monthsBetween } from "./compose";
import type { MonthAnswer } from "./compose";
import { NOT_SAVED } from "./mode";

export interface Core {
  /** When the answers were saved, and the day the demo ledger calls today. */
  captured_at: string;
  today: string;
  first_month: string;
  /** Entries on or after this day are in the small "recent" file. */
  recent_from: string;
  /** A real bitcoin quote taken when the demo was built. Shown with its time, never as live. */
  quote: { usd_per_btc: string; observed_at: string } | null;
  /** Larger answers kept out of the first load: path to file name. */
  lazy: Record<string, string>;
  responses: Record<string, unknown>;
}

type Entry = { date: string; kind: string; description: string; notes: string; account_id: number; destination_id: number | null };

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

export function createServer(core: Core, load: (file: string) => Promise<unknown>): StandIn {
  // Each saved file is fetched once, when a screen first asks for it.
  const files = new Map<string, Promise<unknown>>();
  const file = <T>(name: string) => {
    if (!files.has(name)) files.set(name, load(name));
    return files.get(name) as Promise<T>;
  };
  const responses = core.responses;
  const names = (path: string) =>
    new Map((responses[path] as { id: number; name: string }[]).map((item) => [String(item.id), item.name]));

  async function transactions(query: URLSearchParams) {
    const kind = query.get("kind") ?? "";
    const start = query.get("start") ?? "";
    const end = query.get("end") ?? "";
    const q = (query.get("q") ?? "").toLowerCase();
    const account = query.get("account_id");
    // The smallest saved list that holds what was asked for.
    const source = kind === "transfer" ? "transfers" : start && start >= core.recent_from ? "transactions-recent" : "transactions";
    const rows = await file<Entry[]>(source);
    return rows.filter(
      (row) =>
        (!kind || row.kind === kind) &&
        (!start || row.date >= start) &&
        (!end || row.date <= end) &&
        (!q || `${row.description} ${row.notes}`.toLowerCase().includes(q)) &&
        (!account || String(row.account_id) === account || String(row.destination_id) === account),
    );
  }

  async function spending(query: URLSearchParams) {
    const start = query.get("start") ?? "";
    const end = query.get("end") ?? "";
    if (!start || !end || start > end || end > core.today) throw new Error("Choose dates up to the demo's last day.");
    const months = monthsBetween(start < `${core.first_month}-01` ? `${core.first_month}-01` : start, end);
    // Saved a year to a file, each holding the server's answer for every month of that year.
    const answers = await Promise.all(
      months.map(async (month) => (await file<Record<string, MonthAnswer>>(`spending/${month.slice(0, 4)}`))[month]),
    );
    const category = query.get("category_id");
    const account = query.get("account_id");
    return composeSpending(
      {
        start,
        end,
        interval: query.get("interval") === "year" ? "year" : "month",
        category: category ? (names("/categories").get(category) ?? "\u0000") : null,
        account: account ? (names("/accounts").get(account) ?? "\u0000") : null,
        summary: query.get("summary") === "true",
      },
      answers,
    );
  }

  async function read(path: string) {
    if (path in responses) return responses[path];
    if (path in core.lazy) return file(core.lazy[path]);
    const [route, search = ""] = path.split("?");
    const query = new URLSearchParams(search);
    if (route === "/transactions") return transactions(query);
    if (route === "/spending-history") return spending(query);
    if (route === "/reports" && (query.get("months") ?? "1") === "1" && (query.get("denomination") ?? "USD") === "USD") {
      const month = query.get("month") ?? core.today.slice(0, 7);
      if (month >= core.first_month && month <= core.today.slice(0, 7)) return file(`reports/${month}`);
    }
    const activity = /^\/accounts\/(\d+)\/activity$/.exec(route);
    if (activity) return file(`activity/${activity[1]}`);
    throw new Error("The demo does not include this view. It works in the app on your own computer.");
  }

  function change(path: string, method: string, body: unknown) {
    const settings = responses["/settings"] as { preferences: Record<string, unknown> };
    const me = responses["/auth/me"] as { preferences: Record<string, unknown> };
    if (path === "/settings" && method === "PUT") {
      const asked = body as Record<string, unknown>;
      // Only how the demo looks may change. Its price source stays as it was built.
      settings.preferences = { ...settings.preferences, theme: asked.theme, denomination: asked.denomination };
      me.preferences = { ...me.preferences, theme: asked.theme, denomination: asked.denomination };
      return { ok: true };
    }
    if (path === "/settings/monetary-lens" && method === "PUT") {
      const { denomination } = body as { denomination: string };
      settings.preferences = { ...settings.preferences, denomination };
      me.preferences = { ...me.preferences, denomination };
      return { ok: true };
    }
    const seen = /^\/alerts\/([a-z-]+)\/acknowledge$|^\/alerts\/(acknowledge-all)$/.exec(path);
    if (seen && method === "POST") {
      const alerts = responses["/alerts"] as { active: { id: string; level: string; acknowledged: boolean }[] };
      const marked: string[] = [];
      for (const alert of alerts.active) {
        if (seen[1] ? alert.id === seen[1] : alert.level !== "advisory") {
          alert.acknowledged = true;
          marked.push(alert.id);
        }
      }
      return { acknowledged: marked };
    }
    throw new Error(NOT_SAVED);
  }

  return {
    async request(path, method, body) {
      // A beat of delay keeps loading states honest without making anyone wait.
      await Promise.resolve();
      return clone(method === "GET" ? await read(path) : change(path, method, body));
    },
    async download() {
      throw new Error(NOT_SAVED);
    },
  };
}
