import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, download, setCsrf } from "../../lib/api";
import type { AlertsData } from "../dashboard/Alerts";
import { Panel } from "../dashboard/panels";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";
import { AlertLights } from "./AlertLights";
import { BitcoinPrice } from "./BitcoinPrice";
import { Note, moment, today, useAction } from "./controls";
import "./settings.css";

const LEGACY = "/legacy.html?page=Settings";

/** Each section saves on its own and says what happened. */
export function Settings({ go, onChanged }: { go: (route: Route) => void; onChanged: () => void }) {
  return (
    <div className="page set-page">
      <h1>Settings</h1>
      <p className="intro">Everything here stays on this machine. Each section has its own save, and tells you when it has saved.</p>
      <div className="grid2">
        <AlertLights go={go} onChanged={onChanged} />
        <div className="c5 set-col">
          <BitcoinPrice onChanged={onChanged} />
          <Appearance />
        </div>
        <Backup onChanged={onChanged} />
        <Password />
        <div className="c4 set-col">
          <Export />
          <More />
        </div>
      </div>
    </div>
  );
}

function Appearance() {
  const { theme, setTheme, lens, setLens } = useSession();
  return (
    <Panel name="Appearance" plain="saved as you choose">
      <div className="set-choice">
        <span id="set-theme">Theme</span>
        <div className="seg" role="group" aria-labelledby="set-theme">
          <button type="button" aria-pressed={theme === "night"} onClick={() => setTheme("night")}>
            Night
          </button>
          <button type="button" aria-pressed={theme === "day"} onClick={() => setTheme("day")}>
            Day
          </button>
        </div>
      </div>
      <div className="set-choice">
        <span id="set-lens">Price analysis in</span>
        <div className="seg" role="group" aria-labelledby="set-lens">
          <button type="button" aria-pressed={lens === "USD"} onClick={() => setLens("USD")}>
            Dollars
          </button>
          <button type="button" aria-pressed={lens === "BITCOIN"} onClick={() => setLens("BITCOIN")}>
            Bitcoin
          </button>
        </div>
      </div>
      <div className="hint">The same switches as the top bar. Recorded amounts never change; only how totals and charts are priced.</div>
    </Panel>
  );
}

type LastBackup = { state: "reading" } | { state: "at"; stamp: string } | { state: "light"; text: string } | { state: "none" } | { state: "unread" };

function Backup({ onChanged }: { onChanged: () => void }) {
  const action = useAction();
  const [last, setLast] = useState<LastBackup>({ state: "reading" });

  const readLast = useCallback(async () => {
    try {
      const [events, alerts] = await Promise.all([api<{ action: string; created_at: string }[]>("/audit"), api<AlertsData>("/alerts")]);
      // The record lists the newest actions first.
      const made = events.find((event) => event.action === "backup.export");
      const light = alerts.active.find((alert) => alert.id === "backup");
      setLast(made ? { state: "at", stamp: made.created_at } : light ? { state: "light", text: light.title } : { state: "none" });
    } catch {
      setLast({ state: "unread" });
    }
  }, []);
  useEffect(() => {
    void readLast();
  }, [readLast]);

  function make(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const passphrase = String(data.get("passphrase") ?? "");
    void action.run(async () => {
      if (passphrase.length < 12 || passphrase.length > 200) throw new Error("Use a passphrase of 12 to 200 characters.");
      if (passphrase !== String(data.get("again") ?? "")) throw new Error("The two passphrases do not match. Nothing was made.");
      await download("/backup", `ledger-${today()}.albackup`, { passphrase });
      form.reset();
      await readLast();
      onChanged();
      return "Encrypted backup made. Check your downloads, then keep a copy off this machine.";
    });
  }

  return (
    <Panel className="c4" name="Backup" plain="encrypted, kept by you">
      <div className="sub">
        {last.state === "reading" && "Checking when the last backup was made…"}
        {last.state === "at" && (
          <>
            Last backup made <b>{moment(last.stamp)}</b>.
          </>
        )}
        {last.state === "light" && <b>{last.text}.</b>}
        {last.state === "none" && "No backup appears in the latest recorded actions."}
        {last.state === "unread" && "Could not read when the last backup was made."}
      </div>
      <form className="set-form plain" onSubmit={make}>
        <label className="field">
          <span>Passphrase</span>
          <input type="password" name="passphrase" autoComplete="new-password" minLength={12} maxLength={200} required />
        </label>
        <label className="field">
          <span>Passphrase again</span>
          <input type="password" name="again" autoComplete="new-password" maxLength={200} required />
        </label>
        <div className="hint">At least 12 characters. It is not stored anywhere: without it, the backup cannot be opened.</div>
        <div className="set-actions">
          <button className="btn primary" disabled={action.busy}>
            {action.busy ? "Making backup…" : "Make encrypted backup"}
          </button>
        </div>
        <Note note={action.note} />
      </form>
      <p className="hint set-foot">
        Restoring a backup has not moved to the new design yet. <a href={LEGACY}>Restore in the previous interface</a>
      </p>
    </Panel>
  );
}

