import type { UTCTimestamp } from "lightweight-charts";
import { DATED } from "./board";
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
  const withinDay = !DATED.has(interval);
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

/** An exponential moving average, seeded with the plain average of the first `period` values. */
export function expAverage(values: (number | null)[], period: number): (number | null)[] {
  const weight = 2 / (period + 1);
  let value: number | null = null;
  let seed = 0,
    seen = 0;
  return values.map((entry) => {
    if (entry == null) return null;
    if (value === null) {
      seed += entry;
      if (++seen < period) return null;
      value = seed / period;
      return value;
    }
    value = entry * weight + value * (1 - weight);
    return value;
  });
}

/**
 * Relative strength index, smoothed the way Wilder set it out: 0 to 100, where above 70 is usually read
 * as stretched up and below 30 as stretched down. Null until there are `period` changes to go on.
 */
export function rsi(closes: number[], period = 14): (number | null)[] {
  let gain = 0,
    loss = 0;
  return closes.map((close, index) => {
    if (index === 0) return null;
    const move = close - closes[index - 1];
    const up = Math.max(0, move),
      down = Math.max(0, -move);
    if (index <= period) {
      gain += up / period;
      loss += down / period;
      if (index < period) return null;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  });
}

/** MACD: the 12-bar exponential average less the 26-bar one, its 9-bar signal line, and the gap between them. */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const quick = expAverage(closes, fast),
    steady = expAverage(closes, slow);
  const line = closes.map((_, at) => (quick[at] != null && steady[at] != null ? (quick[at] as number) - (steady[at] as number) : null));
  const trigger = expAverage(line, signal);
  const histogram = line.map((value, at) => (value != null && trigger[at] != null ? value - (trigger[at] as number) : null));
  return { line, signal: trigger, histogram };
}

/** Bollinger bands: the `period`-bar average, with lines `width` standard deviations above and below it. */
export function bands(closes: number[], period = 20, width = 2) {
  const middle = movingAverage(closes, period);
  const upper: (number | null)[] = [],
    lower: (number | null)[] = [];
  closes.forEach((_, at) => {
    const mean = middle[at];
    if (mean == null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    let sum = 0;
    for (let back = at - period + 1; back <= at; back++) sum += (closes[back] - mean) ** 2;
    const spread = Math.sqrt(sum / period) * width;
    upper.push(mean + spread);
    // In a wild stretch the lower band can fall below nothing, which no price can; it is left undrawn there.
    lower.push(mean - spread > 0 ? mean - spread : null);
  });
  return { upper, middle, lower };
}

/**
 * Trades gathered into bars of `size` trades each, oldest first. The newest bar may hold fewer while it fills.
 * A bar's time is its number, counted from `first`, since several bars can open within one second; `times`
 * holds when each bar's first trade happened, in seconds.
 */
export function tickBars(trades: { p: number; s: number; t: number }[], size: number, first = 0) {
  const bars: Bar[] = [];
  const times: number[] = [];
  for (let at = 0; at < trades.length; at += size) {
    const run = trades.slice(at, at + size);
    let high = -Infinity,
      low = Infinity,
      volume = 0;
    for (const trade of run) {
      high = Math.max(high, trade.p);
      low = Math.min(low, trade.p);
      volume += trade.s;
    }
    bars.push([first + bars.length, run[0].p, high, low, run[run.length - 1].p, volume]);
    times.push(run[0].t / 1000);
  }
  return { bars, times };
}

/**
 * What a turn of the wheel over a chart does. The board is a page of charts, so a plain scroll must move
 * the page, not get swallowed by whichever chart is under the pointer. Zooming takes Ctrl or Cmd, which is
 * also how a trackpad pinch arrives, and a sideways swipe moves through time. A chart that fills the
 * screen has no page to scroll, so there a plain scroll zooms.
 */
export type WheelAction = "zoom" | "pan" | "page";
export function wheelAction(event: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean }, fillsScreen: boolean): WheelAction {
  if (event.ctrlKey || event.metaKey) return "zoom";
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return "pan";
  return fillsScreen ? "zoom" : "page";
}
