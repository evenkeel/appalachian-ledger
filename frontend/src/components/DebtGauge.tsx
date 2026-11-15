import { useModalDialog } from "../lib/useModalDialog";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import type { DebtGaugeData } from "../lib/types";
import { Button } from "./ui/button";
import { Field } from "./EntryDialog";
import { Money } from "./Money";

const bands = [
  { key: "low", label: "Low", color: "#84b69d" },
  { key: "medium", label: "Medium", color: "#d4b558" },
  { key: "high", label: "High", color: "#e89a4b" },
  { key: "dangerous", label: "Dangerous", color: "#e46861" },
] as const;
function point(angle: number, radius = 92) {
  const radians = (angle * Math.PI) / 180;
  return [120 + radius * Math.cos(radians), 120 + radius * Math.sin(radians)];
}

export function DebtGauge({
  data,
  onSaved,
}: {
  data: DebtGaugeData;
  onSaved: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const selected = bands.find((band) => band.key === data.level);
  const needle =
    data.position == null
      ? null
      : point(-180 + Number(data.position) * 1.8, 71);
  return (
    <section className="debt-gauge" aria-label="Consumer Debt Level gauge">
      <div className="debt-gauge-heading">
        <h3>Consumer Debt Level</h3>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          {data.limits ? "Calibrate" : "Set levels"}
        </Button>
      </div>
      <div className="debt-gauge-body">
        <svg
          viewBox="0 0 240 160"
          role="img"
          aria-label={
            selected
              ? `Consumer Debt Level: ${selected.label}`
              : "Consumer debt gauge: not calibrated"
          }
        >
          {bands.map((band, index) => {
            const start = point(-180 + index * 45 + 1.5),
              end = point(-180 + (index + 1) * 45 - 1.5);
            return (
              <path
                key={band.key}
                d={`M${start[0]},${start[1]} A92,92 0 0,1 ${end[0]},${end[1]}`}
                fill="none"
                stroke={data.limits ? band.color : "var(--border)"}
                strokeWidth="17"
              />
            );
          })}
          {needle && (
            <>
              <line
                x1="120"
                y1="120"
                x2={needle[0]}
                y2={needle[1]}
                stroke="var(--text)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle cx="120" cy="120" r="6" fill="var(--text)" />
            </>
          )}
          <text
            x="120"
            y="150"
            textAnchor="middle"
            fill={selected?.color ?? "var(--muted)"}
            fontSize="15"
            fontWeight="600"
          >
            {selected?.label ??
              (data.limits ? "Price needed" : "Set your levels")}
          </text>
        </svg>
        <div className="debt-gauge-reading">
          <Money value={data.debt_usd} unit="USD" />
        </div>
      </div>
      {editing && (
        <DebtCalibration
          data={data}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setEditing(false);
            onSaved(message);
          }}
        />
      )}
    </section>
  );
}

function DebtCalibration({
  data,
  onClose,
  onSaved,
}: {
  data: DebtGaugeData;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useModalDialog(dialog);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/debt-limits", "PUT", {
        low: form.get("low"),
        medium: form.get("medium"),
        high: form.get("high"),
      });
      onSaved("Consumer debt levels saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entry-dialog"
      aria-labelledby="debt-calibration-title"
      onCancel={(event) => {
        event.stopPropagation();
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="dialog-heading">
          <h2 id="debt-calibration-title">Your consumer debt levels</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close consumer debt calibration"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="stack debt-calibration-fields">
          <p className="hint">
            Choose the maximum consumer debt for each level, in USD. Mortgage
            balances are excluded.
          </p>
          {bands.slice(0, 3).map((band) => (
            <Field key={band.key} label={`${band.label} · up to USD`}>
              <input
                name={band.key}
                inputMode="decimal"
                required
                maxLength={20}
                defaultValue={
                  data.limits?.[band.key as "low" | "medium" | "high"] ?? ""
                }
                disabled={busy}
              />
            </Field>
          ))}
          <p className="hint">
            Above High is Dangerous. Spending on credit raises the gauge;
            repayments lower it.
          </p>
        </div>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button disabled={busy}>{busy ? "Saving…" : "Save levels"}</Button>
        </div>
      </form>
    </dialog>
  );
}
