import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, download, setCsrf } from "../../lib/api";
import { Settings } from "./Settings";
import { SPECS, check, sortServerErrors } from "./thresholds";

vi.mock("../../lib/api", () => ({ api: vi.fn(), download: vi.fn(), setCsrf: vi.fn() }));
const session = { theme: "night", lens: "USD", setTheme: vi.fn(), setLens: vi.fn(), signOut: vi.fn(async () => {}) };
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
const accounts = [
  { id: 2, name: "Everyday checking", kind: "checking", role: "asset", currency: "USD", archived: false },
  { id: 8, name: "Ridgeline Visa", kind: "credit_card", role: "liability", currency: "USD", archived: false },
  { id: 5, name: "Cold storage", kind: "bitcoin_wallet", role: "asset", currency: "BITCOIN", archived: false },
  { id: 6, name: "Old checking", kind: "checking", role: "asset", currency: "USD", archived: true },
  { id: 9, name: "Blue Ridge home", kind: "real_estate", role: "asset", currency: "USD", archived: false },
];
const categories = [
  { id: 2, name: "Groceries", kind: "expense", spending_type: "essential" },
  { id: 3, name: "Dining", kind: "expense", spending_type: null },
  { id: 1, name: "Salary", kind: "income", spending_type: null },
];
const pause = () => new Promise((resolve) => setTimeout(resolve, 450));
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
  session.signOut.mockClear();
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
    "GET /backup/status": () => ({ last_backup_at: null }),
    "GET /accounts": () => accounts,
    "GET /categories": () => categories,
    "GET /prices/conversions": () => ({ missing: 0, items: [] }),
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
    replies["GET /backup/status"] = () => ({ last_backup_at: "2026-11-12T15:00:00+00:00" });
    const onChanged = open();
    const panel = screen.getByRole("region", { name: "Backup: encrypted, kept by you" });
    await waitFor(() => expect(panel).toHaveTextContent(/Last backup made Nov 12, 2026/));
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "correct horse battery" } });
    fireEvent.change(screen.getByLabelText("Passphrase again"), { target: { value: "correct horse batteri" } });
    fireEvent.click(screen.getByRole("button", { name: "Make encrypted backup" }));
    expect(await screen.findByText("The two passphrases do not match. Nothing was made.")).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();

    replies["GET /backup/status"] = () => ({ last_backup_at: "2026-11-19T18:30:00+00:00" });
    fireEvent.change(screen.getByLabelText("Passphrase again"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Make encrypted backup" }));
    await screen.findByText(/^Encrypted backup made\./);
    expect(download).toHaveBeenCalledWith("/backup", expect.stringMatching(/^ledger-\d{4}-\d{2}-\d{2}\.albackup$/), { passphrase: "correct horse battery" });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Passphrase")).toHaveValue("");
    // The time is read again from the server, not assumed.
    expect(panel).toHaveTextContent(/Last backup made Nov 19, 2026/);
  });

  it("says a ledger that was never backed up has never been backed up", async () => {
    open();
    expect(await screen.findByText("This ledger has never been backed up.")).toBeInTheDocument();
    expect(calls("GET", "/backup/status")).toHaveLength(1);
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
    // Nothing on this screen sends the owner back to the previous interface.
    expect(document.querySelector('a[href*="legacy.html"]')).toBeNull();
  });

  it("shows the record of actions only when asked, in plain words", async () => {
    open();
    const panel = screen.getByRole("region", { name: "Record of actions: every change, newest first" });
    expect(calls("GET", "/audit")).toHaveLength(0);
    replies["GET /audit"] = () => [
      { id: 9, action: "recurring_bill.destroy", entity: "4", detail: { monthly_freed: "22.99" }, created_at: "2026-11-19T15:02:00+00:00" },
      { id: 8, action: "backup.export", entity: "1", detail: {}, created_at: "2026-11-18T09:30:00+00:00" },
    ];
    fireEvent.click(within(panel).getByRole("button", { name: "Show the latest actions" }));
    expect(await within(panel).findByText("Recurring bill · destroy")).toBeInTheDocument();
    expect(within(panel).getByText("Backup · export")).toBeInTheDocument();
  });
});

