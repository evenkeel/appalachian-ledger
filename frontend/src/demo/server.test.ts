import { describe, expect, it, vi } from "vitest";
import { NOT_SAVED } from "./mode";
import { createServer } from "./server";
import type { Core } from "./server";
import { pinClock } from "./start";

const entry = (id: number, date: string, kind: string, description: string, account_id = 1, destination_id: number | null = null) => ({
  id,
  date,
  kind,
  description,
  notes: "",
  account_id,
  destination_id,
});
const expense = (id: number, date: string, category: string, usd: string) => ({
  id,
  date,
  category,
  account: "Everyday checking",
  usd,
  bitcoin: "1000",
  hypothetical_value_usd: usd,
});

function demo() {
  const core: Core = {
    captured_at: "2026-11-23T23:47:17+00:00",
    today: "2026-11-23",
    first_month: "2025-12",
    recent_from: "2026-09-01",
    quote: { usd_per_btc: "61147.96", observed_at: "2026-11-23T23:47:17+00:00" },
    lazy: { "/rates": "rates" },
    retirement: {
      '[{"growth_pct":"20"},[]]': "0",
      '[{},["bill-9","buy"]]': "1",
      '[{"cost_rise_pct":"6.0"},[]]': "2",
      '[{"growth_pct":null},[]]': "3",
    },
    responses: {
      "/auth/me": { username: "demo", csrf: "demo", demo: true, preferences: { theme: "light", denomination: "USD", rate_source: "coinbase" } },
      "/settings": { preferences: { theme: "light", denomination: "USD", rate_source: "coinbase" }, demo: true },
      "/alerts": { lights: [], active: [{ id: "backup", level: "caution", acknowledged: false }, { id: "price", level: "advisory", acknowledged: false }] },
      "/planning/retirement": { settings: { growth_pct: "15", cost_rise_pct: "3", left_out_entries: [] }, ledger: { bitcoin: "5" }, runway: { months: 3 } },
      "/categories": [{ id: 4, name: "Dining" }],
      "/accounts": [{ id: 1, name: "Everyday checking" }],
    },
  };
  const files: Record<string, unknown> = {
    rates: [{ day: "2026-11-22" }],
    transactions: [entry(3, "2026-11-20", "expense", "Wings"), entry(2, "2026-10-02", "transfer", "Bitcoin buy", 1, 3), entry(1, "2025-12-05", "income", "Paycheck")],
    "transactions-recent": [entry(3, "2026-11-20", "expense", "Wings"), entry(2, "2026-10-02", "transfer", "Bitcoin buy", 1, 3)],
    transfers: [entry(2, "2026-10-02", "transfer", "Bitcoin buy", 1, 3)],
    "reports/2026-10": { month: "2026-10" },
    "activity/1": [{ id: 3 }],
    "retirement/0": { runway: { months: 4 } },
    "retirement/1": { runway: { months: 5 } },
    "retirement/2": { runway: { months: 2 } },
    "retirement/3": { runway: null },
    "spending/2026": {
      "2026-11": { transactions: [expense(3, "2026-11-20", "Dining", "33.10")], current_reference: { price_usd: "61147.96" } },
      "2026-10": { transactions: [expense(2, "2026-10-09", "Rent", "1245.00")], current_reference: null },
    },
  };
  const load = vi.fn(async (name: string) => {
    if (!(name in files)) throw new Error(`no file ${name}`);
    return files[name];
  });
  return { server: createServer(core, load), load, core };
}

