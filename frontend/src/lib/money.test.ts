import { expect, test } from "vitest";
import {
  formatBitcoinPerDollar,
  formatMoney,
  percentChange,
  subtractMoney,
  sumMoney,
} from "./money";

test.each([
  ["123456", "100.99", "₿1,222.46 / $1"],
  ["1", "0.08", "₿12.50 / $1"],
  ["1", "0.32", "₿3.13 / $1"],
  ["9007199254740993", "1", "₿9,007,199,254,740,993.00 / $1"],
  ["1", "1000", "<₿0.01 / $1"],
  ["1", "0", "Unavailable"],
])(
  "formats %s bitcoin received for %s dollars",
  (bitcoin, dollars, expected) => {
    expect(formatBitcoinPerDollar(bitcoin, dollars)).toBe(expected);
  },
);

test("stored reference rates are inverted exactly, including fractional dollar prices", async () => {
  const { formatBitcoinPerDollarFromRate } = await import("./money");
  expect(formatBitcoinPerDollarFromRate("120000")).toBe("₿833.33 / $1");
  expect(formatBitcoinPerDollarFromRate("0.00000001")).toBe(
    "₿10,000,000,000,000,000.00 / $1",
  );
  expect(formatBitcoinPerDollarFromRate("100000.12345678")).toBe(
    "₿1,000.00 / $1",
  );
  expect(formatBitcoinPerDollarFromRate("0")).toBe("Unavailable");
  expect(formatBitcoinPerDollarFromRate(null)).toBe("Unavailable");
});

test("display rounding rounds half up and never shows a negative zero", () => {
  expect(formatMoney("67123.456", "USD")).toBe("$67,123.46");
  expect(formatMoney("0.995", "USD")).toBe("$1.00");
  expect(formatMoney("999.999", "USD")).toBe("$1,000.00");
  expect(formatMoney("-0.004", "USD")).toBe("$0.00");
  expect(formatMoney("-12.5", "USD")).toBe("−$12.50");
  expect(formatMoney("1234567", "BITCOIN")).toBe("₿1,234,567");
});
test("exact decimal helpers avoid floating point", () => {
  expect(subtractMoney("0.30", "0.10")).toBe("0.2");
  expect(subtractMoney("100", "250.75")).toBe("-150.75");
  expect(subtractMoney("9000000000000001", "1")).toBe("9000000000000000");
  expect(subtractMoney(null, "1")).toBeNull();
  expect(sumMoney(["0.10", "0.20", null, "-0.05"])).toEqual({
    total: "0.25",
    missing: 1,
  });
  expect(percentChange("200", "250")).toBe(25);
  expect(percentChange("0", "250")).toBeNull();
});
