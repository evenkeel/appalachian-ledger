import { useCallback, useState } from "react";

export interface NoteText {
  kind: "ok" | "error";
  text: string;
}

/** One section's save: busy while it runs, then a line saying what happened. Nothing saves silently. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<NoteText | null>(null);
  const run = useCallback(async (action: () => Promise<string | void>) => {
    setBusy(true);
    setNote(null);
    try {
      const text = await action();
      if (text) setNote({ kind: "ok", text });
      return true;
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, note, setNote, run };
}

export function Note({ note }: { note: NoteText | null }) {
  if (!note) return null;
  return (
    <p className={`set-note ${note.kind}`} role={note.kind === "error" ? "alert" : "status"}>
      {note.text}
    </p>
  );
}

/** On or off. The word beside the track carries the state as well as the colour. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" className="set-switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <i aria-hidden="true" />
      <span aria-hidden="true">{checked ? "On" : "Off"}</span>
    </button>
  );
}

export const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export const moment = (stamp: string) =>
  new Date(stamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
