import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, download } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { useSession } from "../lib/session";
import { Note, moment, today, useAction } from "./controls";

type LastBackup = { state: "reading" } | { state: "at"; stamp: string } | { state: "never" } | { state: "unread" };

/** Make an encrypted copy of the whole ledger. The passphrase is never stored. */
export function Backup({ onChanged }: { onChanged: () => void }) {
  const action = useAction();
  const [last, setLast] = useState<LastBackup>({ state: "reading" });

  const readLast = useCallback(async () => {
    try {
      const { last_backup_at } = await api<{ last_backup_at: string | null }>("/backup/status");
      setLast(last_backup_at ? { state: "at", stamp: last_backup_at } : { state: "never" });
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
      <div className="sub" aria-live="polite">
        {last.state === "reading" && "Checking when the last backup was made…"}
        {last.state === "at" && (
          <>
            Last backup made <b>{moment(last.stamp)}</b>.
          </>
        )}
        {last.state === "never" && <b>This ledger has never been backed up.</b>}
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
    </Panel>
  );
}

/** Replace this ledger with a backup. Nothing changes until the server has checked the whole file. */
export function Restore() {
  const { signOut } = useSession();
  const action = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [restored, setRestored] = useState("");

  function ask(event: FormEvent) {
    event.preventDefault();
    action.setNote(null);
    if (!file) return action.setNote({ kind: "error", text: "Choose the backup file first." });
    if (passphrase.length < 12) return action.setNote({ kind: "error", text: "Enter the passphrase the backup was made with. It has at least 12 characters." });
    setConfirming(true);
  }
  function restore() {
    const body = new FormData();
    body.set("passphrase", passphrase);
    body.set("file", file!);
    void action
      .run(async () => {
        const result = await api<{ message?: string }>("/restore", "POST", body);
        setPassphrase("");
        setRestored(result.message || "Restored and verified. Sign in with the restored owner credentials.");
      })
      .then(() => setConfirming(false));
  }
  // The restored ledger has no open sessions, so signing out can only clear this screen.
  const leave = () => void signOut().catch(() => {});

  if (restored)
    return (
      <Panel className="c4" name="Restore" plain="from an encrypted backup">
        <p className="set-note ok" role="status">
          {restored}
        </p>
        <div className="sub">This screen still shows the ledger from before the restore. Sign in again to see the restored one.</div>
        <div className="set-actions">
          <button type="button" className="btn primary" onClick={leave}>
            Sign in again
          </button>
        </div>
      </Panel>
    );

  return (
    <Panel className="c4" name="Restore" plain="from an encrypted backup">
      <div className="sub">Brings back a ledger from a backup file, including one made by an earlier version of this app.</div>
      <form className="set-form plain" onSubmit={ask}>
        <label className="field">
          <span>Backup file</span>
          <input
            type="file"
            name="file"
            accept=".albackup"
            disabled={confirming || action.busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              action.setNote(null);
            }}
          />
        </label>
        <label className="field">
          <span>Backup passphrase</span>
          <input type="password" name="restore_passphrase" autoComplete="off" maxLength={200} value={passphrase} disabled={confirming || action.busy} onChange={(event) => setPassphrase(event.target.value)} />
        </label>
        {confirming ? (
          <div className="set-confirm" role="group" aria-label="Confirm restore">
            <p>
              <b>This replaces everything in this ledger</b> with what is in <span className="num">{file?.name}</span>, and signs you out. Entries made since that backup will be gone. If you may want them back, cancel
              and make a backup first.
            </p>
            <div className="set-actions">
              <button type="button" className="btn primary" disabled={action.busy} onClick={restore}>
                {action.busy ? "Checking and restoring…" : "Yes, replace this ledger"}
              </button>
              <button type="button" className="btn ghost" disabled={action.busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="hint">The file is checked in full before anything is replaced. A wrong passphrase or a damaged file changes nothing.</div>
            <div className="set-actions">
              <button className="btn">Restore this backup…</button>
            </div>
          </>
        )}
        <Note note={action.note} />
      </form>
    </Panel>
  );
}
