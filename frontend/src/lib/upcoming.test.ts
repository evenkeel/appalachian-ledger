import { expect, test } from "vitest";
import { upcomingBills, upcomingTotals, plannedWeekDays } from "./upcoming";
import type { RecurringBill } from "./types";
const bill: RecurringBill = {
  id: 1,
  account_id: 1,
  category_id: 1,
  description: "Electricity",
  notes: "",
  amount: "60.00",
  frequency: "monthly",
  next_due: "2026-11-10",
  account: "Checking",
  category: "Utilities",
  currency: "USD",
  account_archived: false,
};
test("upcoming window includes overdue and boundary dates in due order without mutating source", () => {
  const bills = [
    { ...bill, id: 3, next_due: "2026-12-06" },
    bill,
    { ...bill, id: 2, next_due: "2026-10-01" },
    { ...bill, id: 4, next_due: "2026-12-05", frequency: "once" as const },
  ];
  expect(
    upcomingBills(bills, "2026-11-05", "30").map((item) => item.id),
  ).toEqual([2, 1, 4]);
  expect(
    upcomingBills(bills, "2026-11-05", "all").map((item) => item.id),
  ).toEqual([2, 1, 4, 3]);
  expect(bills[0].id).toBe(3);
});
test("calendar windows cross month and year boundaries", () => {
  expect(
    upcomingBills([{ ...bill, next_due: "2027-01-02" }], "2026-12-26", "7"),
  ).toHaveLength(1);
  expect(
    upcomingBills([{ ...bill, next_due: "2027-01-03" }], "2026-12-26", "7"),
  ).toHaveLength(0);
});
test("planned totals retain cents and large native bitcoin exactly, separately by currency", () => {
  expect(
    upcomingTotals([
      { ...bill, amount: "0.10" },
      { ...bill, amount: "0.20" },
      { ...bill, amount: "9007199254740993", currency: "BITCOIN" },
      { ...bill, amount: "7", currency: "BITCOIN" },
    ]),
  ).toEqual([
    { currency: "USD", amount: "0.30" },
    { currency: "BITCOIN", amount: "9007199254741000" },
  ]);
});

test("planned calendar groups exact native totals on their actual next unpaid dates", async () => {
  const { plannedCalendarDays } = await import("./upcoming");
  const days = plannedCalendarDays(
    [
      { ...bill, amount: "0.10" },
      { ...bill, id: 2, amount: "0.20" },
      { ...bill, id: 3, currency: "BITCOIN", amount: "9007199254740993" },
      { ...bill, id: 4, next_due: "2026-12-10", amount: "500.00" },
    ],
    "2026-11",
  );
  expect(days).toHaveLength(30);
  expect(days[9].amounts).toEqual({ USD: 30n, BITCOIN: 9007199254740993n });
  expect(days[9].bills).toHaveLength(3);
  expect(days.reduce((sum, date) => sum + date.bills.length, 0)).toBe(3);
  expect(
    plannedCalendarDays([bill], "2026-12").every(
      (date) => date.bills.length === 0,
    ),
  ).toBe(true);
  expect(plannedCalendarDays([], "2024-02")).toHaveLength(29);
});

test("planned bubble area, rather than diameter, represents relative spending", async () => {
  const { plannedCircleDiameter } = await import("./upcoming");
  const large = plannedCircleDiameter(400n, 400n),
    small = plannedCircleDiameter(100n, 400n);
  expect((large / small) ** 2).toBeCloseTo(4);
  expect(plannedCircleDiameter(0n, 400n)).toBe(0);
});

test("weeks run Sunday through Saturday across year, leap, and daylight-saving boundaries", () => {
  for (const [day, first, last] of [
    ["2026-01-01", "2025-12-28", "2026-01-03"],
    ["2024-02-29", "2024-02-25", "2024-03-02"],
    ["2026-11-01", "2026-11-01", "2026-11-07"],
  ]) {
    const days = plannedWeekDays([{ ...bill, next_due: last }], day);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe(first);
    expect(days[6].date).toBe(last);
    expect(days[6].bills).toHaveLength(1);
    expect(days[6].amounts.USD).toBe(6000n);
  }
});
