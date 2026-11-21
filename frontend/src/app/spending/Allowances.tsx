import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { cents, coordinate, fromCents, longMonth, usd } from "../lib/format";

interface Row {
  category_id: number;
  category: string;
  budget_id: number | null;
  planned_usd: string | null;
  spent_usd: string | null;
  percent: string | null;
}
interface CategoryRow {
  id: number;
  name: string;
  kind: string;
}

/** Monthly dollar allowances by category: set one, change it, or remove it. Nothing here posts to the journal. */
export function AllowancesPanel({
  className,
  month,
  elapsed,
  categories,
  onChanged,
}: {
  className?: string;
  month: string;
  /** How much of the month has passed, as a percentage, for the "today" mark. */
  elapsed: string;
  categories: CategoryRow[];
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The category being edited, or "new" for the add row.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api<Row[]>(`/budget-overview?month=${month}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);
  useEffect(() => void load(), [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setEditing(null);
      setNotice(done);
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>, categoryId: number | null, name: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const id = categoryId ?? Number(fields.get("category_id"));
    const amount = String(fields.get("amount")).replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || cents(amount) === 0n) return setError("Enter the allowance as dollars, like 400 or 412.50");
    const label = name || categories.find((category) => category.id === id)?.name || "the category";
    void run(() => api("/budgets", "POST", { month, category_id: id, amount, currency: "USD", scope: "all" }), `Allowance for ${label} saved.`);
  }

  const set = (rows ?? []).filter((row) => row.planned_usd !== null);
  const unset = (rows ?? []).filter((row) => row.planned_usd === null);
  const listed = new Set(set.map((row) => row.category_id));
  const available = categories.filter((category) => category.kind === "expense" && !listed.has(category.id));
  const planned = set.reduce((sum, row) => sum + cents(row.planned_usd!), 0n);
  const mark = Math.min(100, coordinate(elapsed));

  const amountForm = (categoryId: number | null, name: string, current: string | null) => (
    <form className="alw-form" onSubmit={(event) => save(event, categoryId, name)} aria-label={name ? `Allowance for ${name}` : "New allowance"}>
      {categoryId === null && (
        <label className="field">
          <span>Category</span>
          <select name="category_id" autoFocus>
            {available.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {unset.some((row) => row.category_id === category.id) ? " · spent this month" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>A month</span>
        <input name="amount" className="num" inputMode="decimal" placeholder="0.00" defaultValue={current ?? ""} autoFocus={categoryId !== null} required />
      </label>
      <button className="btn sm primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>
        Cancel
      </button>
    </form>
  );

  return (
    <Panel className={className} name="Allowances" plain={`dollar limits by category · ${longMonth(month)}`}>
      {rows === null ? (
        error ? null : (
          <div className="meter" aria-busy="true">
            <i style={{ width: "100%", opacity: 0.25 }} />
          </div>
        )
      ) : set.length ? (
        <>
          <div className="sub">
            <b className="num" style={{ color: "var(--ink)" }}>
              {usd(fromCents(planned))}
            </b>{" "}
            allowed across {set.length === 1 ? "1 category" : `${set.length} categories`}. The mark on each bar is today.
          </div>
          <ul className="alw">
            {set.map((row) => {
              const used = row.percent === null ? null : coordinate(row.percent);
              const over = row.spent_usd !== null && cents(row.spent_usd) > cents(row.planned_usd!);
              return (
                <li key={row.category_id}>
                  <div className="split" style={{ justifyContent: "space-between", gap: 8 }}>
                    <b>{row.category}</b>
                    <span className="num sub">
                      {row.spent_usd !== null ? usd(row.spent_usd) : "Partial"} of {usd(row.planned_usd)}
                      {over && <b className="warnc"> · {usd(fromCents(cents(row.spent_usd!) - cents(row.planned_usd!)))} over</b>}
                    </span>
                  </div>
                  {editing === row.category_id ? (
                    amountForm(row.category_id, row.category, row.planned_usd)
                  ) : (
                    <div className="alw-row">
                    <div
                      className={`bar${over ? " over" : used !== null && used > mark ? " warn" : ""}`}
                      role="img"
                      aria-label={used !== null ? `${used.toFixed(0)}% of the ${row.category} allowance used; ${mark.toFixed(0)}% of the month has passed` : "Spending total unavailable"}
                    >
                      <i style={{ width: `${Math.min(used ?? 0, 100)}%` }} />
                      <u style={{ left: `${mark}%` }} />
                    </div>
                      <button className="alw-link" onClick={() => setEditing(row.category_id)} aria-label={`Change the ${row.category} allowance`}>
                        Change
                      </button>
                      <button
                        className="alw-link"
                        disabled={busy}
                        onClick={() => void run(() => api(`/budgets/${row.budget_id}`, "DELETE"), `Allowance for ${row.category} removed.`)}
                        aria-label={`Remove the ${row.category} allowance`}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="sub">
          No allowances for {longMonth(month)}. Set a monthly limit for a category and its bar shows how much is used, with a light when it runs ahead of the month.
        </div>
      )}
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      <div className="sr" role="status">
        {notice}
      </div>
      {rows !== null &&
        (editing === "new" ? (
          amountForm(null, "", null)
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {available.length > 0 && (
              <button className="btn sm primary" onClick={() => setEditing("new")}>
                Set an allowance
              </button>
            )}
            {set.length === 0 && (
              <button
                className="btn sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api<{ copied: number }>("/budgets/copy-previous", "POST", { month });
                    if (result.copied === 0) throw new Error("Last month had no allowances to copy.");
                  }, "Copied last month's allowances.")
                }
              >
                Copy last month's
              </button>
            )}
          </div>
        ))}
    </Panel>
  );
}
