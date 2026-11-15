import type { RecurringBill } from "./types";

export function upcomingBills(
  bills: RecurringBill[],
  day: string,
  window: string,
) {
  if (window === "all")
    return [...bills].sort(
      (a, b) => a.next_due.localeCompare(b.next_due) || a.id - b.id,
    );
  const end = new Date(`${day}T12:00:00`);
  end.setDate(end.getDate() + Number(window));
  const lastDay = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return bills
    .filter((bill) => window === "all" || bill.next_due <= lastDay)
    .sort((a, b) => a.next_due.localeCompare(b.next_due) || a.id - b.id);
}

/** Sum each original currency exactly; planned bitcoin and dollars stay separate. */
export function upcomingTotals(bills: RecurringBill[]) {
  const totals = new Map<RecurringBill["currency"], bigint>();
  for (const bill of bills) {
    const [whole, fraction = ""] = bill.amount.split(".");
    const minor =
      BigInt(whole) * (bill.currency === "USD" ? 100n : 1n) +
      (bill.currency === "USD" ? BigInt(fraction.padEnd(2, "0")) : 0n);
    totals.set(bill.currency, (totals.get(bill.currency) || 0n) + minor);
  }
  if (!totals.size) totals.set("USD", 0n);
  return [...totals]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([currency, amount]) => ({
      currency,
      amount:
        currency === "USD"
          ? `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`
          : String(amount),
    }));
}

/** Calendar dates contain the actual next unpaid occurrence, never guessed repeats. */
export function plannedCalendarDays(bills: RecurringBill[], month: string) {
  const [year, number] = month.split("-").map(Number);
  const length = new Date(year, number, 0).getDate();
  return Array.from({ length }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const items = bills.filter((bill) => bill.next_due === date);
    const amounts = { USD: 0n, BITCOIN: 0n };
    for (const bill of items) {
      const [whole, fraction = ""] = bill.amount.split(".");
      amounts[bill.currency] +=
        bill.currency === "USD"
          ? BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
          : BigInt(whole);
    }
    return { date, day: index + 1, bills: items, amounts };
  });
}

/** Floating point is confined to the circle geometry; totals remain exact. */
export function plannedCircleDiameter(amount: bigint, largest: bigint) {
  return amount <= 0n || largest <= 0n
    ? 0
    : Math.max(5, 36 * Math.sqrt(Number(amount) / Number(largest)));
}

/** Local calendar arithmetic keeps Sunday–Saturday weeks intact across DST and month ends. */
export function shiftPlannedDate(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function plannedWeekDays(bills: RecurringBill[], day: string) {
  const sunday = shiftPlannedDate(day, -new Date(`${day}T12:00:00`).getDay());
  const dates = Array.from({ length: 7 }, (_, index) =>
    shiftPlannedDate(sunday, index),
  );
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  const grouped = months.flatMap((month) => plannedCalendarDays(bills, month));
  return dates.map((date) => grouped.find((item) => item.date === date)!);
}