describe("the website demo's stand-in server", () => {
  it("answers from what was saved and fetches each file once, only when asked", async () => {
    const { server, load } = demo();
    expect(await server.request("/categories", "GET")).toEqual([{ id: 4, name: "Dining" }]);
    expect(load).not.toHaveBeenCalled();
    expect(await server.request("/rates", "GET")).toEqual([{ day: "2026-11-22" }]);
    expect(await server.request("/reports?month=2026-10&months=1&denomination=USD", "GET")).toEqual({ month: "2026-10" });
    expect(await server.request("/accounts/1/activity", "GET")).toEqual([{ id: 3 }]);
    await server.request("/rates", "GET");
    expect(load.mock.calls.filter(([name]) => name === "rates")).toHaveLength(1);
  });

  it("picks the smallest saved list of entries that holds what was asked for", async () => {
    const { server, load } = demo();
    const ids = async (path: string) => ((await server.request(path, "GET")) as { id: number }[]).map((row) => row.id);
    expect(await ids("/transactions?start=2026-10-01")).toEqual([3, 2]);
    expect(await ids("/transactions?kind=transfer")).toEqual([2]);
    expect(load.mock.calls.map(([name]) => name)).toEqual(["transactions-recent", "transfers"]);
    expect(await ids("/transactions")).toEqual([3, 2, 1]);
    expect(await ids("/transactions?q=wing")).toEqual([3]);
    expect(await ids("/transactions?account_id=3")).toEqual([2]);
  });

  it("adds saved months up for any span, and by category", async () => {
    const { server } = demo();
    const all = (await server.request("/spending-history?start=2026-10-01&end=2026-11-23&interval=month", "GET")) as {
      totals: { usd: string; count: number };
      periods: { period: string }[];
    };
    expect(all.totals).toMatchObject({ usd: "1278.10", count: 2 });
    expect(all.periods.map((period) => period.period)).toEqual(["2026-10", "2026-11"]);
    const dining = (await server.request("/spending-history?start=2026-10-01&end=2026-11-23&interval=year&category_id=4", "GET")) as {
      totals: { usd: string };
    };
    expect(dining.totals.usd).toBe("33.10");
  });

  it("keeps the look and seen alerts in memory, and declines anything that would change the ledger", async () => {
    const { server } = demo();
    await server.request("/settings/monetary-lens", "PUT", { denomination: "BITCOIN" });
    await server.request("/settings", "PUT", { theme: "dark", denomination: "BITCOIN", rate_source: "manual" });
    const me = (await server.request("/auth/me", "GET")) as { preferences: Record<string, string> };
    expect(me.preferences).toMatchObject({ theme: "dark", denomination: "BITCOIN", rate_source: "coinbase" });
    expect(await server.request("/alerts/acknowledge-all", "POST")).toEqual({ acknowledged: ["backup"] });
    const alerts = (await server.request("/alerts", "GET")) as { active: { acknowledged: boolean }[] };
    expect(alerts.active.map((alert) => alert.acknowledged)).toEqual([true, false]);
    await expect(server.request("/transactions", "POST", { amount: "5.00" })).rejects.toThrow(NOT_SAVED);
    await expect(server.request("/recurring-bills/3/record", "POST", {})).rejects.toThrow(NOT_SAVED);
    await expect(server.download("/export/csv", "ledger.csv")).rejects.toThrow(NOT_SAVED);
  });

  it("hands out copies, so a screen cannot alter what was saved", async () => {
    const { server } = demo();
    const first = (await server.request("/categories", "GET")) as { name: string }[];
    first[0].name = "Changed";
    expect(await server.request("/categories", "GET")).toEqual([{ id: 4, name: "Dining" }]);
  });

  it("says plainly when a view is not part of the demo", async () => {
    const { server } = demo();
    await expect(server.request("/market/quotes?symbols=BTC-USD", "GET")).rejects.toThrow(/does not include this view/);
  });
});

describe("the demo's clock", () => {
  it("starts at the moment the demo was saved and keeps running from there", () => {
    const RealDate = Date;
    try {
      pinClock("2026-11-23T23:47:17+00:00");
      expect(new Date().toISOString().slice(0, 16)).toBe("2026-11-23T23:47");
      expect(Math.abs(Date.now() - RealDate.parse("2026-11-23T23:47:17+00:00"))).toBeLessThan(2000);
      expect(new Date("2024-02-29T12:00:00Z").getUTCDate()).toBe(29);
      expect(new Date(2024, 0, 15).getMonth()).toBe(0);
      expect(new Date() instanceof RealDate).toBe(true);
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it("answers the retirement changes the server was asked, and says when one was not", async () => {
    const { server, load } = demo();
    const settings = { growth_pct: "15", cost_rise_pct: "3", left_out_entries: [] as number[] };
    const draft = (changes: object, trying: string[] = []) =>
      server.request("/planning/retirement/draft", "POST", { settings: { ...settings, ...changes }, trying }) as Promise<Record<string, unknown>>;
    expect(await draft({ growth_pct: "20.0" })).toEqual({ settings: { ...settings, growth_pct: "20.0" }, ledger: { bitcoin: "5" }, runway: { months: 4 } });
    expect(await draft({}, ["buy", "bill-9"])).toMatchObject({ runway: { months: 5 } });
    expect(await draft({ cost_rise_pct: "6.0" })).toMatchObject({ runway: { months: 2 } });
    expect(await draft({ growth_pct: null })).toMatchObject({ runway: null });
    load.mockClear();
    expect(await draft({ growth_pct: "15.0" })).toMatchObject({ runway: { months: 3 } });
    expect(load).not.toHaveBeenCalled();
    await expect(draft({ growth_pct: "21" })).rejects.toThrow("one change at a time");
    await expect(draft({ growth_pct: "20" }, ["buy"])).rejects.toThrow("one change at a time");
    await expect(server.request("/planning/retirement", "PUT", settings)).rejects.toThrow(NOT_SAVED);
  });
});
