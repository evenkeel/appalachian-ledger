import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

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

/** A small button that needs a second, separate press; a double-click on the first one does nothing more. */
export function TwoStep({ ask, confirm, label, disabled, onConfirm }: { ask: string; confirm: string; label: string; disabled?: boolean; onConfirm: () => void }) {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  return (
    <button
      type="button"
      className="btn sm ghost"
      disabled={disabled}
      aria-label={armedAt === null ? label : `${confirm}: ${label}`}
      onBlur={() => setArmedAt(null)}
      onClick={() => {
        if (armedAt === null) setArmedAt(Date.now());
        else if (Date.now() - armedAt > 400) {
          setArmedAt(null);
          onConfirm();
        }
      }}
    >
      {armedAt === null ? ask : confirm}
    </button>
  );
}

export interface AccountRow {
  id: number;
  name: string;
  kind: string;
  role: "asset" | "liability";
  currency: "USD" | "BITCOIN";
  archived: boolean;
}
export interface CategoryRow {
  id: number;
  name: string;
  kind: "income" | "expense";
  spending_type?: string | null;
}
export interface PayeeRule {
  match: string;
  category_id: number;
  account_id?: number | null;
}
export interface Lists {
  accounts: AccountRow[];
  categories: CategoryRow[];
  paymentDefaults: Record<string, number>;
  payeeRules: PayeeRule[];
  nodeConfigured: boolean;
}
interface SavedSettings {
  preferences: { category_payment_defaults?: Record<string, number>; payee_rules?: PayeeRule[] };
  node_configured?: boolean;
}

/** Accounts an expense or income can be recorded against. */
export const PAYMENT_KINDS = ["checking", "credit_card", "cash", "savings", "bitcoin_wallet"];

/** The lists several sections share, read once and re-read after a section changes them. */
export function useLists() {
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const [accounts, categories, settings] = await Promise.all([api<AccountRow[]>("/accounts"), api<CategoryRow[]>("/categories"), api<SavedSettings>("/settings")]);
      setLists({
        accounts: accounts.filter((account) => !account.archived),
        categories,
        paymentDefaults: settings.preferences.category_payment_defaults ?? {},
        payeeRules: settings.preferences.payee_rules ?? [],
        nodeConfigured: Boolean(settings.node_configured),
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { lists, error, reload };
}
