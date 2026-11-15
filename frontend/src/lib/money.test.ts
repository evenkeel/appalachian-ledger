import { expect, test } from "vitest";
import { formatBitcoinPerDollar } from "./money";

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
