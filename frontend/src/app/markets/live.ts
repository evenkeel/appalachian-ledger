import { useSyncExternalStore } from "react";
import { INTERVALS } from "./board";
import type { Interval } from "./board";
import type { Bar } from "./feed";

/** One bitcoin trade from GET /api/market/stream: dollar price, size in BTC, time in milliseconds. */
export interface Trade {
  p: number;
  s: number;
  t: number;
}
type Listener = (trades: Trade[]) => void;

/**
 * One stream of bitcoin trades shared by everything on the screen. It opens with the first listener,
 * closes with the last, and rests while the page is hidden. Trades are handed over in batches, at most
 * once per frame, so a burst of hundreds of trades is one redraw and none of them is lost.
 */
const listeners = new Set<Listener>();
const watchers = new Set<() => void>();
let source: EventSource | null = null;
let retry = 0;
let waiting: Trade[] = [];
let scheduled = false;
let flushed = 0;
let last: Trade | undefined;
let connected = false;
/** Milliseconds between redraws at the fastest. */
const FRAME = 30;

const notify = () => watchers.forEach((watcher) => watcher());

function flush() {
  scheduled = false;
  if (!waiting.length) return;
  const batch = waiting;
  waiting = [];
  flushed = Date.now();
  last = batch[batch.length - 1];
  listeners.forEach((listener) => listener(batch));
  notify();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  const wait = Math.max(0, FRAME - (Date.now() - flushed));
  window.setTimeout(() => (typeof requestAnimationFrame === "function" && !document.hidden ? requestAnimationFrame(flush) : flush()), wait);
}

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  notify();
}

function close() {
  window.clearTimeout(retry);
  source?.close();
  source = null;
  setConnected(false);
}

function open() {
  if (source || !listeners.size || document.hidden || typeof EventSource === "undefined") return;
  const stream = new EventSource("/api/market/stream");
  source = stream;
  stream.onopen = () => setConnected(true);
  stream.onmessage = (event) => {
    try {
      const trade = JSON.parse(event.data as string) as Trade;
      if (!(trade.p > 0) || !Number.isFinite(trade.t)) return;
      setConnected(true);
      waiting.push(trade);
      schedule();
    } catch {
      /* A line that is not a trade is ignored. */
    }
  };
  stream.onerror = () => {
    setConnected(false);
    // The browser reconnects by itself unless the server refused; then try again after a pause.
    if (stream.readyState !== 2) return;
    if (source === stream) source = null;
    window.clearTimeout(retry);
    retry = window.setTimeout(open, 5000);
  };
}

function onVisibility() {
  if (document.hidden) close();
  else open();
}

/** Receive every bitcoin trade, in batches. Returns the function that stops listening. */
export function onTrades(listener: Listener) {
  if (!listeners.size) document.addEventListener("visibilitychange", onVisibility);
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    document.removeEventListener("visibilitychange", onVisibility);
    close();
  };
}

/** Whether trades are arriving right now. When they are not, prices fall back to being read every few seconds. */
export const isLive = () => connected;
export const lastTrade = () => (connected ? last : undefined);

const watch = (watcher: () => void) => {
  watchers.add(watcher);
  const stop = onTrades(nothing);
  return () => {
    watchers.delete(watcher);
    stop();
  };
};
const nothing = () => {};
const never = () => () => {};

/** The newest bitcoin trade price while the stream is live, for a figure that should move with every trade. */
export function useLivePrice(enabled = true) {
  return useSyncExternalStore(enabled ? watch : never, () => (enabled && connected ? last?.p : undefined));
}

/** Whether the stream is live, for saying so on screen. */
export function useLive(enabled = true) {
  return useSyncExternalStore(enabled ? watch : never, () => enabled && connected);
}

/** The start, in seconds, of the bar a moment falls in. Bitcoin's bars are cut on UTC boundaries; weeks start on Monday. */
export function barStart(seconds: number, interval: Interval) {
  if (interval === "1w") {
    const day = Math.floor(seconds / 86400);
    return (day - ((((day + 3) % 7) + 7) % 7)) * 86400;
  }
  const step = INTERVALS.find((entry) => entry.id === interval)!.seconds;
  return Math.floor(seconds / step) * step;
}

/**
 * Trades folded into bars: a trade inside the newest bar moves its close, stretches its high or low and
 * adds its size; a trade past the newest bar opens the next one. A trade older than the newest bar is
 * left out, because the server's own bars already count it. Returns the same array when nothing changed.
 */
export function applyTrades(bars: Bar[], trades: Trade[], interval: Interval): Bar[] {
  if (!bars.length) return bars;
  let result = bars;
  let newest = bars[bars.length - 1];
  let own = false;
  for (const trade of trades) {
    const start = barStart(Math.floor(trade.t / 1000), interval);
    if (start < newest[0]) continue;
    if (result === bars) result = bars.slice();
    if (start > newest[0]) {
      newest = [start, trade.p, trade.p, trade.p, trade.p, trade.s];
      result.push(newest);
      own = true;
      continue;
    }
    if (!own) {
      newest = [...newest];
      result[result.length - 1] = newest;
      own = true;
    }
    newest[2] = Math.max(newest[2], trade.p);
    newest[3] = Math.min(newest[3], trade.p);
    newest[4] = trade.p;
    newest[5] += trade.s;
  }
  return result;
}

/** Forget everything, for tests. */
export function resetLive() {
  close();
  listeners.clear();
  watchers.clear();
  waiting = [];
  scheduled = false;
  flushed = 0;
  last = undefined;
}
