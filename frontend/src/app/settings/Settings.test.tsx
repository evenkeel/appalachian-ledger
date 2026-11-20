import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, download, setCsrf } from "../../lib/api";
import { Settings } from "./Settings";
import { SPECS, check, sortServerErrors } from "./thresholds";

vi.mock("../../lib/api", () => ({ api: vi.fn(), download: vi.fn(), setCsrf: vi.fn() }));
const session = { theme: "night", lens: "USD", setTheme: vi.fn(), setLens: vi.fn() };
vi.mock("../lib/session", () => ({ useSession: () => session }));

const defaults = {
  overdue: { on: true, warning_days: 3 },
  cash: { on: true, warning_within_days: 7 },
  card: { on: true, advisory_days: 7, caution_days: 2 },
  pace: { on: true, percent: 20, dollars: 150, from_day: 5 },
  util: { on: true, caution_percent: 30, warning_percent: 90 },
  allow: { on: true, advisory_percent: 90, advisory_days_left: 7 },
  price: { on: true, stale_minutes: 10, failing_minutes: 30 },
  conv: { on: true, caution_count: 10, caution_age_days: 14 },
  backup: { on: true, advisory_days: 14, caution_days: 30, grace_days: 7 },
  stack: { on: true, by_day: 20 },
};
// What the server holds: more than this screen edits, and newer than what any form last saw.
const preferences = {
  denomination: "USD",
  theme: "dark",
  rate_source: "manual",
  automatic_prices: false,
  debt_limits: { low: "1000", medium: "5000", high: "10000" },
  card_orders: {},
  category_payment_defaults: { "3": 2 },
  payee_rules: [],
};
const price = { usd_per_btc: "118600.00", bitcoin_per_usd: "843", source: "Manual", day: "2026-11-19", observed_at: null, stale: false };

type Reply = (body: unknown) => unknown;
let replies: Record<string, Reply>;
const calls = (method: string, path: string) => vi.mocked(api).mock.calls.filter(([p, m = "GET"]) => p === path && m === method);

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(download).mockReset().mockResolvedValue(undefined);
  vi.mocked(setCsrf).mockReset();
  session.setTheme.mockReset();
  session.setLens.mockReset();
  let saved = structuredClone(defaults) as Record<string, unknown>;
  replies = {
    "GET /settings/alert-thresholds": () => saved,
    "PUT /settings/alert-thresholds": (body) => (saved = { ...structuredClone(defaults), ...(body as object) }),
    "GET /settings": () => ({ preferences, node_configured: false, demo: false }),
    "PUT /settings": () => ({ ok: true }),
    "GET /prices/status": () => ({ source: "manual", automatic: false, quote: null, history: null }),
    "GET /rates": () => [{ id: 1, day: "2026-11-19", usd_per_btc: "118600.00", source: "Manual", method: "manual", fetched_at: "" }],
    "GET /dashboard": () => ({ price }),
    "POST /rates": () => ({ id: 2 }),
    "GET /audit": () => [],
    "GET /alerts": () => ({ lights: [], active: [] }),
    "POST /auth/password": () => ({ username: "owner", csrf: "fresh-token" }),
  };
  vi.mocked(api).mockImplementation(async (path: string, method = "GET", body?: unknown) => {
    const reply = replies[`${method} ${path}`];
    if (!reply) throw new Error(`Unexpected ${method} ${path}`);
    return reply(body) as never;
  });
});

