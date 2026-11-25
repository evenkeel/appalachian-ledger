/* Money flow geometry: where every ribbon, node and label goes. Pure arithmetic on
   coordinates, so the no-overlap rules can be tested without a browser. */

export interface FlowItem {
  name: string;
  /** The formatted amount, already exact text. */
  value: string;
  /** Ribbon thickness before scaling. A coordinate, never shown. */
  size: number;
  nameSize?: number;
  nameWeight?: number;
  valueSize?: number;
  /** Put the amount under the name when the ribbon is thick enough to hold both. */
  roomy?: boolean;
}

/** Width of a run of text in pixels at a font size and weight. */
export type Measure = (text: string, size: number, weight?: number) => number;

export interface FlowPart {
  kind: "name" | "value";
  text: string;
  size: number;
  weight: number;
}
export interface FlowRow {
  /** Text baseline. */
  y: number;
  parts: FlowPart[];
  width: number;
}
export interface FlowPlaced {
  /** The node bar. */
  y: number;
  height: number;
  /** Where its ribbon meets the hub. */
  hubY: number;
  /** Label anchor: rows end here on the income side and start here on the other. */
  x: number;
  anchor: "start" | "end";
  rows: FlowRow[];
}
export interface FlowLayout {
  width: number;
  height: number;
  node: number;
  sourceX: number;
  hubX: number;
  destX: number;
  hub: { y: number; height: number };
  sources: FlowPlaced[];
  dests: FlowPlaced[];
}

/** Space between a name and the amount that follows it on the same row. */
export const PART_GAP = 6;
const NODE = 8,
  GAP = 4,
  PAD = 6,
  LABEL_GAP = 8,
  MIN_RIBBONS = 40,
  ONE_ROW = 15,
  TWO_ROWS = 27;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Lay out one month of money: income on the left, a hub, and where it went on the right.
    Every label gets a slot tall enough for its own rows, so a thin ribbon never stacks its
    text on a neighbour's, and a name too long for its column is shortened with an ellipsis. */
