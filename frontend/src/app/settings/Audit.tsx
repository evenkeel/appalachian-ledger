import { useState } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { moment } from "./controls";

interface Event {
  id: number;
  action: string;
  entity: string;
  detail: unknown;
  created_at: string;
}

/** "recurring_bill.destroy" reads as "Recurring bill · destroy". */
export const actionName = (action: string) => {
  const [thing, ...rest] = action.split(".");
  const words = thing.replace(/_/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${rest.length ? ` · ${rest.join(" ").replace(/_/g, " ")}` : ""}`;
};
const SHOWN = 25;

/** The record of every action taken on this ledger. Read-only; nothing here can be changed or removed. */
export function AuditTrail({ className }: { className?: string }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  async function load() {
    setBusy(true);
    setError("");
    try {
      setEvents(await api<Event[]>("/audit"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shown = events ? (all ? events : events.slice(0, SHOWN)) : [];
  return (
    <Panel className={className} name="Record of actions" plain="every change, newest first">
      {events === null ? (
        <>
          <div className="sub">Every save, payment, correction, backup and settings change is written down with its time. The record is read-only.</div>
          <div>
            <button className="btn sm" disabled={busy} onClick={() => void load()}>
              Show the latest actions
            </button>
          </div>
        </>
      ) : events.length === 0 ? (
        <div className="sub">Nothing has been recorded yet.</div>
      ) : (
        <>
          <ul className="set-audit">
            {shown.map((event) => (
              <li key={event.id}>
                <details>
                  <summary>
                    <span className="num dim">{moment(event.created_at)}</span>
                    <span>{actionName(event.action)}</span>
                  </summary>
                  <pre>{JSON.stringify({ entity: event.entity, detail: event.detail }, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
          <div className="sub">
            {!all && events.length > SHOWN ? (
              <button className="inst-link" onClick={() => setAll(true)}>
                Show all {events.length} →
              </button>
            ) : (
              `The latest ${events.length} ${events.length === 1 ? "action" : "actions"}. Older ones stay in the database.`
            )}
          </div>
        </>
      )}
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