function Password() {
  const action = useAction();
  function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = String(data.get("current_password") ?? ""),
      next = String(data.get("new_password") ?? "");
    void action.run(async () => {
      if (!current) throw new Error("Enter your current password.");
      if (next.length < 12 || next.length > 200) throw new Error("Use a new password of 12 to 200 characters.");
      if (next !== String(data.get("again") ?? "")) throw new Error("The two new passwords do not match. Nothing was changed.");
      const owner = await api<{ csrf: string }>("/auth/password", "POST", { current_password: current, new_password: next });
      setCsrf(owner.csrf);
      form.reset();
      return "Password changed. Every other session was signed out.";
    });
  }
  return (
    <Panel className="c4" name="Password" plain="for this ledger">
      <form className="set-form plain" onSubmit={change}>
        <label className="field">
          <span>Current password</span>
          <input type="password" name="current_password" autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" name="new_password" autoComplete="new-password" minLength={12} maxLength={200} required />
        </label>
        <label className="field">
          <span>New password again</span>
          <input type="password" name="again" autoComplete="new-password" maxLength={200} required />
        </label>
        <div className="hint">At least 12 characters. There is no reset by email: this ledger has no outside account.</div>
        <div className="set-actions">
          <button className="btn primary" disabled={action.busy}>
            Change password
          </button>
        </div>
        <Note note={action.note} />
      </form>
    </Panel>
  );
}

function Export() {
  const action = useAction();
  const save = (path: string, file: string, done: string) =>
    void action.run(async () => {
      await download(path, file);
      return done;
    });
  return (
    <Panel name="Export" plain="plain files, not encrypted">
      <div className="sub">Your records in open formats, saved to your downloads.</div>
      <div className="set-actions">
        <button type="button" className="btn" disabled={action.busy} onClick={() => save("/export/csv", "ledger-transactions.csv", "Transactions saved as ledger-transactions.csv.")}>
          Transactions · CSV
        </button>
        <button type="button" className="btn" disabled={action.busy} onClick={() => save("/export/journal", "ledger-journal.json", "Journal saved as ledger-journal.json.")}>
          Full journal · JSON
        </button>
      </div>
      <div className="hint">The CSV lists every current entry with its purchase-date bitcoin price. The journal is every posting, including reversals.</div>
      <Note note={action.note} />
    </Panel>
  );
}

function More() {
  return (
    <Panel name="More settings" plain="not rebuilt yet" inop>
      <div className="sub">These still work in the previous interface, on the same ledger:</div>
      <ul className="set-more">
        <li>Restore from a backup</li>
        <li>Import a CSV file</li>
        <li>Categories and default payment accounts</li>
        <li>Payee rules</li>
        <li>Watch-only node wallets</li>
        <li>Review expenses that are missing a bitcoin price</li>
      </ul>
      <div>
        <a className="btn sm" href={LEGACY}>
          Open Settings in the previous interface
        </a>
      </div>
    </Panel>
  );
}