describe("restore", () => {
  const backupFile = () => new File(["encrypted bytes"], "ledger-2026-11-01.albackup");
  const choose = (passphrase: string) => {
    fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [backupFile()] } });
    change("Backup passphrase", passphrase);
    fireEvent.click(screen.getByRole("button", { name: "Restore this backup…" }));
  };

  it("asks a second time, sends the file and passphrase as a form, then ends the session", async () => {
    replies["POST /restore"] = () => ({ ok: true, message: "Restored and verified. Sign in with the restored owner credentials." });
    open();
    choose("correct horse battery");
    expect(calls("POST", "/restore")).toHaveLength(0);
    const confirm = screen.getByRole("group", { name: "Confirm restore" });
    expect(confirm).toHaveTextContent("This replaces everything in this ledger with what is in ledger-2026-11-01.albackup, and signs you out.");

    fireEvent.click(within(confirm).getByRole("button", { name: "Yes, replace this ledger" }));
    expect(await screen.findByText("Restored and verified. Sign in with the restored owner credentials.")).toHaveAttribute("role", "status");
    const sent = calls("POST", "/restore");
    expect(sent).toHaveLength(1);
    const body = sent[0][2] as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()].sort()).toEqual(["file", "passphrase"]);
    expect(body.get("passphrase")).toBe("correct horse battery");
    expect((body.get("file") as File).name).toBe("ledger-2026-11-01.albackup");

    expect(session.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal, keeps the session and lets the owner try again", async () => {
    replies["POST /restore"] = () => {
      throw new Error("Backup passphrase is incorrect or backup is damaged");
    };
    open();
    choose("not the right phrase");
    fireEvent.click(screen.getByRole("button", { name: "Yes, replace this ledger" }));
    expect(await screen.findByText("Backup passphrase is incorrect or backup is damaged")).toHaveAttribute("role", "alert");
    expect(session.signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("group", { name: "Confirm restore" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Restore this backup…" })).toBeInTheDocument();
  });

  it("does not reach the confirmation without a file and a passphrase, and cancelling sends nothing", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Restore this backup…" }));
    expect(await screen.findByText("Choose the backup file first.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [backupFile()] } });
    change("Backup passphrase", "too short");
    fireEvent.click(screen.getByRole("button", { name: "Restore this backup…" }));
    expect(await screen.findByText(/^Enter the passphrase the backup was made with/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Confirm restore" })).not.toBeInTheDocument();

    change("Backup passphrase", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Restore this backup…" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm restore" })).not.toBeInTheDocument();
    expect(calls("POST", "/restore")).toHaveLength(0);
  });
});

describe("csv import", () => {
  const csv = () => new File(["date,kind,amount,description,category\n"], "october.csv", { type: "text/csv" });

  it("posts the chosen account and file and reports what the server imported and skipped", async () => {
    replies["POST /import/csv"] = () => ({ imported: 12, duplicates: 3 });
    const onChanged = open();
    const account = await screen.findByLabelText("Into account");
    await waitFor(() => expect(within(account).getByRole("option", { name: "Ridgeline Visa · dollars" })).toBeInTheDocument());
    // Closed accounts and valued assets cannot take imported entries.
    expect(within(account).queryByRole("option", { name: /Old checking|Blue Ridge home/ })).not.toBeInTheDocument();

    fireEvent.change(account, { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [csv()] } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Imported 12 entries. Skipped 3 rows already in the ledger.")).toBeInTheDocument();
    const body = calls("POST", "/import/csv")[0][2] as FormData;
    expect(body.get("account_id")).toBe("8");
    expect((body.get("file") as File).name).toBe("october.csv");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("names the columns the server requires and shows which row it refused", async () => {
    replies["POST /import/csv"] = () => {
      throw new Error("CSV row 4: Unknown category or mismatched category type");
    };
    const onChanged = open();
    const panel = screen.getByRole("region", { name: "Import a CSV file: income and expenses" });
    for (const column of ["date", "kind", "amount", "description", "category", "external_id", "notes"]) expect(within(panel).getAllByText(column, { selector: "code" }).length).toBeGreaterThan(0);

    await waitFor(() => expect(within(screen.getByLabelText("Into account")).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Choose the account these entries belong to.");
    expect(calls("POST", "/import/csv")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Into account"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [csv()] } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("CSV row 4: Unknown category or mismatched category type")).toHaveAttribute("role", "alert");
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("categories", () => {
  it("adds a category and reads the list again", async () => {
    replies["POST /categories"] = () => ({ id: 7 });
    open();
    await screen.findByLabelText("Spending type for Groceries");
    change("New category", "  Garden  ");
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await screen.findByText("Added Garden.");
    expect(calls("POST", "/categories")).toEqual([["/categories", "POST", { name: "Garden", kind: "expense" }]]);
    expect(calls("GET", "/categories")).toHaveLength(2);
  });

  it("removes a category only on a second press, and shows why the server refused", async () => {
    replies["DELETE /categories/3"] = () => ({ ok: true });
    replies["DELETE /categories/2"] = () => {
      throw new Error("This category is used by transactions and cannot be deleted.");
    };
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Dining" }));
    // A double-click lands on the same button; it is not the confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove: Remove Dining" }));
    expect(calls("DELETE", "/categories/3")).toHaveLength(0);
    await pause();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove: Remove Dining" }));
    await screen.findByText("Removed Dining.");
    expect(calls("DELETE", "/categories/3")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove Groceries" }));
    await pause();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove: Remove Groceries" }));
    expect(await screen.findByText("This category is used by transactions and cannot be deleted.")).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Spending type for Groceries")).toBeInTheDocument();
  });

  it("saves a spending type, and a usual account on top of the freshest saved defaults", async () => {
    replies["PUT /categories/3/spending-type"] = () => ({ ok: true });
    replies["PUT /settings/payment-defaults"] = () => ({ ok: true });
    open();
    expect(await screen.findByLabelText("Spending type for Groceries")).toHaveValue("essential");
    expect(screen.getByLabelText("Usually paid from, for Dining")).toHaveValue("2");
    expect(screen.queryByLabelText("Spending type for Salary")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Spending type for Dining"), { target: { value: "discretionary" } });
    await screen.findByText("Dining is now discretionary.");
    expect(calls("PUT", "/categories/3/spending-type")).toEqual([["/categories/3/spending-type", "PUT", { spending_type: "discretionary" }]]);

    // Another screen saved a default for a different category after this one loaded.
    replies["GET /settings"] = () => ({ preferences: { ...preferences, category_payment_defaults: { "3": 2, "11": 8 } } });
    fireEvent.change(screen.getByLabelText("Usually paid from, for Groceries"), { target: { value: "8" } });
    await screen.findByText("Groceries is usually paid from Ridgeline Visa.");
    expect(calls("PUT", "/settings/payment-defaults")).toEqual([["/settings/payment-defaults", "PUT", { category_payment_defaults: { "3": 2, "11": 8, "2": 8 } }]]);
  });

  it("removes one payee rule from the rules the server holds now", async () => {
    const rules = [
      { match: "Mountain Market", category_id: 2, account_id: 8 },
      { match: "Payroll", category_id: 1, account_id: null },
    ];
    replies["GET /settings"] = () => ({ preferences: { ...preferences, payee_rules: rules } });
    replies["PUT /settings/payee-rules"] = () => ({ ok: true });
    open();
    const panel = await screen.findByRole("region", { name: "Payee rules: 2 rules" });
    expect(within(panel).getByText("Expense · Groceries · Ridgeline Visa")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Remove the rule for Mountain Market" }));
    await pause();
    fireEvent.click(within(panel).getByRole("button", { name: /^Yes, remove/ }));
    await screen.findByText("Removed the rule for “Mountain Market”.");
    expect(calls("PUT", "/settings/payee-rules")).toEqual([["/settings/payee-rules", "PUT", { payee_rules: [rules[1]] }]]);
  });
});

describe("missing prices", () => {
  const items = [
    { entry_id: 41, rate_id: 7, date: "2026-10-03", description: "Hardware store", source: "Manual", method: "manual", usd_per_btc: "110000.00", bitcoin: "38182", usd: "42.00" },
    { entry_id: 44, rate_id: 9, date: "2026-10-09", description: "Fuel", source: "Coinbase", method: "daily_close", usd_per_btc: "112500.00", bitcoin: "48889", usd: "55.00" },
  ];

  it("attaches exactly the previewed prices and nothing else", async () => {
    replies["GET /prices/conversions"] = () => ({ missing: 3, items });
    replies["POST /prices/conversions"] = () => {
      replies["GET /prices/conversions"] = () => ({ missing: 1, items: [] });
      return { attached: 2 };
    };
    const onChanged = open();
    const panel = screen.getByRole("region", { name: "Missing prices: entries recorded without a bitcoin price" });
    await waitFor(() => expect(panel).toHaveTextContent("3 entries have no bitcoin price. 2 can be priced now from a price already saved for that day; 1 has no saved price for its day yet."));
    expect(within(panel).getByRole("row", { name: /Hardware store/ })).toHaveTextContent("Oct 3Hardware store$42.00₿38,182Manual");
    expect(panel).toHaveTextContent("Nothing is guessed");
    expect(calls("POST", "/prices/conversions")).toHaveLength(0);

    fireEvent.click(within(panel).getByRole("button", { name: "Attach 2 saved prices" }));
    await screen.findByText("Attached a saved price to 2 entries.");
    expect(calls("POST", "/prices/conversions")).toEqual([
      [
        "/prices/conversions",
        "POST",
        {
          items: [
            { entry_id: 41, rate_id: 7 },
            { entry_id: 44, rate_id: 9 },
          ],
        },
      ],
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The preview is read again; what is left cannot be priced yet, so there is nothing to attach.
    await waitFor(() => expect(panel).toHaveTextContent("1 entry has no bitcoin price. 0 can be priced now"));
    expect(within(panel).queryByRole("button", { name: /^Attach/ })).not.toBeInTheDocument();
  });

  it("says so when every entry already has a price", async () => {
    open();
    expect(await screen.findByText("Every entry has a bitcoin price for its day. Nothing to do.")).toBeInTheDocument();
  });

  it("shows the server's message when a previewed price changed before it was attached", async () => {
    replies["GET /prices/conversions"] = () => ({ missing: 2, items });
    replies["POST /prices/conversions"] = () => {
      throw new Error("The selected price changed since review. Refresh the preview.");
    };
    const onChanged = open();
    fireEvent.click(await screen.findByRole("button", { name: "Attach 2 saved prices" }));
    expect(await screen.findByText("The selected price changed since review. Refresh the preview.")).toHaveAttribute("role", "alert");
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("your own node", () => {
  it("explains that no node is set up and asks the server nothing about one", async () => {
    open();
    expect(await screen.findByText("No Bitcoin Core node is set up on this server. The ledger works fully without one.")).toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.some(([path]) => String(path).startsWith("/node"))).toBe(false);
  });

  it("compares a connected watch-only wallet with the ledger in whole bitcoin", async () => {
    replies["GET /settings"] = () => ({ preferences, node_configured: true, demo: false });
    replies["GET /node/wallets"] = () => [{ id: 4, account_id: 5, wallet: "ledger-watch", last_checked: null }];
    replies["GET /node/wallets/4/reconcile"] = () => ({ balance_bitcoin: "23025800", pending_bitcoin: "0", ledger_balance: "23000000", difference: "25800", transactions: [], checked_at: "2026-11-19T18:30:00+00:00", history_limit: 100 });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Compare ledger-watch with the ledger" }));
    const result = await screen.findByLabelText("ledger-watch compared with the ledger");
    expect(result).toHaveTextContent("On the node₿23,025,800");
    expect(result).toHaveTextContent("In the ledger₿23,000,000");
    expect(result).toHaveTextContent("Difference₿25,800");
  });
});
