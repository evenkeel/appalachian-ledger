import { useSyncExternalStore } from "react";
import { sharedStream } from "./stream";

/** One price level: the price and the bitcoin (in BTC) resting there. */
export type Level = [number, number];
/** One side-by-side view of the book: bids from the highest price down, asks from the lowest price up. */
export interface View {
  /** The dollar width of each price group. */
  step: number;
  bids: Level[];
  asks: Level[];
}
/** GET /api/market/book: a picture of the BTC-USD order book, sent a few times a second. */
export interface Picture {
  /** Milliseconds, by the exchange's clock. */
  t: number;
  /** The highest price a buyer is waiting at and the lowest a seller is. */
  bid: number;
  ask: number;
  /** The levels nearest the spread exactly as the exchange holds them. */
  top: View;
  /** Grouped finely, a short way either side of the price. */
  near: View;
  /** Grouped coarsely, a long way either side, for the depth chart and wider groups. */
  wide: View;
  /** Grouped more coarsely still, a quarter of the price either side, for the widest groups and reaches. */
  far?: View;
}

const watchers = new Set<() => void>();
const notify = () => watchers.forEach((watcher) => watcher());
let picture: Picture | undefined;

const stream = sharedStream(
  "/api/market/book",
  (message) => {
    const next = message as Picture;
    if (!(next?.bid > 0) || !(next.ask > next.bid) || !next.top || !next.near || !next.wide) return;
    picture = next;
    notify();
  },
  notify,
);

const watch = (watcher: () => void) => {
  watchers.add(watcher);
  const stop = stream.use();
  return () => {
    watchers.delete(watcher);
    stop();
  };
};

/** The newest picture of the order book and whether it is still arriving. */
export function useBook() {
  const book = useSyncExternalStore(watch, () => picture);
  const live = useSyncExternalStore(watch, () => stream.isConnected());
  return { book, live };
}

/** Forget everything, for tests. */
export function resetBook() {
  stream.reset();
  watchers.clear();
  picture = undefined;
}

// ---------- Reading a picture ----------

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const multiple = (value: number, of: number) => same(Math.round(value / of) * of, value);

/** The group widths a picture can be shown at: the exchange's own cent levels, then each wider grouping. */
export function groupsOf(book: Picture): number[] {
  const { step } = book.wide;
  // The far view is a quarter of the price either way, so even its widest groups fill a panel with rows.
  const farStep = book.far?.step;
  const far = farStep ? [1, 2, 5, 10, 20].map((times) => farStep * times) : [];
  return [book.top.step, book.near.step, step, step * 2, step * 10, step * 20, ...far]
    .filter((value, at, all) => all.findIndex((other) => same(other, value)) === at)
    .sort((a, b) => a - b);
}

/** Levels joined into wider price groups. A group of bids is named by its lowest price, a group of asks by its highest. */
function regroup(levels: Level[], width: number, side: "bids" | "asks"): Level[] {
  const round = side === "bids" ? Math.floor : Math.ceil;
  const joined: Level[] = [];
  for (const [price, size] of levels) {
    const key = round(price / width + (side === "bids" ? 1e-9 : -1e-9)) * width;
    const last = joined[joined.length - 1];
    if (last && same(last[0], key)) last[1] += size;
    else joined.push([key, size]);
  }
  return joined;
}

/** The book at a group width, and the width actually used when the one asked for is not available. */
export function grouped(book: Picture, width: number): View {
  if (same(width, book.top.step)) return book.top;
  if (same(width, book.near.step)) return book.near;
  if (same(width, book.wide.step)) return book.wide;
  if (book.far && same(width, book.far.step)) return book.far;
  // The wider a group, the further out the book it is joined from has to reach to fill a panel.
  const source = book.far && width >= book.far.step && multiple(width, book.far.step) ? book.far : book.wide;
  if (width > source.step && multiple(width, source.step)) return { step: width, bids: regroup(source.bids, width, "bids"), asks: regroup(source.asks, width, "asks") };
  return book.near;
}

/** A level with everything resting between it and the spread added up. */
export interface Reach {
  price: number;
  size: number;
  /** BTC from the spread out to this price. */
  total: number;
  /** The dollars it would take to trade through all of it. */
  dollars: number;
}

/** Running totals outward from the spread, for a side already ordered that way. */
export function reaches(levels: Level[]): Reach[] {
  let total = 0,
    dollars = 0;
  return levels.map(([price, size]) => {
    total += size;
    dollars += price * size;
    return { price, size, total, dollars };
  });
}

/** Both sides of the book out to a share of the price either way, for the depth chart. */
export function depth(book: Picture, reach: number) {
  const middle = (book.bid + book.ask) / 2;
  const low = middle * (1 - reach),
    high = middle * (1 + reach);
  // The finest grouped view that reaches far enough is used.
  const reachesOut = (view: View | undefined): view is View =>
    !!view && view.bids.length > 0 && view.asks.length > 0 && view.bids[view.bids.length - 1][0] <= low && view.asks[view.asks.length - 1][0] >= high;
  const view = [book.near, book.wide].find(reachesOut) ?? book.far ?? book.wide;
  return {
    middle,
    low,
    high,
    bids: reaches(view.bids.filter(([price]) => price >= low)),
    asks: reaches(view.asks.filter(([price]) => price <= high)),
  };
}

/** The spread between the best seller and the best buyer, in dollars and as a share of the price. */
export function spread(book: Picture) {
  const dollars = book.ask - book.bid;
  return { dollars, percent: (dollars / ((book.ask + book.bid) / 2)) * 100 };
}
