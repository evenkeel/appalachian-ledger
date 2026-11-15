import { useModalDialog } from "../lib/useModalDialog";
import { CostHistoryDialog } from "./CostHistory";
import { PlannedExpensesCalendar } from "./PlannedExpensesCalendar";
import { SortableCards } from "./SortableCards";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Pencil, Plus, Repeat2, X } from "lucide-react";
import { api } from "../lib/api";
import type { RecurringBill } from "../lib/types";
import { Field, today, type DialogState } from "./EntryDialog";
import {
  upcomingBills,
  upcomingTotals,
  shiftPlannedDate,
} from "../lib/upcoming";
import { Money } from "./Money";
import { Button } from "./ui/button";

const frequencyLabel: Record<RecurringBill["frequency"], string> = {
  once: "One-time",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Every 6 months",
  yearly: "Yearly",
};

export function RecurringBills({
  revision,
  overview = false,
  compact = false,
  calendar = false,
  table = false,
  accountId,
  title,
  allowCreate = true,
  timeRange,
  onTimeRangeChange,
  onOpen,
  onAdd,
  onSaved,
}: {
  revision: number;
  overview?: boolean;
  compact?: boolean;
  calendar?: boolean;
  table?: boolean;
  accountId?: number;
  title?: string;
  allowCreate?: boolean;
  timeRange?: string;
  onTimeRangeChange?: (value: string) => void;
  onOpen?: () => void;
  onAdd: (state: DialogState) => void;
  onSaved: (message: string) => void;
}) {
  const [historyBill, setHistoryBill] = useState<RecurringBill | null>(null);
  const [localWindow, setLocalWindow] = useState("30");
  const window = timeRange ?? localWindow;
  const setWindow = onTimeRangeChange ?? setLocalWindow;
  const [matchNotice, setMatchNotice] = useState("");
  const [matchError, setMatchError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<RecurringBill | null>(null);
  const [action, setAction] = useState<"record" | "remove">("record");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    async function load() {
      try {
        const query = accountId === undefined ? "" : `?account_id=${accountId}`;
        try {
          const result = await api<{ matched: number }>(
            `/recurring-bills/reconcile${query}`,
            "POST",
          );
          if (alive) {
            setMatchError("");
            if (result.matched > 0)
              setMatchNotice(
                `${result.matched} recorded payment${result.matched === 1 ? "" : "s"} matched to saved bills. No new expenses created.`,
              );
          }
        } catch (e) {
          if (alive)
            setMatchError(
              `Automatic matching unavailable: ${(e as Error).message}`,
            );
        }
        if (!alive) return;
        const items = await api<RecurringBill[]>(`/recurring-bills${query}`);
        if (alive) {
          setBills(items);
          setLoaded(true);
        }
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setLoaded(true);
        }
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [revision, retry, accountId]);
  useModalDialog(dialog, Boolean(selected));
  function close() {
    if (!lock.current) {
      setSelected(null);
      setError("");
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    let matchedExisting = false;
    try {
      if (action === "remove") {
        await api(`/recurring-bills/${selected.id}`, "DELETE");
        setBills((items) => items.filter((bill) => bill.id !== selected.id));
      } else {
        const result = await api<{ matched_existing?: boolean }>(
          `/recurring-bills/${selected.id}/record`,
          "POST",
          {
            due_date: selected.next_due,
            date: form.get("date"),
            amount: form.get("amount"),
          },
        );
        matchedExisting = Boolean(result.matched_existing);
        // Hide the paid occurrence immediately, before the dashboard refresh.
        setBills((items) => items.filter((bill) => bill.id !== selected.id));
      }
      setSelected(null);
      onSaved(
        action === "remove"
          ? "Recurring bill removed. Past payments are preserved."
          : matchedExisting
            ? `${selected.description} matched to its recorded payment.`
            : `${selected.description} recorded.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const day = today();
  const shownBills = overview
    ? upcomingBills(bills, day, window)
    : upcomingBills(bills, day, "all");
  const overdue = shownBills.filter((bill) => bill.next_due < day);
  const upcoming = shownBills.filter((bill) => bill.next_due >= day);
  const dueCount = bills.filter((bill) => bill.next_due <= day).length;
  const heading =
    title || (overview ? "Upcoming Expenses" : "Planned expenses");
  function totals(items: RecurringBill[]) {
    return upcomingTotals(items).map(({ currency, amount }) => (
      <Money key={currency} value={amount} unit={currency} />
    ));
  }
  if (compact) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = shiftPlannedDate(day, index);
      return { date, bills: bills.filter((bill) => bill.next_due === date) };
    });
    const next = days.flatMap((item) => item.bills);
    const largestCount = Math.max(1, ...days.map((item) => item.bills.length));
    const late = bills.filter((bill) => bill.next_due < day);
    return (
      <button type="button" className="panel upcoming-link" onClick={onOpen}>
        <span className="upcoming-link-copy">
          <strong>Upcoming Expenses</strong>
          {!loaded && !error ? (
            <span>Loading upcoming payments…</span>
          ) : error ? (
            <span>Upcoming payments unavailable. Open Expenses to retry.</span>
          ) : (
            <span>
              {next.length} upcoming · {totals(next)} due in the next 7 days
              {late.length > 0 && (
                <span className="upcoming-overdue">
                  {" "}
                  · {late.length} overdue · {totals(late)}
                </span>
              )}
            </span>
          )}
        </span>
        {loaded && !error && (
          <span
            className="upcoming-week"
            aria-label="Expenses due over the next seven days"
            role="group"
          >
            {days.map(({ date, bills: items }, index) => {
              const label = new Date(`${date}T12:00:00`).toLocaleDateString(
                undefined,
                { weekday: "short" },
              );
              const description = `${date}: ${items.length} expense${items.length === 1 ? "" : "s"} due`;
              const diameter = items.length
                ? 28 * Math.sqrt(items.length / largestCount)
                : 4;
              return (
                <span
                  className="upcoming-week-day"
                  key={date}
                  role="img"
                  aria-label={description}
                  title={description}
                >
                  <span className="upcoming-week-label">
                    {index === 0 ? "Today" : label}
                  </span>
                  <span className="upcoming-dot-space">
                    <span
                      className={`upcoming-day-dot${items.length ? " has-expenses" : ""}`}
                      style={{ width: diameter, height: diameter }}
                    />
                  </span>
                  <span className="upcoming-week-date">
                    {Number(date.slice(8))}
                  </span>
                </span>
              );
            })}
          </span>
        )}
        <span className="upcoming-link-label">
          Expenses <ChevronRight size={16} aria-hidden="true" />
        </span>
      </button>
    );
  }
  return (
    <section
      className={`panel recurring-bills${table ? " bills-sheet" : ""}${calendar ? " planned-calendar-panel" : ""}`}
      aria-labelledby={calendar ? undefined : "recurring-bills-title"}
      aria-label={calendar ? "Upcoming Expenses" : undefined}
    >
      {calendar && matchNotice && (
        <p className="hint" role="status">
          {matchNotice}
        </p>
      )}
      {calendar && matchError && (
        <p className="hint" role="alert">
          {matchError}
        </p>
      )}
      {calendar ? (
        <PlannedExpensesCalendar
          bills={bills}
          loading={!loaded}
          error={selected ? "" : error}
          onRetry={() => {
            setLoaded(false);
            setRetry((value) => value + 1);
          }}
          onRecord={(bill) => {
            setAction("record");
            setSelected(bill);
            setError("");
          }}
          onEdit={(bill) =>
            onAdd({ type: "transaction", kind: "expense", bill })
          }
          onRemove={(bill) => {
            setAction("remove");
            setSelected(bill);
            setError("");
          }}
          onHistory={setHistoryBill}
        />
      ) : (
        <>
          <div className="recurring-heading">
            <div>
              <h3 id="recurring-bills-title">
                {!table && <Repeat2 size={18} />} {heading}
                {table && loaded && ` (${bills.length})`}
              </h3>
              {!table && !overview && (
                <p className="hint">
                  {dueCount ? `${dueCount} due · ` : ""}Record → Confirm
                  payment. Two clicks.
                </p>
              )}
            </div>
            <div className="upcoming-controls">
              {overview && timeRange === undefined && (
                <label className="field upcoming-window">
                  <span>Show upcoming</span>
                  <select
                    aria-label="Upcoming time range"
                    value={window}
                    onChange={(event) => setWindow(event.target.value)}
                  >
                    <option value="7">Next 7 days</option>
                    <option value="30">Next 30 days</option>
                    <option value="all">All planned</option>
                  </select>
                </label>
              )}
              {allowCreate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onAdd({
                      type: "transaction",
                      kind: "expense",
                      recurring: true,
                      oneTime: true,
                    })
                  }
                >
                  <Plus size={16} /> Add expense
                </Button>
              )}
            </div>
          </div>
          {error && !selected && (
            <div role="alert" className="alert error">
              {error}{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry
              </Button>
            </div>
          )}
          {!loaded && !error && (
            <p className="hint" role="status">
              Loading upcoming expenses…
            </p>
          )}
          {overview && loaded && !error && bills.length > 0 && (
            <>
              <div className="upcoming-summary">
                <div>
                  <span>Overdue · {overdue.length}</span>
                  <div>{totals(overdue)}</div>
                </div>
                <div>
                  <span>
                    {window === "all" ? "Upcoming" : `Next ${window} days`} ·{" "}
                    {upcoming.length}
                  </span>
                  <div>{totals(upcoming)}</div>
                </div>
              </div>
              <p className="hint">
                Next unpaid payment for each saved bill or expense. Planned
                amounts count toward budget spending when recorded.
              </p>
            </>
          )}
          {loaded && !bills.length && !error && (
            <p className="hint">
              {accountId === undefined
                ? "Plan a one-time expense or add rent, utilities, and subscriptions. Upcoming payments will appear here with their due dates."
                : "No recurring bills or planned expenses are charged to this account."}
            </p>
          )}
          {loaded && bills.length > 0 && !shownBills.length && !error && (
            <p className="hint">
              Nothing due in this window. Choose All planned to see later
              expenses.
            </p>
          )}
          {table ? (
            <div
              className="bills-sheet-scroll"
              tabIndex={0}
              aria-label="Bill list"
            >
              <table aria-label="Bills paid with this account">
                <thead>
                  <tr>
                    <th scope="col">Bill</th>
                    <th scope="col" className="sheet-amount">
                      Amount
                    </th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Next due</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shownBills.map((bill) => (
                    <tr key={bill.id}>
                      <th scope="row">{bill.description}</th>
                      <td className="sheet-amount">
                        <Money value={bill.amount} unit={bill.currency} />
                      </td>
                      <td>{frequencyLabel[bill.frequency]}</td>
                      <td>
                        <time dateTime={bill.next_due}>{bill.next_due}</time>
                        {bill.next_due <= day && (
                          <span
                            className={
                              bill.next_due < day ? "sheet-overdue" : "hint"
                            }
                          >
                            {" "}
                            · {bill.next_due < day ? "Overdue" : "Today"}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="sheet-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Cost history for ${bill.description}`}
                            onClick={() => setHistoryBill(bill)}
                          >
                            History
                          </Button>
                          <Button
                            size="sm"
                            disabled={bill.account_archived}
                            aria-label={`Record ${bill.description}`}
                            onClick={() => {
                              setAction("record");
                              setSelected(bill);
                              setError("");
                            }}
                          >
                            Record
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit bill ${bill.description}`}
                            onClick={() =>
                              onAdd({
                                type: "transaction",
                                kind: "expense",
                                bill,
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove bill ${bill.description}`}
                            onClick={() => {
                              setAction("remove");
                              setSelected(bill);
                              setError("");
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <SortableCards
              scope="bills"
              className="bill-grid"
              items={shownBills}
              itemId={(bill) => String(bill.id)}
              itemLabel={(bill) => bill.description}
              renderItem={(bill, handle) => (
                <article className="bill-card" key={bill.id}>
                  <div className="bill-card-heading">
                    <strong>{bill.description}</strong>
                    <div className="card-tools">
                      {handle}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit bill ${bill.description}`}
                        onClick={() =>
                          onAdd({ type: "transaction", kind: "expense", bill })
                        }
                      >
                        <Pencil size={14} />
                      </Button>
                    </div>
                  </div>
                  <Money value={bill.amount} unit={bill.currency} />
                  <small>
                    {bill.account} · {bill.category}
                  </small>
                  <small
                    className={
                      bill.next_due < today() ? "bill-overdue" : "muted"
                    }
                  >
                    {bill.next_due < today()
                      ? "Overdue"
                      : bill.next_due === today()
                        ? "Due today"
                        : "Due"}{" "}
                    · {bill.next_due} · {frequencyLabel[bill.frequency]}
                  </small>
                  <div className="bill-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Cost history for ${bill.description}`}
                      onClick={() => setHistoryBill(bill)}
                    >
                      History
                    </Button>
                    <Button
                      size="sm"
                      disabled={bill.account_archived}
                      onClick={() => {
                        setAction("record");
                        setSelected(bill);
                        setError("");
                      }}
                    >
                      Record
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAction("remove");
                        setSelected(bill);
                        setError("");
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                  {bill.account_archived && (
                    <small>Edit this bill to choose an active account.</small>
                  )}
                </article>
              )}
            />
          )}
        </>
      )}
      {historyBill && (
        <CostHistoryDialog
          billId={historyBill.id}
          title={historyBill.description}
          revision={revision}
          onClose={() => setHistoryBill(null)}
        />
      )}
      {selected && (
        <dialog
          ref={dialog}
          className="entry-dialog"
          onCancel={(event) => {
            event.stopPropagation();
            if (busy) event.preventDefault();
            else close();
          }}
          aria-labelledby="bill-confirm-title"
        >
          <form onSubmit={submit}>
            <div className="dialog-heading">
              <h2 id="bill-confirm-title">
                {action === "remove" ? "Remove bill" : "Record payment"}:{" "}
                {selected.description}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close payment"
                disabled={busy}
                onClick={close}
              >
                <X size={18} />
              </Button>
            </div>
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
            {action === "record" ? (
              <div className="form-grid">
                <p className="hint full-width">
                  {selected.account} · {selected.category} · Bill due{" "}
                  {selected.next_due}
                </p>
                <Field
                  label={`Payment amount · ${selected.currency === "BITCOIN" ? "bitcoin" : "USD"}`}
                >
                  <input
                    name="amount"
                    inputMode="decimal"
                    defaultValue={selected.amount}
                    required
                    disabled={busy}
                  />
                </Field>
                <Field label="Payment date">
                  <input
                    name="date"
                    type="date"
                    defaultValue={
                      selected.next_due < day ? selected.next_due : day
                    }
                    max={today()}
                    required
                    disabled={busy}
                  />
                </Field>
                <p className="hint full-width">
                  Adjust the amount for this payment; the recurring estimate
                  stays unchanged. An exact existing payment is matched instead
                  of recording it twice.
                </p>
              </div>
            ) : (
              <p>
                Remove this planned expense or repeating bill? Recorded payments
                stay in your ledger.
              </p>
            )}
            <div className="dialog-footer">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </Button>
              <Button disabled={busy}>
                {busy
                  ? "Saving…"
                  : action === "remove"
                    ? "Remove bill"
                    : "Confirm payment"}
              </Button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}