export function layoutFlow({ width, sources, dests, measure }: { width: number; sources: FlowItem[]; dests: FlowItem[]; measure: Measure }): FlowLayout {
  const narrow = width < 520;
  // Income labels always take two rows; the other side does too once there is no room for name and amount side by side.
  const sourceMin = sources.map(() => TWO_ROWS),
    destMin = dests.map(() => (narrow ? TWO_ROWS : ONE_ROW));
  const stacked = (mins: number[]) => sum(mins) + GAP * Math.max(0, mins.length - 1);
  const height = Math.max(250, Math.max(stacked(sourceMin), stacked(destMin)) + PAD * 2 + 96);
  const total = Math.max(sum(sources.map((item) => item.size)), sum(dests.map((item) => item.size))) || 1;

  // The largest scale at which a column still fits once every slot is at least its label's height.
  const scale = (items: FlowItem[], mins: number[]) => {
    const room = height - PAD * 2 - GAP * Math.max(0, items.length - 1);
    let low = 0,
      high = room / total;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (sum(items.map((item, index) => Math.max(item.size * mid, mins[index]))) > room) high = mid;
      else low = mid;
    }
    return low;
  };
  const k = Math.min(scale(sources, sourceMin), scale(dests, destMin));
  const hub = { y: (height - total * k) / 2, height: total * k };

  const column = (items: FlowItem[], mins: number[]) => {
    const slots = items.map((item, index) => Math.max(item.size * k, mins[index]));
    let y = (height - stacked(slots)) / 2,
      hubY = hub.y;
    return items.map((item, index) => {
      const bar = Math.max(item.size * k, 1.5);
      const placed = { y: y + (slots[index] - bar) / 2, height: bar, hubY, center: y + slots[index] / 2 };
      y += slots[index] + GAP;
      hubY += item.size * k;
      return placed;
    });
  };
  const sourceBars = column(sources, sourceMin),
    destBars = column(dests, destMin);

  const part = (item: FlowItem, kind: "name" | "value"): FlowPart =>
    kind === "name"
      ? { kind, text: item.name, size: item.nameSize ?? 12, weight: item.nameWeight ?? 400 }
      : { kind, text: item.value, size: item.valueSize ?? 10.5, weight: 400 };
  const wide = (p: FlowPart) => measure(p.text, p.size, p.weight);
  /** Shorten text to fit, keeping as many leading characters as the room allows. */
  const fit = (p: FlowPart, room: number): FlowPart => {
    // Half a pixel of give, so a label that exactly fills its column is not cut by rounding.
    if (wide(p) <= room + 0.5) return p;
    let cut = p.text.length - 1;
    const short = () => `${p.text.slice(0, cut).trimEnd()}…`;
    while (cut > 1 && measure(short(), p.size, p.weight) > room) cut -= 1;
    return { ...p, text: short() };
  };
  const twoRows = (item: FlowItem, center: number, room: number): FlowRow[] =>
    (["name", "value"] as const).map((kind, index) => {
      const fitted = fit(part(item, kind), room);
      return { y: center + (index ? 10 : -3), parts: [fitted], width: wide(fitted) };
    });
  const oneRow = (item: FlowItem, center: number, room: number): FlowRow[] => {
    const value = fit(part(item, "value"), room * 0.7);
    const name = fit(part(item, "name"), room - PART_GAP - wide(value));
    return [{ y: center + 4, parts: [name, value], width: wide(name) + PART_GAP + wide(value) }];
  };

  // Each side's label column is as wide as its longest label needs, up to a share of the chart.
  const tall = dests.map((item, index) => narrow || (!!item.roomy && destBars[index].height >= 28));
  const needLeft = Math.max(0, ...sources.map((item) => Math.max(wide(part(item, "name")), wide(part(item, "value")))));
  const needRight = Math.max(
    0,
    ...dests.map((item, index) => {
      const name = wide(part(item, "name")),
        value = wide(part(item, "value"));
      return tall[index] ? Math.max(name, value) : name + PART_GAP + value;
    }),
  );
  const edge = LABEL_GAP + 2;
  // A shortened name still reads; a shortened amount reads as a different amount. So a column may pass
  // its usual share to hold its widest amount whole, as long as the ribbons keep some room between.
  const amount = (items: FlowItem[]) => Math.max(0, ...items.map((item) => wide(part(item, "value")))) + edge;
  const between = width - MIN_RIBBONS - NODE * 2;
  const leftShare = narrow ? width * 0.32 : Math.min(200, width * 0.26),
    rightShare = narrow ? width * 0.4 : Math.min(340, width * 0.44);
  const left = clamp(needLeft + edge, 56, Math.max(leftShare, Math.min(amount(sources), between - rightShare)));
  const right = clamp(needRight + edge, 96, Math.max(rightShare, Math.min(amount(dests), between - left)));
  const sourceX = left,
    destX = width - right - NODE,
    hubX = left + (width - left - right) * 0.42;

  return {
    width,
    height,
    node: NODE,
    sourceX,
    hubX,
    destX,
    hub,
    sources: sources.map((item, index) => {
      const { center, ...bar } = sourceBars[index];
      return { ...bar, x: sourceX - LABEL_GAP, anchor: "end" as const, rows: twoRows(item, center, left - edge) };
    }),
    dests: dests.map((item, index) => {
      const { center, ...bar } = destBars[index];
      const rows = tall[index] ? twoRows(item, center, right - edge) : oneRow(item, center, right - edge);
      return { ...bar, x: destX + NODE + LABEL_GAP, anchor: "start" as const, rows };
    }),
  };
}

/** A rough text width for places with no font to measure against (tests). Errs wide. */
export const estimateText: Measure = (text, size, weight = 400) =>
  [...text].reduce((total, char) => total + (/[0-9₿$−]/.test(char) ? 0.66 : /[,.·' ]/.test(char) ? 0.3 : /[A-Z&mw…]/.test(char) ? 0.78 : 0.56), 0) * size * (weight >= 600 ? 1.06 : 1);