const open = (onChanged = vi.fn()) => {
  render(<Settings go={vi.fn()} onChanged={onChanged} />);
  return onChanged;
};
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("alert thresholds", () => {
  it("loads the saved thresholds and saves a changed one as the whole set of whole numbers", async () => {
    const onChanged = open();
    const field = await screen.findByLabelText("Credit use: Warning at (percent of limit)");
    expect(field).toHaveValue("90");
    expect(screen.getAllByRole("switch", { name: /light$/ })).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Save alert settings" })).toBeDisabled();

    change("Credit use: Warning at (percent of limit)", "80");
    fireEvent.click(screen.getByRole("switch", { name: "No stack yet light" }));
    fireEvent.click(screen.getByRole("button", { name: "Save alert settings" }));

    await screen.findByText("Alert settings saved.");
    expect(calls("PUT", "/settings/alert-thresholds")).toEqual([
      ["/settings/alert-thresholds", "PUT", { ...defaults, util: { on: true, caution_percent: 30, warning_percent: 80 }, stack: { on: false, by_day: 20 } }],
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: "No stack yet light" })).toHaveAttribute("aria-checked", "false");
  });

  it("refuses a value outside the server's bounds before sending anything", async () => {
    const onChanged = open();
    await screen.findByLabelText("Spend pace: Ahead by (percent)");
    change("Spend pace: Ahead by (percent)", "501");
    change("Card due: Caution (days before)", "9");
    fireEvent.click(screen.getByRole("button", { name: "Save alert settings" }));

    expect(await screen.findByText("“Ahead by” takes a whole number from 1 to 500 percent.")).toBeInTheDocument();
    expect(screen.getByText("The caution cannot start earlier than the advisory.")).toBeInTheDocument();
    expect(screen.getByText("Nothing was saved. Fix the marked lights first.")).toBeInTheDocument();
    expect(screen.getByLabelText("Spend pace: Ahead by (percent)")).toHaveAttribute("aria-invalid", "true");
    expect(calls("PUT", "/settings/alert-thresholds")).toHaveLength(0);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("matches the server's bounds at their edges and rejects anything that is not a whole number", () => {
    const pace = SPECS.find((spec) => spec.id === "pace")!;
    const ok = { percent: "500", dollars: "0", from_day: "28" };
    expect(check(pace, ok)).toBeNull();
    expect(check(pace, { ...ok, dollars: "1000001" })).toMatch(/and by/);
    expect(check(pace, { ...ok, from_day: "0" })).toMatch(/From day/);
    for (const bad of ["", "2.5", "-3", "1e2", "twenty"]) expect(check(pace, { ...ok, percent: bad })).toMatch(/Ahead by/);
    const backup = SPECS.find((spec) => spec.id === "backup")!;
    expect(check(backup, { advisory_days: "31", caution_days: "30", grace_days: "0" })).toBe("The advisory cannot come after the caution.");
    expect(SPECS.map((spec) => spec.id)).toEqual(Object.keys(defaults));
    for (const spec of SPECS) expect(spec.fields.map((field) => field.key)).toEqual(Object.keys(defaults[spec.id]).filter((key) => key !== "on"));
  });

  it("shows the server's message beside the light it names and keeps the draft", async () => {
    replies["PUT /settings/alert-thresholds"] = () => {
      throw new Error("util warning_percent: Input should be less than or equal to 200; body: Something else failed");
    };
    const onChanged = open();
    await screen.findByLabelText("Credit use: Warning at (percent of limit)");
    change("Credit use: Warning at (percent of limit)", "95");
    fireEvent.click(screen.getByRole("button", { name: "Save alert settings" }));

    expect(await screen.findByText("“Warning at”: Input should be less than or equal to 200")).toBeInTheDocument();
    expect(screen.getByText("body: Something else failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Credit use: Warning at (percent of limit)")).toHaveValue("95");
    expect(onChanged).not.toHaveBeenCalled();
    expect(sortServerErrors("Request failed (500)")).toEqual({ rows: {}, rest: "Request failed (500)" });
  });

  it("resets to the defaults only after a second, explicit step", async () => {
    replies["GET /settings/alert-thresholds"] = () => ({ ...defaults, overdue: { on: false, warning_days: 9 } });
    open();
    expect(await screen.findByLabelText("Bill overdue: Warning from (days late)")).toHaveValue("9");
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(calls("PUT", "/settings/alert-thresholds")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset" }));

    await screen.findByText("Defaults restored and saved.");
    expect(calls("PUT", "/settings/alert-thresholds")).toEqual([["/settings/alert-thresholds", "PUT", {}]]);
    expect(screen.getByLabelText("Bill overdue: Warning from (days late)")).toHaveValue("3");
    expect(screen.getByRole("switch", { name: "Bill overdue light" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("bitcoin price", () => {
  it("shows the price in use with its source and day, labelled per $1 and per BTC", async () => {
    open();
    const reading = await screen.findByLabelText("Price in use");
    await waitFor(() => expect(reading).toHaveTextContent("₿843"));
    expect(reading).toHaveTextContent("$118,600.00 per BTC");
    expect(reading).toHaveTextContent("Manual · 2026-11-19");
    expect(screen.queryByRole("button", { name: "Refresh now" })).not.toBeInTheDocument();
  });

  it("says a missing price is missing instead of showing a figure", async () => {
    replies["GET /dashboard"] = () => ({ price: null });
    replies["GET /rates"] = () => [];
    open();
    await waitFor(() => expect(screen.getByLabelText("Price in use")).toHaveTextContent("No price saved"));
    expect(screen.getByLabelText("Price in use")).not.toHaveTextContent("₿");
  });

  it("saves the source on top of the freshest saved preferences, changing only its own fields", async () => {
    const onChanged = open();
    const source = await screen.findByLabelText("Price source");
    fireEvent.change(source, { target: { value: "coinbase" } });
    fireEvent.click(screen.getByRole("switch", { name: "Automatic prices" }));
    // Another screen changed the theme after this one loaded.
    replies["GET /settings"] = () => ({ preferences: { ...preferences, theme: "light" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price settings" }));

    await screen.findByText("Price settings saved.");
    expect(calls("PUT", "/settings")).toEqual([["/settings", "PUT", { ...preferences, theme: "light", rate_source: "coinbase", automatic_prices: true }]]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeInTheDocument();
  });

  it("shows the server's message when the price settings are refused", async () => {
    replies["PUT /settings"] = () => {
      throw new Error("Price provider is unavailable");
    };
    const onChanged = open();
    fireEvent.change(await screen.findByLabelText("Price source"), { target: { value: "coingecko" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price settings" }));
    expect(await screen.findByText("Price provider is unavailable")).toHaveAttribute("role", "alert");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("saves a manual price as a decimal string and refuses a malformed one", async () => {
    const onChanged = open();
    const amount = await screen.findByLabelText("Dollars per BTC");
    fireEvent.change(amount, { target: { value: "about 97k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save this price" }));
    expect(await screen.findByText("Enter the dollar price of one BTC, such as 97250.00.")).toBeInTheDocument();
    expect(calls("POST", "/rates")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-11-18" } });
    fireEvent.change(amount, { target: { value: "$97,250.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save this price" }));
    await screen.findByText("Saved $97,250.50 per BTC for Nov 18.");
    expect(calls("POST", "/rates")).toEqual([["/rates", "POST", { day: "2026-11-18", usd_per_btc: "97250.50" }]]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("appearance, backup, password and export", () => {
  it("switches theme and lens through the session", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Price analysis in" })).getByRole("button", { name: "Bitcoin" }));
    expect(session.setTheme).toHaveBeenCalledWith("day");
    expect(session.setLens).toHaveBeenCalledWith("BITCOIN");
    await screen.findByLabelText("Price source");
  });

  it("makes a backup only when the two passphrases match, and shows when the last one was made", async () => {
    replies["GET /audit"] = () => [
      { action: "transaction.create", created_at: "2026-11-19T15:00:00+00:00" },
      { action: "backup.export", created_at: "2026-11-12T15:00:00+00:00" },
    ];
    const onChanged = open();
    const panel = screen.getByRole("region", { name: "Backup: encrypted, kept by you" });
    await waitFor(() => expect(panel).toHaveTextContent(/Last backup made Nov 12, 2026/));
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "correct horse battery" } });
    fireEvent.change(screen.getByLabelText("Passphrase again"), { target: { value: "correct horse batteri" } });
    fireEvent.click(screen.getByRole("button", { name: "Make encrypted backup" }));
    expect(await screen.findByText("The two passphrases do not match. Nothing was made.")).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Passphrase again"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Make encrypted backup" }));
    await screen.findByText(/^Encrypted backup made\./);
    expect(download).toHaveBeenCalledWith("/backup", expect.stringMatching(/^ledger-\d{4}-\d{2}-\d{2}\.albackup$/), { passphrase: "correct horse battery" });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Passphrase")).toHaveValue("");
  });

  it("falls back to the backup light when the record does not show a backup", async () => {
    replies["GET /alerts"] = () => ({ lights: [], active: [{ id: "backup", title: "This ledger has never been backed up" }] });
    open();
    expect(await screen.findByText("This ledger has never been backed up.")).toBeInTheDocument();
  });

  it("changes the password, adopts the new session token and reports a wrong current password", async () => {
    open();
    const fill = (current: string) => {
      fireEvent.change(screen.getByLabelText("Current password"), { target: { value: current } });
      fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a much longer secret" } });
      fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "a much longer secret" } });
      fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    };
    replies["POST /auth/password"] = () => {
      throw new Error("Current password is incorrect");
    };
    fill("wrong one");
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
    expect(setCsrf).not.toHaveBeenCalled();

    replies["POST /auth/password"] = () => ({ username: "owner", csrf: "fresh-token" });
    fill("the right one");
    await screen.findByText("Password changed. Every other session was signed out.");
    expect(calls("POST", "/auth/password").at(-1)).toEqual(["/auth/password", "POST", { current_password: "the right one", new_password: "a much longer secret" }]);
    expect(setCsrf).toHaveBeenCalledWith("fresh-token");
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("refuses a short new password without asking the server", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "anything" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "too short" } });
    fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "too short" } });
    fireEvent.submit(screen.getByRole("button", { name: "Change password" }).closest("form")!);
    expect(await screen.findByText("Use a new password of 12 to 200 characters.")).toBeInTheDocument();
    expect(calls("POST", "/auth/password")).toHaveLength(0);
  });

  it("exports the transactions and the journal as files, and links what is not rebuilt", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Transactions · CSV" }));
    await screen.findByText("Transactions saved as ledger-transactions.csv.");
    fireEvent.click(screen.getByRole("button", { name: "Full journal · JSON" }));
    await screen.findByText("Journal saved as ledger-journal.json.");
    expect(vi.mocked(download).mock.calls).toEqual([
      ["/export/csv", "ledger-transactions.csv"],
      ["/export/journal", "ledger-journal.json"],
    ]);
    expect(screen.getByRole("link", { name: "Open Settings in the previous interface" })).toHaveAttribute("href", "/legacy.html?page=Settings");
    expect(screen.getByRole("link", { name: "Restore in the previous interface" })).toHaveAttribute("href", "/legacy.html?page=Settings");
  });
});
