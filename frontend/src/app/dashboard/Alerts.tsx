import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { LevelIcon } from "../design/icons";
import { btc, plural, usd } from "../lib/format";
import type { Route } from "../lib/router";
import { Private, PrivateText } from "../lib/privacy";

export type Level = "advisory" | "caution" | "warning";
type Unit = "USD" | "BITCOIN" | "percent" | "days" | "count" | "text";
interface Value {
  value: string;
  unit: Unit;
}
export interface Alert {
  id: string;
  level: Level;
  magnitude: string;
  acknowledged: boolean;
  panel: string | null;
  title: string;
  why: string;
  facts: ({ label: string } & Value)[];
  rows: ({ name: string; note: string } & Value)[];
  advice: ({ text: string } & Value) | null;
  action: { label: string; route?: Route; bill_id?: number } | null;
}
export interface AlertsData {
  lights: { id: string; label: string }[];
  active: Alert[];
}

const RANK: Record<Level, number> = { warning: 3, caution: 2, advisory: 1 };
const byRank = (alerts: Alert[]) => [...alerts].sort((a, b) => RANK[b.level] - RANK[a.level]);

export function formatValue({ value, unit }: Value) {
  if (unit === "USD") return usd(value);
  if (unit === "BITCOIN") return btc(value);
  if (unit === "percent") return `${Number(value).toFixed(0)}%`;
  if (unit === "days") return plural(Number(value), "day");
  return value;
}

/** Alert readings, shared by the top bar and the dashboard. An older server simply shows no lights. */
export function useAlerts(enabled: boolean) {
  const [data, setData] = useState<AlertsData | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await api<AlertsData>("/alerts"));
    } catch {
      setData(null);
    }
  }, []);
  useEffect(() => {
    if (enabled) void refresh();
    else setData(null);
  }, [enabled, refresh]);
  const acknowledge = useCallback(
    async (id?: string) => {
      await api(id ? `/alerts/${id}/acknowledge` : "/alerts/acknowledge-all", "POST").catch(() => {});
      await refresh();
    },
    [refresh],
  );
  return { data, refresh, acknowledge };
}

/** The fixed row of lights. A dark light is normal. Level is carried by shape, word and colour. */
export function Lights({ data, onOpen }: { data: AlertsData; onOpen: (id: string) => void }) {
  const active = new Map(data.active.map((alert) => [alert.id, alert]));
  return (
    <section className="annun" aria-label="Alerts">
      {data.active.length ? (
        <span className="annun-state">{data.active.length} active</span>
      ) : (
        <span className="annun-state ok">{LevelIcon.ok} All normal</span>
      )}
      <div className="lamps" role="list">
        {data.lights.map((light) => {
          const alert = active.get(light.id);
          return alert ? (
            <button
              key={light.id}
              role="listitem"
              className={`lamp on l-${alert.level}${alert.acknowledged ? " acked" : ""}`}
              aria-label={`${alert.level}: ${light.label}. ${alert.title}${alert.acknowledged ? " (acknowledged)" : ""}`}
              onClick={() => onOpen(light.id)}
            >
              {LevelIcon[alert.level]}
              <span>{light.label}</span>
            </button>
          ) : (
            <span key={light.id} role="listitem" className="lamp" aria-label={`${light.label}: normal`}>
              {light.label}
            </span>
          );
        })}
      </div>
    </section>
  );
}

/** Top-bar button: lit while any caution or warning is unacknowledged. */
export function AlertsButton({ data, onOpen }: { data: AlertsData | null; onOpen: () => void }) {
  const serious = (data?.active ?? []).filter((alert) => alert.level !== "advisory");
  const fresh = serious.filter((alert) => !alert.acknowledged);
  const top = fresh.some((alert) => alert.level === "warning") ? "warn" : fresh.length ? "caution" : "";
  const text = top ? (top === "warn" ? "Warnings" : "Cautions") : serious.length ? `${serious.length} acknowledged` : "No alerts";
  return (
    <button
      className={`master${top ? ` is-${top}` : serious.length ? " is-acked" : ""}`}
      aria-label={`${text}. ${fresh.length} unacknowledged.`}
      onClick={onOpen}
    >
      {top === "warn" ? LevelIcon.warning : LevelIcon.caution}
      <span className="txt">{text}</span>
      {fresh.length > 0 && <span className="num">{fresh.length}</span>}
    </button>
  );
}

