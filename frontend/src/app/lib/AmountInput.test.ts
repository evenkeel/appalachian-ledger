import { describe, expect, it } from "vitest";
import { grouped } from "./AmountInput";

describe("grouped", () => {
  it("puts commas in whole bitcoin so 800,000 and 8,000,000 look different", () => {
    expect(grouped("800000")).toBe("800,000");
    expect(grouped("8000000")).toBe("8,000,000");
    expect(grouped("₿1250000")).toBe("1,250,000");
  });
  it("keeps cents and regroups commas typed in the wrong place", () => {
    expect(grouped("1400.5")).toBe("1,400.5");
    expect(grouped("$12,34,567.00")).toBe("1,234,567.00");
    expect(grouped("-2500")).toBe("-2,500");
    expect(grouped("0.75")).toBe("0.75");
    expect(grouped("")).toBe("");
  });
  it("leaves anything that is not a plain number as typed, for the form to question", () => {
    expect(grouped("12abc")).toBe("12abc");
    expect(grouped("1.2.3")).toBe("1.2.3");
  });
});
