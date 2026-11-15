import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Pencil, Plus, Target, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { formatMoney } from "../lib/money";
import { useModalDialog } from "../lib/useModalDialog";
import type { Account, Goal } from "../lib/types";
import { Field } from "./EntryDialog";
import { Button } from "./ui/button";

const GOAL_KINDS = [
  "savings",
  "checking",
  "cash",
  "bitcoin_wallet",
  "brokerage",
  "stock",
  "etf",
];
const dateLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

function GoalDialog({
  goal,
  accounts,
  onClose,
  onSaved,
}: {
  goal?: Goal;
  accounts: Account[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const eligible = accounts.filter(
    (a) =>
      a.role === "asset" &&
      GOAL_KINDS.includes(a.kind) &&
      (!a.archived || a.id === goal?.account_id),
  );
  const [accountId, setAccountId] = useState(
    String(
      goal?.account_id ??
        eligible.find((a) => a.currency === "BITCOIN")?.id ??
        eligible[0]?.id ??
        "",
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const account = eligible.find((a) => String(a.id) === accountId);
  useModalDialog(ref);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const data = new FormData(event.currentTarget);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api(goal ? `/goals/${goal.id}` : "/goals", goal ? "PUT" : "POST", {
        name: String(data.get("name") || ""),
        account_id: Number(accountId),
        target: String(data.get("target") || "").trim(),
        target_date: String(data.get("target_date") || "") || null,
      });
      onSaved(goal ? "Goal updated." : "Goal added.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="entry-dialog"
      aria-labelledby="goal-dialog-title"
      onCancel={(e) => {
        e.stopPropagation();
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="goal-dialog-title">
            {goal ? "Edit goal" : "Add a savings goal"}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </Button>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid">
          <div className="full-width">
            <Field label="What is this stack for?">
              <input
                name="name"
                defaultValue={goal?.name}
                placeholder="One whole bitcoin"
                maxLength={80}
                required
                autoFocus
              />
            </Field>
          </div>
          <div className="full-width">
            <Field
              label="Wallet that holds it"
              hint="Progress is this account's balance. Goals sharing an account fill in the order they were added."
            >
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                {!eligible.length && (
                  <option value="">Add a bitcoin wallet first</option>
                )}
                {eligible.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {formatMoney(a.balance, a.currency)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label={`Target · ${account?.currency === "BITCOIN" ? "bitcoin" : "USD"}`}
          >
            <input
              name="target"
              defaultValue={goal?.target}
              inputMode="decimal"
              placeholder={
                account?.currency === "BITCOIN" ? "100000000" : "5000"
              }
              required
            />
          </Field>
          <Field
            label="Target date · optional"
            hint="Adds a monthly amount to aim for."
          >
            <input
              name="target_date"
              type="date"
              defaultValue={goal?.target_date ?? ""}
            />
          </Field>
        </div>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !eligible.length}>
            {busy ? "Saving…" : goal ? "Save changes" : "Add goal"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** Named targets tied to the accounts that hold the money. */
export function Goals({
  accounts,
  revision,
  onSaved,
}: {
  accounts: Account[];
  revision: number;
  onSaved: (message: string) => void;
}) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    api<Goal[]>("/goals")
      .then((rows) => {
        if (alive) {
          setGoals(rows);
          setError("");
        }
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [revision]);
  async function remove(goal: Goal) {
    if (
      !window.confirm(
        `Remove the goal “${goal.name}”? The money in ${goal.account} is not affected.`,
      )
    )
      return;
    setRemoving(goal.id);
    try {
      await api(`/goals/${goal.id}`, "DELETE");
      onSaved("Goal removed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemoving(null);
    }
  }
  return (
    <section className="goals" aria-label="Stacking goals">
      <div className="section-toolbar accounts-toolbar">
        <h2>Stacking goals</h2>
        <div className="button-row">
          <Button variant="outline" onClick={() => setEditing("new")}>
            <Plus size={16} /> Add goal
          </Button>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {goals !== null && !goals.length && (
        <div className="panel goals-empty">
          <Target size={28} />
          <div>
            <strong>Set a bitcoin target.</strong>
            <p>
              Pick a wallet and an amount of bitcoin to reach, and watch it fill
              as you stack.
            </p>
          </div>
        </div>
      )}
      {!!goals?.length && (
        <div className="goal-grid">
          {goals.map((goal) => {
            const unit = goal.currency;
            const percent = Math.min(Number(goal.percent), 100);
            return (
              <article
                className={`panel goal-card${goal.complete ? " goal-complete" : ""}`}
                key={goal.id}
              >
                <div className="goal-card-heading">
                  <div>
                    <h3>{goal.name}</h3>
                    <small>{goal.account}</small>
                  </div>
                  <div className="row-actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${goal.name}`}
                      onClick={() => setEditing(goal)}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${goal.name}`}
                      disabled={removing === goal.id}
                      onClick={() => remove(goal)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="goal-figure">
                  <strong className="money">
                    {formatMoney(goal.saved, unit)}
                  </strong>
                  <span>of {formatMoney(goal.target, unit)}</span>
                  <b>{Math.floor(Number(goal.percent))}%</b>
                </div>
                <div
                  className="progress-track"
                  role="img"
                  aria-label={`${goal.percent}% of ${goal.name} saved`}
                >
                  <div style={{ width: `${percent}%` }} />
                </div>
                <p className="goal-status">
                  {goal.complete
                    ? "Reached. Nicely done."
                    : goal.target_date
                      ? goal.overdue
                        ? `${formatMoney(goal.remaining, unit)} to go · target date ${dateLabel(goal.target_date)} has passed`
                        : `${formatMoney(goal.monthly_needed, unit)} a month reaches it by ${dateLabel(goal.target_date)}`
                      : `${formatMoney(goal.remaining, unit)} to go`}
                </p>
                {goal.shares_account && !goal.complete && (
                  <p className="hint">
                    Shares {goal.account} with another goal; earlier goals fill
                    first.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing && (
        <GoalDialog
          goal={editing === "new" ? undefined : editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            onSaved(message);
          }}
        />
      )}
    </section>
  );
}
