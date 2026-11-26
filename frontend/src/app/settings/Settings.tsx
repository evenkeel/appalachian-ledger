import { AuditTrail } from "./Audit";
import type { FormEvent } from "react";
import { api, download, setCsrf } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";
import { AlertLights } from "./AlertLights";
import { Backup, Restore } from "./Backup";
import { BitcoinPrice } from "./BitcoinPrice";
import { Categories, PayeeRules } from "./Categories";
import { ImportCsv } from "./ImportCsv";
import { MissingPrices } from "./MissingPrices";
import { Node } from "./Node";
import { Note, useAction, useLists } from "./controls";
import "./settings.css";


/** Each section saves on its own and says what happened. */
export function Settings({ go, onChanged }: { go: (route: Route) => void; onChanged: () => void }) {
  const { lists, error, reload } = useLists();
  return (
    <div className="page set-page">
      <h1>Settings</h1>
      <p className="intro">Everything here stays on this machine. Each section has its own save, and tells you when it has saved.</p>
      <div className="grid2">
        <div className="band">Alerts and price</div>
        <AlertLights go={go} onChanged={onChanged} />
        <div className="c5 set-col">
          <BitcoinPrice onChanged={onChanged} />
          <MissingPrices onChanged={onChanged} />
          <Appearance />
        </div>

        <div className="band">Your data</div>
        <Backup onChanged={onChanged} />
        <Restore />
        <div className="c4 set-col">
          <ImportCsv lists={lists} onChanged={onChanged} />
          <Export />
        </div>

        <div className="band">Categories and rules</div>
        <Categories lists={lists} error={error} reload={reload} />
        <div className="c5 set-col">
          <PayeeRules lists={lists} reload={reload} />
          <Node lists={lists} />
        </div>

        <div className="band">This ledger</div>
        <Password />
        <AuditTrail className="c8" />
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
      if (!next || next.length > 200) throw new Error("Enter a new password of up to 200 characters.");
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
          <input type="password" name="new_password" autoComplete="new-password" maxLength={200} required />
        </label>
        <label className="field">
          <span>New password again</span>
          <input type="password" name="again" autoComplete="new-password" maxLength={200} required />
        </label>
        <div className="hint">Any password you like. There is no reset by email: this ledger has no outside account.</div>
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

