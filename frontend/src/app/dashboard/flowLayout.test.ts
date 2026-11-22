import { describe, expect, it } from "vitest";
import { estimateText, layoutFlow } from "./flowLayout";
import type { FlowItem, FlowLayout, FlowPlaced } from "./flowLayout";

const item = (name: string, size: number, unit: "₿" | "$" = "₿"): FlowItem => ({ name, value: `${unit}${size.toLocaleString("en-US")}`, size });

/** The box each label row covers, from its anchor, width and font size. */
const boxes = (placed: FlowPlaced[]) =>
  placed.flatMap((p, owner) =>
    p.rows.map((row) => {
      const size = Math.max(...row.parts.map((part) => part.size));
      const left = p.anchor === "end" ? p.x - row.width : p.x;
      return { owner, left, right: left + row.width, top: row.y - size * 0.8, bottom: row.y + size * 0.25, text: row.parts.map((part) => part.text).join(" ") };
    }),
  );

function problems(layout: FlowLayout) {
  const found: string[] = [];
  for (const side of [layout.sources, layout.dests]) {
    const all = boxes(side);
    for (const a of all) {
      if (a.left < 0 || a.right > layout.width || a.top < 0 || a.bottom > layout.height) found.push(`off the chart: ${a.text}`);
      for (const b of all) if (a.owner < b.owner && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) found.push(`${a.text} on top of ${b.text}`);
    }
  }
  // Labels stay on their own side of the ribbons.
  for (const a of boxes(layout.sources)) if (a.right > layout.sourceX) found.push(`over the income bar: ${a.text}`);
  for (const a of boxes(layout.dests)) if (a.left < layout.destX + layout.node) found.push(`over the spending bar: ${a.text}`);
  return found;
}

const months: Record<string, { sources: FlowItem[]; dests: FlowItem[] }> = {
  // The month that first showed the fault: two small income lines beside one large one, in bitcoin.
  "two small income lines": {
    sources: [item("Underwriting", 3690744), item("Freelance", 33877), item("Other income", 3261), item("From cash on hand", 1049680)],
    dests: [
      { ...item("Bitcoin stacked", 1500000), nameSize: 12.5, nameWeight: 700, valueSize: 11, roomy: true },
      item("Mortgage interest & insurance", 1900000),
      item("Groceries", 680000),
      item("Utilities", 320000),
      item("Dining", 220000),
      item("Transport", 157562),
    ],
  },
  "nine income lines, most of them tiny": {
    sources: [item("Salary", 3000000), item("Second job at the hardware store", 900000), item("Rental income", 800000), ...["Interest", "Dividends", "Cashback", "Refunds", "Gifts received", "Sold on marketplace"].map((name, i) => item(name, 300 - i * 40))],
    dests: [item("Bitcoin stacked", 4000000), item("Groceries", 300000), item("Still in checking", 401100)],
  },
  "twenty categories": {
    sources: [item("Salary", 6000000)],
    dests: [...Array.from({ length: 20 }, (_, i) => item(`Category number ${i + 1}`, 20000 + i * 9000)), item("Still in checking", 3890000)],
  },
  "long names and long amounts": {
    sources: [item("Salary", 1234567890), item("Bonus", 987654321)],
    dests: [item("Extraordinarily long category name for testing purposes", 123456789), item("Travel", 98765432), item("X", 1), item("Still in checking", 1999999988)],
  },
  "the same month in dollars": {
    sources: [item("Underwriting", 4342, "$"), item("Freelance", 39, "$"), item("Other income", 3, "$")],
    dests: [item("Groceries", 800, "$"), item("Other moves out", 2380, "$"), item("Still in checking", 1204, "$")],
  },
};

describe("money flow layout", () => {
  for (const [name, month] of Object.entries(months))
    for (const width of [300, 321, 519, 520, 742, 1302])
      it(`keeps every label readable: ${name} at ${width}px`, () => {
        expect(problems(layoutFlow({ width, ...month, measure: estimateText }))).toEqual([]);
      });

  it("gives each small income line a row of its own instead of stacking them", () => {
    const layout = layoutFlow({ width: 742, ...months["two small income lines"], measure: estimateText });
    const names = layout.sources.map((source) => source.rows[0].y);
    for (let i = 1; i < names.length; i++) expect(names[i] - names[i - 1]).toBeGreaterThanOrEqual(27);
  });

  it("shortens a name that cannot fit rather than letting it run off the chart", () => {
    const layout = layoutFlow({ width: 520, ...months["long names and long amounts"], measure: estimateText });
    const [name, value] = layout.dests[0].rows[0].parts;
    expect(name.text).toMatch(/^Extraordinarily.*…$/);
    expect(value.text).toBe("₿123,456,789");
  });

  it("shows an amount whole on a small phone, shortening the name before the figure", () => {
    const layout = layoutFlow({
      width: 266,
      measure: estimateText,
      sources: [item("Salary", 6200, "$"), item("Freelance", 117, "$")],
      dests: [{ name: "Bitcoin stacked", value: "₿420,000 · $400.00", size: 400, nameSize: 12.5, nameWeight: 700, valueSize: 11, roomy: true }, item("Other moves out", 2380, "$"), item("Still in checking", 3537, "$")],
    });
    expect(problems(layout)).toEqual([]);
    expect(layout.dests.map((dest) => dest.rows[1].parts[0].text)).toEqual(["₿420,000 · $400.00", "$2,380", "$3,537"]);
    expect(layout.destX - layout.hubX).toBeGreaterThan(15);
    expect(layout.hubX - layout.sourceX).toBeGreaterThan(15);
  });

  it("keeps the hub and both columns inside the chart", () => {
    for (const month of Object.values(months)) {
      const layout = layoutFlow({ width: 742, ...month, measure: estimateText });
      expect(layout.hub.y).toBeGreaterThanOrEqual(0);
      expect(layout.hub.y + layout.hub.height).toBeLessThanOrEqual(layout.height);
      for (const bar of [...layout.sources, ...layout.dests]) {
        expect(bar.y).toBeGreaterThanOrEqual(0);
        expect(bar.y + bar.height).toBeLessThanOrEqual(layout.height);
      }
      expect(layout.sourceX).toBeLessThan(layout.hubX);
      expect(layout.hubX).toBeLessThan(layout.destX);
    }
  });
});
