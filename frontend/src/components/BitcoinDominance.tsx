import { useModalDialog } from "../lib/useModalDialog";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import type { DominanceHistory, Report } from "../lib/types";

export const dominancePeriods = [
  ["1w", "1 week"],
  ["1m", "1 month"],
  ["6m", "6 months"],
  ["1y", "1 year"],
  ["5y", "5 years"],
  ["max", "Max"],
] as const;
const percent = (value: string | null | undefined) =>
  value == null ? "Unavailable" : `${value}%`;

export function BitcoinDominance({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const dominance = report.ownership.allocation?.bitcoin_dominance ?? null;
  const position =
    dominance == null ? null : Math.max(0, Math.min(100, Number(dominance)));
  const color =
    position == null
      ? "var(--border)"
      : position <= 20
        ? "var(--blue)"
        : position <= 70
          ? "var(--accent)"
          : "var(--red)";
  return (
    <>
      <article
        className="dominance-panel hero-dominance dominance-thermometer-card"
        aria-label="Bitcoin dominance"
      >
        <button
          ref={trigger}
          className="dominance-open"
          onClick={() => setOpen(true)}
          aria-label="Bitcoin dominance · view history"
          aria-haspopup="dialog"
        >
          <h2>Bitcoin Dominance</h2>
          <div className="dominance-temperature">
            <svg
              viewBox="0 0 140 220"
              role="img"
              aria-label={
                dominance == null
                  ? "Bitcoin dominance unavailable"
                  : `Bitcoin dominance thermometer: ${percent(dominance)}`
              }
            >
              <rect
                x="19"
                y="10"
                width="22"
                height="183"
                rx="11"
                fill="var(--surface-alt)"
                stroke="var(--border)"
                strokeWidth="2"
              />
              {position != null && (
                <rect
                  x="25"
                  y={185 - position * 1.7}
                  width="10"
                  height={position * 1.7 + 9}
                  rx="5"
                  fill={color}
                />
              )}
              <circle
                cx="30"
                cy="198"
                r="17"
                fill="var(--surface-alt)"
                stroke="var(--border)"
                strokeWidth="2"
              />
              <circle cx="30" cy="198" r="11" fill={color} />
              {[0, 25, 50, 75, 100].map((value) => (
                <line
                  key={value}
                  x1="46"
                  x2={value % 50 ? "50" : "54"}
                  y1={185 - value * 1.7}
                  y2={185 - value * 1.7}
                  stroke="var(--muted)"
                />
              ))}
              {(position == null || position < 87) && (
                <text x="61" y="18" fill="var(--muted)" fontSize="10">
                  100%
                </text>
              )}
              {(position == null || Math.abs(position - 50) > 13) && (
                <text x="61" y="103" fill="var(--muted)" fontSize="9">
                  50%
                </text>
              )}
              <text x="61" y="188" fill="var(--muted)" fontSize="9">
                0% Net Worth
              </text>
              {position != null && (
                <g>
                  <text
                    x="61"
                    y={Math.min(176, 189 - position * 1.7)}
                    fill="var(--text)"
                    fontSize="12"
                    fontWeight="600"
                  >
                    {percent(dominance)}
                  </text>
                </g>
              )}
            </svg>
          </div>
          {dominance == null && (
            <p className="dominance-note">
              {report.ownership.allocation?.net_worth_usd == null
                ? "Exchange rate needed"
                : "Net worth must be above zero"}
            </p>
          )}
          {dominance != null && Number(dominance) > 100 && (
            <p className="dominance-note">
              Above 100%: debt reduces net worth.
            </p>
          )}
        </button>
      </article>
      {open &&
        createPortal(
          <DominanceHistoryModal
            report={report}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

function DominanceHistoryModal({
  report,
  onClose,
}: {
  report: Report;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useModalDialog(dialog);
  const [period, setPeriod] = useState("6m");
  const [result, setResult] = useState<{
    key: string;
    data: DominanceHistory;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const dominance = report.ownership.allocation?.bitcoin_dominance ?? null;
  const key = `${report.month}:${period}:${report.rate?.usd_per_btc ?? ""}:${dominance}:${retry}`;
  useEffect(() => {
    let alive = true;
    api<DominanceHistory>(`/dominance?month=${report.month}&period=${period}`)
      .then((data) => {
        if (alive) setResult({ key, data });
      })
      .catch((error: Error) => {
        if (alive) setFailure({ key, message: error.message });
      });
    return () => {
      alive = false;
    };
  }, [key, period, report.month]);
  const response = result?.key === key ? result.data : null;
  const error = failure?.key === key ? failure.message : null;
  const points = (response?.points ?? []).map((point) => ({
    ...point,
    value:
      point.bitcoin_dominance == null ? null : Number(point.bitcoin_dominance),
  }));
  const daily = response?.resolution === "daily";
  const hasHistory = points.some((point) => point.value != null);
  return (
    <dialog
      ref={dialog}
      className="entry-dialog dominance-history-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={title}>Bitcoin dominance history</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close dominance history"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <div className="dominance-history-body">
        <div className="panel-heading">
          <div>
            <h3>Bitcoin Dominance</h3>
          </div>
          <select
            aria-label="Dominance history period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {dominancePeriods.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div
          className={`dominance-value${dominance == null ? " is-unavailable" : ""}`}
        >
          {percent(dominance)}
        </div>
        {dominance == null && (
          <p className="dominance-note">
            {report.ownership.allocation?.net_worth_usd == null
              ? "Exchange rate needed"
              : "Net worth must be above zero"}
          </p>
        )}
        {dominance != null && Number(dominance) > 100 && (
          <p className="dominance-note">
            Debt brings net worth below bitcoin holdings.
          </p>
        )}
        {error ? (
          <div className="dominance-empty" role="alert">
            {error}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : !response ? (
          <div className="dominance-empty" role="status">
            Loading history…
          </div>
        ) : hasHistory ? (
          <div
            className="dominance-chart"
            role="img"
            aria-label="Bitcoin share of net worth over time"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points}
                margin={{ top: 8, right: 12, bottom: 6, left: 0 }}
              >
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                  interval="preserveStartEnd"
                  tick={{ fill: "var(--muted)", fontSize: 12 }}
                  tickFormatter={(day: string) =>
                    new Date(`${day}T12:00:00`).toLocaleDateString(
                      undefined,
                      daily
                        ? { month: "short", day: "numeric" }
                        : { month: "short", year: "2-digit" },
                    )
                  }
                />
                <YAxis
                  domain={[
                    (min: number) => Math.min(0, min),
                    (max: number) => Math.max(100, max),
                  ]}
                  width={44}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 12 }}
                  tickFormatter={(value: number) => `${value}%`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as
                      (typeof points)[number] | undefined;
                    return active && point ? (
                      <div className="chart-tooltip">
                        <strong>{point.date}</strong>
                        <div>{percent(point.bitcoin_dominance)}</div>
                      </div>
                    ) : null;
                  }}
                />
                <Line
                  dataKey="value"
                  type="linear"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  dot={
                    points.length < 40
                      ? { r: 3, strokeWidth: 0, fill: "var(--accent)" }
                      : false
                  }
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="dominance-empty">No history available</div>
        )}
        {response && (
          <details className="dominance-details">
            <summary>{daily ? "Daily values" : "Monthly values"}</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="numeric">Bitcoin dominance</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td>
                      <td className="numeric">
                        {percent(point.bitcoin_dominance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </dialog>
  );
}
