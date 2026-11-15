import { useModalDialog } from "../lib/useModalDialog";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RecurringBill } from "../lib/types";
import { formatMoney } from "../lib/money";
import {
  plannedWeekDays,
  shiftPlannedDate,
  plannedCircleDiameter,
  upcomingTotals,
  upcomingBills,
} from "../lib/upcoming";
import { today } from "./EntryDialog";
import { Money } from "./Money";
import { Button } from "./ui/button";

const labelDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
export function PlannedExpensesCalendar({
  bills,
  loading,
  error,
  onRetry,
  onRecord,
  onEdit,
  onRemove,
  onHistory,
  day = today(),
}: {
  bills: RecurringBill[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onRecord: (bill: RecurringBill) => void;
  onEdit: (bill: RecurringBill) => void;
  onRemove: (bill: RecurringBill) => void;
  onHistory: (bill: RecurringBill) => void;
  day?: string;
}) {
  const [week, setWeek] = useState(day);
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [preferredUnit, setPreferredUnit] =
    useState<RecurringBill["currency"]>("USD");
  const units = (["USD", "BITCOIN"] as const).filter((unit) =>
    bills.some((bill) => bill.currency === unit),
  );
  const unit = units.includes(preferredUnit)
    ? preferredUnit
    : (units[0] ?? "USD");
  const days = plannedWeekDays(bills, week);
  const currentWeek = plannedWeekDays([], day)[0].date;
  const weekLabel = `${new Date(`${days[0].date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(`${days[6].date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  const largest = days.reduce(
    (max, date) => (date.amounts[unit] > max ? date.amounts[unit] : max),
    0n,
  );
  const weekBills = days.flatMap((date) => date.bills);
  const overdue = bills.filter((bill) => bill.next_due < day);
  const selected =
    selection === "all"
      ? upcomingBills(bills, day, "all")
      : selection === "overdue"
        ? overdue
        : bills.filter((bill) => bill.next_due === selection);
  const totals = (items: RecurringBill[]) =>
    (items.length
      ? upcomingTotals(items)
      : [{ currency: unit, amount: "0" }]
    ).map((total) => (
      <Money key={total.currency} value={total.amount} unit={total.currency} />
    ));
  useModalDialog(dialog, Boolean(selection));
  function changeWeek(value: string) {
    setWeek(value);
    setSelection(null);
  }
  function closeDetails() {
    dialog.current?.close();
    setSelection(null);
  }
  function act(action: (bill: RecurringBill) => void, bill: RecurringBill) {
    closeDetails();
    action(bill);
  }
  return (
    <div className="planned-calendar">
      <h3 className="planned-calendar-title">Upcoming Expenses</h3>
      <div className="planned-calendar-heading">
        <div className="planned-month-navigation">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous week"
            onClick={() => changeWeek(shiftPlannedDate(days[0].date, -7))}
          >
            <ChevronLeft size={16} />
          </Button>
          <span className="planned-week-range" aria-live="polite">
            {weekLabel}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next week"
            onClick={() => changeWeek(shiftPlannedDate(days[0].date, 7))}
          >
            <ChevronRight size={16} />
          </Button>
          {days[0].date !== currentWeek && (
            <Button variant="ghost" size="sm" onClick={() => changeWeek(day)}>
              This week
            </Button>
          )}
        </div>
        <div className="planned-calendar-status">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || Boolean(error)}
            onClick={() => setSelection("all")}
          >
            All planned bills{!loading && !error ? ` (${bills.length})` : ""}
          </Button>
          {overdue.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              aria-pressed={selection === "overdue"}
              onClick={() =>
                setSelection(selection === "overdue" ? null : "overdue")
              }
            >
              {overdue.length} overdue
            </Button>
          )}
          {units.length > 1 && (
            <div
              className="analysis-switch"
              role="group"
              aria-label="Planned dot currency"
            >
              {units.map((value) => (
                <Button
                  key={value}
                  variant={unit === value ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={unit === value}
                  onClick={() => setPreferredUnit(value)}
                >
                  {value === "USD" ? "Dollars" : "Bitcoin"}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
      {loading ? (
        <p role="status" className="empty-inline">
          Loading planned expenses…
        </p>
      ) : error ? (
        <div role="alert" className="alert error">
          {error}{" "}
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="planned-calendar-layout">
            <div>
              <div
                className="planned-date-dots"
                role="group"
                aria-label="Planned expense dates"
              >
                {days.map((date) => {
                  const diameter = plannedCircleDiameter(
                    date.amounts[unit],
                    largest,
                  );
                  const hasOther = date.bills.some(
                    (bill) => bill.currency !== unit,
                  );
                  const title = `${labelDate(date.date)}: ${date.bills.length} planned expense${date.bills.length === 1 ? "" : "s"}${
                    date.bills.length
                      ? `, ${upcomingTotals(date.bills)
                          .map((total) =>
                            formatMoney(total.amount, total.currency),
                          )
                          .join(" and ")}`
                      : ""
                  }`;
                  return (
                    <button
                      type="button"
                      className={`planned-date-dot${date.date === day ? " is-today" : ""}${date.bills.length && date.date < day ? " is-overdue" : ""}`}
                      key={date.date}
                      aria-label={title}
                      title={title}
                      aria-pressed={selection === date.date}
                      onClick={() =>
                        setSelection(selection === date.date ? null : date.date)
                      }
                    >
                      <span className="planned-dot-weekday">
                        {new Date(`${date.date}T12:00:00`).toLocaleDateString(
                          undefined,
                          { weekday: "short" },
                        )}
                      </span>
                      <span className="planned-dot-mark" aria-hidden="true">
                        {!date.bills.length && (
                          <span className="planned-empty-dot" />
                        )}
                        {diameter > 0 && (
                          <span
                            aria-hidden="true"
                            className="planned-bubble"
                            style={{ width: diameter, height: diameter }}
                          />
                        )}
                        {hasOther && (
                          <span
                            className="planned-other-unit"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="planned-dot-date">{date.day}</span>
                    </button>
                  );
                })}
              </div>
              <p className="planned-circle-legend">
                <span aria-hidden="true" />
                Orange size: planned {unit === "USD" ? "dollars" : "bitcoin"}.
                Light blue: no plans.
                {units.length > 1 &&
                  " Orange outlines mark the other currency."}
              </p>
              {!!weekBills.length && (
                <div
                  className="planned-week-bills"
                  aria-label="Bills this week"
                >
                  {weekBills.map((bill) => (
                    <div key={bill.id} className="planned-week-bill">
                      <button
                        type="button"
                        className="planned-week-bill-details"
                        aria-label={`View ${bill.description} due ${labelDate(bill.next_due)}`}
                        onClick={() => setSelection(bill.next_due)}
                      >
                        <time dateTime={bill.next_due}>
                          {new Date(
                            `${bill.next_due}T12:00:00`,
                          ).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                        <span>
                          <strong>{bill.description}</strong>
                          {bill.next_due < day && (
                            <small className="upcoming-overdue">Overdue</small>
                          )}
                          {bill.next_due === day && <small>Due today</small>}
                        </span>
                        <Money value={bill.amount} unit={bill.currency} />
                      </button>
                      <Button
                        size="sm"
                        disabled={bill.account_archived}
                        aria-label={`Mark ${bill.description} paid`}
                        onClick={() => act(onRecord, bill)}
                      >
                        Mark paid
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {!weekBills.length && (
                <p className="hint">No upcoming expenses this week.</p>
              )}
            </div>
            <aside className="planned-month-summary">
              <span>Planned this week</span>
              <strong>{totals(weekBills)}</strong>
              <small>
                {weekBills.length} next unpaid occurrence
                {weekBills.length === 1 ? "" : "s"}
              </small>
            </aside>
            {selection && (
              <dialog
                ref={dialog}
                className="entry-dialog planned-details-dialog"
                aria-label="Upcoming expense details"
                onCancel={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  closeDetails();
                }}
                onClose={(event) => {
                  if (event.target === event.currentTarget) setSelection(null);
                }}
              >
                <div className="dialog-heading">
                  <h2>
                    {selection === "all"
                      ? "All planned bills"
                      : selection === "overdue"
                        ? "Overdue expenses"
                        : labelDate(selection)}
                  </h2>
                  <Button size="sm" variant="ghost" onClick={closeDetails}>
                    Close details
                  </Button>
                </div>
                {selection === "all" && (
                  <p className="hint">
                    The next unrecorded occurrence of every saved bill,
                    including dates outside this week. Recorded payments match
                    automatically when account, amount, due date and name agree.
                  </p>
                )}
                <div className="planned-day-total">{totals(selected)}</div>
                {!selected.length && (
                  <p className="hint">
                    No unpaid expenses remain for this day.
                  </p>
                )}
                <div className="planned-day-list">
                  {selected.map((bill) => (
                    <article key={bill.id} className="planned-day-row">
                      <div className="planned-item-name">
                        <strong>{bill.description}</strong>
                        <small>
                          {bill.account} · {bill.category}
                          {selection === "overdue" || selection === "all"
                            ? ` · ${labelDate(bill.next_due)}${bill.next_due < day ? " · Overdue" : ""}`
                            : ""}
                        </small>
                      </div>
                      <Money value={bill.amount} unit={bill.currency} />
                      <Button
                        size="sm"
                        disabled={bill.account_archived}
                        aria-label={`Mark ${bill.description} paid`}
                        onClick={() => act(onRecord, bill)}
                      >
                        Mark paid
                      </Button>
                      <details className="planned-item-actions">
                        <summary
                          aria-label={`More actions for ${bill.description}`}
                        >
                          •••
                        </summary>
                        <div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => act(onEdit, bill)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => act(onHistory, bill)}
                          >
                            Cost history
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => act(onRemove, bill)}
                          >
                            Remove
                          </Button>
                        </div>
                      </details>
                      {bill.account_archived && (
                        <small className="planned-archived-note">
                          Edit to choose an active account.
                        </small>
                      )}
                    </article>
                  ))}
                </div>
              </dialog>
            )}
          </div>
        </>
      )}
    </div>
  );
}
