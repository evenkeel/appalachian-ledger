import { describe, expect, it } from "vitest";
import { addDays, btc, cents, daysBetween, fromCents, shortDate, usd, usdWhole } from "./format";
import { parseRoute } from "./router";

describe("exact money formatting", () => {
  it("formats dollars and bitcoin from strings without floats", () => {
    expect(usd("4812.40")).toBe("$4,812.40");
    expect(usd("-757.46")).toBe("−$757.46");
    expect(btc("21932000")).toBe("₿21,932,000");
    expect(usd(null)).toBe("Unavailable");
    // Larger than a double can hold exactly.
    expect(usd("90071992547409.93")).toBe("$90,071,992,547,409.93");
  });
  it("rounds whole-dollar labels half up", () => {
    expect(usdWhole("6000.00")).toBe("$6,000");
    expect(usdWhole("3099.50")).toBe("$3,100");
    expect(usdWhole("3099.49")).toBe("$3,099");
  });
  it("adds and subtracts in cents", () => {
    expect(cents("4812.40") - cents("1400.00")).toBe(341240n);
    expect(fromCents(cents("0.10") + cents("0.20"))).toBe("0.30");
    expect(fromCents(cents("22.99") * 12n)).toBe("275.88");
    expect(fromCents(-5n)).toBe("-0.05");
  });
});

describe("dates", () => {
  it("counts and shifts whole days across a month end", () => {
    expect(daysBetween("2026-11-19", "2026-12-01")).toBe(12);
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(shortDate("2026-11-21")).toBe("Nov 21");
  });
});

describe("routes", () => {
  it("falls back to the dashboard for unknown links", () => {
    expect(parseRoute("#/stack")).toBe("stack");
    expect(parseRoute("")).toBe("dashboard");
    expect(parseRoute("#/nope")).toBe("dashboard");
  });
});
