import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { BITCOIN } from "./board";
import type { Interval } from "./board";
import { applyTrades, isLive, lastTrade, onTrades } from "./live";

/** One bar: start time in seconds, open, high, low, close, volume. Chart coordinates, never ledger money. */
export type Bar = [number, number, number, number, number, number];

/** GET /api/market/candles */
export interface Feed {
  symbol: string;
  name: string;
  digits: number;
  /** What the bars are priced in: "BITCOIN" (whole bitcoin) or the symbol's own currency. */
  unit: string;
  currency: string;
  kind: string;
  exchange: string;
  source: string;
  session: "open" | "closed";
  stale: boolean;
  interval: Interval;
  /** False when only the newest bars were sent, to be laid over the ones already held. */
  full: boolean;
  candles: Bar[];
}
export type FeedInfo = Omit<Feed, "candles" | "full">;

/** One entry of GET /api/market/quotes. A symbol the provider does not know carries only an error. */
export interface Quote {
  symbol: string;
  name?: string | null;
  price?: number;
  previous?: number | null;
  basis?: string;
  observed_at?: number;
  session?: "open" | "closed";
  source?: string;
  stale?: boolean;
  spark?: number[];
  error?: string;
}

/**
 * How long to wait before reading bars again. Bitcoin's bars move with every trade while the stream is live,
 * so they are only re-read now and then to stay exact; without the stream they are read every few seconds.
 * The rest follow their provider's pace.
 */
const pace = (symbol: string, inBitcoin: boolean) => (symbol === BITCOIN ? (isLive() ? 10000 : 3000) : inBitcoin ? 5000 : 15000);
const RETRY = 20000;

/** Newer bars laid over the ones held: the bar in progress is replaced and later ones follow it. */
export function mergeBars(held: Bar[], fresh: Bar[]): Bar[] {
  if (!fresh.length) return held;
  const from = fresh[0][0];
  let keep = held.length;
  while (keep > 0 && held[keep - 1][0] >= from) keep--;
  return [...held.slice(0, keep), ...fresh];
}

/** Runs `read` again and again while the page is in view, waiting the number of milliseconds it returns. */
function usePolling(read: () => Promise<number>, key: string) {
  useEffect(() => {
    let alive = true;
    let busy = false;
    let timer = 0;
    const turn = async () => {
      window.clearTimeout(timer);
      if (!alive || busy || document.hidden) return;
      busy = true;
      const wait = await read().catch(() => RETRY);
      busy = false;
      if (alive) timer = window.setTimeout(turn, wait);
    };
    const onVisible = () => {
      if (!document.hidden) void turn();
    };
    void turn();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `read` belongs to its key: a new key starts a new loop.
  }, [key]);
}

interface Held {
  key: string;
  bars: Bar[];
  info: FeedInfo | null;
  error: string;
}
const nothing = (key: string): Held => ({ key, bars: [], info: null, error: "" });

/** Live bars for one symbol at one bar size, in its own currency or restated in bitcoin. */
export function useCandles(symbol: string, interval: Interval, inBitcoin = false) {
  const key = `${symbol}|${interval}${inBitcoin ? "|bitcoin" : ""}`;
  const [held, setHeld] = useState<Held>(() => nothing(key));
  // The bars held so far, readable between renders; a reply for an earlier symbol is dropped.
  const store = useRef<Held>(held);
  usePolling(async () => {
    if (store.current.key !== key) store.current = nothing(key);
    const keep = (next: Held) => {
      if (store.current.key !== key) return;
      store.current = next;
      setHeld(next);
    };
    const bars = store.current.bars;
    const after = bars.length ? `&after=${bars[bars.length - 1][0]}` : "";
    try {
      const unit = inBitcoin ? "&unit=bitcoin" : "";
      const { candles, full, ...info } = await api<Feed>(`/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}${unit}${after}`);
      let merged = full ? candles : mergeBars(store.current.bars, candles);
      // The reply left the server a moment ago; a trade that arrived since is newer than its last bar.
      const newest = symbol === BITCOIN ? lastTrade() : undefined;
      if (newest) merged = applyTrades(merged, [{ ...newest, s: 0 }], interval);
      keep({ key, bars: merged, info, error: "" });
      return pace(symbol, inBitcoin);
    } catch (e) {
      keep({ ...store.current, error: (e as Error).message });
      return RETRY;
    }
  }, key);
  // Bitcoin's newest bar follows every trade as it arrives.
  useEffect(() => {
    if (symbol !== BITCOIN) return;
    return onTrades((trades) => {
      const before = store.current;
      if (before.key !== key) return;
      const bars = applyTrades(before.bars, trades, interval);
      if (bars === before.bars) return;
      store.current = { ...before, bars };
      setHeld(store.current);
    });
  }, [symbol, interval, key]);
  // Bars of the previous symbol are never shown under the new one.
  const now = held.key === key ? held : nothing(key);
  return { key, bars: now.bars, info: now.info, error: now.error, loading: !now.bars.length && !now.error };
}

/** The latest price of every symbol on the board, read together. */
export function useQuotes(symbols: string[]) {
  const key = symbols.join(",");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [error, setError] = useState("");
  usePolling(async () => {
    if (!key) return RETRY;
    try {
      const reply = await api<{ quotes: Quote[] }>(`/market/quotes?symbols=${encodeURIComponent(key)}`);
      setQuotes(Object.fromEntries(reply.quotes.map((quote) => [quote.symbol, quote])));
      setError("");
      return 5000;
    } catch (e) {
      setError((e as Error).message);
      return RETRY;
    }
  }, key);
  return { quotes, error };
}

// ---------- Figures ----------

export const price = (value: number, digits = 2) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** A chart figure in whole bitcoin, written the way the rest of the app writes bitcoin. */
export const bitcoinPrice = (value: number, digits = 0) => `₿${price(value, digits)}`;

/** Decimal places that suit a price when the exchange's own precision is not known. */
export const digitsFor = (value: number) => (Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 2 : 4);

export function change(now: number | undefined, before: number | null | undefined) {
  if (now === undefined || !before) return null;
  const percent = ((now - before) / before) * 100;
  return { percent, up: percent >= 0, text: `${percent >= 0 ? "▲" : "▼"} ${Math.abs(percent).toFixed(2)}%` };
}

export function compact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(abs >= 100 || abs === 0 ? 0 : 2);
}

/** Symbols quoted in dollars whose figure is a yield, not a price, so it is never restated in bitcoin. */
const YIELDS = new Set(["^TNX", "^IRX", "^FVX", "^TYX"]);
export const isYield = (symbol: string) => YIELDS.has(symbol);

/** A live dollar price restated in whole bitcoin at the live bitcoin price. Null when either is missing. */
export function inBitcoin(symbol: string, currency: string | undefined, dollars: number | undefined, bitcoinPrice: number | undefined) {
  if (currency !== "USD" || YIELDS.has(symbol) || !dollars || !bitcoinPrice || dollars <= 0 || bitcoinPrice <= 0) return null;
  const units = symbol === BITCOIN ? 1e8 / bitcoinPrice : (dollars / bitcoinPrice) * 1e8;
  return Number.isFinite(units) ? String(Math.round(units)) : null;
}