/** Each light opens its own detail; `open === ""` lists every active alert. */
export function AlertDrawer({
  data,
  open,
  onOpen,
  onClose,
  onAcknowledge,
  onRoute,
  onPayBill,
}: {
  data: AlertsData;
  open: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  onAcknowledge: (id?: string) => void;
  onRoute: (route: Route) => void;
  onPayBill: (billId: number) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const label = (alert: Alert) => data.lights.find((light) => light.id === alert.id)?.label ?? alert.id;
  const list = byRank(data.active);
  const one = list.find((alert) => alert.id === open);
  const close = (
    <button className="btn sm ghost" onClick={onClose}>
      Close <kbd>Esc</kbd>
    </button>
  );
  const frame = (title: string, extra: ReactNode, body: ReactNode) => (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          {extra}
          {close}
        </header>
        <div className="body">{body}</div>
      </aside>
    </>
  );
  if (!one)
    return frame(
      `All alerts · ${list.length} active`,
      list.some((alert) => !alert.acknowledged && alert.level !== "advisory") && (
        <button className="btn sm" onClick={() => onAcknowledge()}>
          Acknowledge all
        </button>
      ),
      <>
        {list.length ? (
          list.map((alert) => (
            <button key={alert.id} className={`alert ${alert.level} alert-row`} onClick={() => onOpen(alert.id)}>
              <span className={`flagchip ${alert.level}`}>
                {LevelIcon[alert.level]}
                {label(alert)}
                {alert.acknowledged ? " · acknowledged" : ""}
              </span>
              <span className="t"><PrivateText text={alert.title} /></span>
              <span className="dim">Details →</span>
            </button>
          ))
        ) : (
          <p className="sub">{LevelIcon.ok} All normal. Nothing needs you.</p>
        )}
        <p className="hint">Thresholds are adjustable in Settings → Alerts.</p>
      </>,
    );
  const others = list.filter((alert) => alert !== one);
  const action = one.action;
  return frame(
    label(one),
    null,
    <>
      <article className={`alert ${one.level}`}>
        <span className={`flagchip ${one.level}`}>
          {LevelIcon[one.level]}
          {one.level}
          {one.acknowledged ? " · acknowledged" : ""}
        </span>
        <h3><PrivateText text={one.title} /></h3>
        <p><PrivateText text={one.why} /></p>
        {one.facts.length > 0 && (
          <div className="kv">
            {one.facts.map((fact) => (
              <div key={fact.label}>
                <span>{fact.label}</span>
                <b><Private when={fact.unit === "BITCOIN"}>{formatValue(fact)}</Private></b>
              </div>
            ))}
          </div>
        )}
        {one.rows.length > 0 && (
          <ul className="rows">
            {one.rows.map((row, index) => (
              <li key={index} style={{ gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center" }}>
                <span className="nm">
                  {row.name}
                  {row.note && <small className="num dim"> · {row.note}</small>}
                </span>
                <span className="num"><Private when={row.unit === "BITCOIN"}>{formatValue(row)}</Private></span>
              </li>
            ))}
          </ul>
        )}
        {one.advice && (
          <p>
            {one.advice.text.split("{value}")[0]}
            <b className="num"><Private when={one.advice.unit === "BITCOIN"}>{formatValue(one.advice)}</Private></b>
            {one.advice.text.split("{value}")[1] ?? ""}
          </p>
        )}
        <div className="acts">
          {action && (
            <button
              className="btn primary"
              onClick={() => (action.bill_id != null ? onPayBill(action.bill_id) : action.route && onRoute(action.route))}
            >
              {action.label}
              {action.bill_id == null && " →"}
            </button>
          )}
          {!one.acknowledged && (
            <button className="btn ghost" onClick={() => onAcknowledge(one.id)}>
              Acknowledge
            </button>
          )}
        </div>
        {one.acknowledged && <p className="hint">Stays lit until fixed. Comes back to your attention if it gets worse.</p>}
      </article>
      {others.length > 0 && (
        <>
          <div className="hint" style={{ marginTop: 6 }}>
            Other alerts
          </div>
          <div className="others">
            {others.map((alert) => (
              <button key={alert.id} className={`lamp on l-${alert.level}${alert.acknowledged ? " acked" : ""}`} onClick={() => onOpen(alert.id)}>
                {LevelIcon[alert.level]}
                <span>{label(alert)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>,
  );
}
