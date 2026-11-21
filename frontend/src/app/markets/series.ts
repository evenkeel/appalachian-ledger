import type { UTCTimestamp } from "lightweight-charts";
import type { Interval } from "./board";
import type { Bar } from "./feed";

export interface Row {
  time: UTCTimestamp;
  bar: Bar;
}

/**
 * Bars placed on the chart's clock. The chart draws every time as UTC, so bars within a day are moved
 * to the viewer's own time zone; daily and weekly bars already sit on their trading date.
 * Times must rise strictly, so the hour repeated when clocks go back is drawn once.
 */
export function rowsFrom(bars: Bar[], interval: Interval): Row[] {
  const withinDay = interval !== "1d" && interval !== "1w";
  const rows: Row[] = [];
  let last = -Infinity;
  for (const bar of bars) {
    const time = withinDay ? bar[0] - offsetAt(bar[0]) : bar[0];
    if (time <= last) continue;
    last = time;
    rows.push({ time: time as UTCTimestamp, bar });
  }
  return rows;
}

/** The viewer's offset from UTC in seconds at a moment. Looked up per hour, since a live chart asks many times a second. */
const offsets = new Map<number, number>();
function offsetAt(seconds: number) {
  const hour = Math.floor(seconds / 3600);
  let offset = offsets.get(hour);
  if (offset === undefined) {
    if (offsets.size > 50000) offsets.clear();
    offset = new Date(hour * 3600000).getTimezoneOffset() * 60;
    offsets.set(hour, offset);
  }
  return offset;
}

/** The average close of the last `period` bars at each bar, or null before there are enough. */
export function movingAverage(closes: number[], period: number): (number | null)[] {
  let sum = 0;
  return closes.map((close, index) => {
    sum += close;
    if (index >= period) sum -= closes[index - period];
    return index >= period - 1 ? sum / period : null;
  });
}
