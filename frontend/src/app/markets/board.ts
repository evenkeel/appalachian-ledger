/** The Markets board: which panels are open, what each shows and where it sits. Kept in this browser. */

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
export const INTERVALS: { id: Interval; label: string; long: string; seconds: number }[] = [
  { id: "1m", label: "1m", long: "1 minute", seconds: 60 },
  { id: "5m", label: "5m", long: "5 minutes", seconds: 300 },
  { id: "15m", label: "15m", long: "15 minutes", seconds: 900 },
  { id: "1h", label: "1h", long: "1 hour", seconds: 3600 },
  { id: "4h", label: "4h", long: "4 hours", seconds: 14400 },
  { id: "1d", label: "1D", long: "1 day", seconds: 86400 },
  { id: "1w", label: "1W", long: "1 week", seconds: 604800 },
];

/** What a chart is priced in: dollars (its own currency) or bitcoin. */
export type Unit = "USD" | "BITCOIN";
export type Style = "bars" | "candles" | "line" | "area";
export const STYLES: { id: Style; label: string }[] = [
  { id: "bars", label: "Bars" },
  { id: "candles", label: "Candles" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
];
/** Moving averages a chart can draw, in bars. */
export const AVERAGES = [20, 50, 200];

export interface Instrument {
  symbol: string;
  name: string;
}
export interface ChartSpec {
  id: string;
  kind: "chart";
  symbol: string;
  name: string;
  interval: Interval;
  style: Style;
  volume: boolean;
  log: boolean;
  averages: number[];
  /** Set when this chart was switched on its own; without it the chart follows the switch in the top bar. */
  unit?: Unit;
}
export interface ListSpec {
  id: string;
  kind: "list";
  items: Instrument[];
}
/** Bitcoin's order book: who is waiting to buy and sell, and at what prices. */
export interface BookSpec {
  id: string;
  kind: "book";
  /** The dollar width of each price group; the exchange's own cent levels when 0.01. */
  group: number;
}
/** Bitcoin's depth chart: the order book added up outward from the price. */
export interface DepthSpec {
  id: string;
  kind: "depth";
  /** How far either side of the price the chart reaches, as a share of the price. */
  reach: number;
}
export type Spec = ChartSpec | ListSpec | BookSpec | DepthSpec;
/** The distances a depth chart can reach either side of the price. */
export const REACHES = [0.0025, 0.005, 0.01, 0.025];
export interface Slot {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Board {
  panels: Spec[];
  layout: Slot[];
  /** The chart a watchlist click loads into. */
  active: string | null;
}

export const BITCOIN = "BTC-USD";
export const COLUMNS = 12;
export const ROW = 30;
export const MAX_PANELS = 12;
export const MAX_LIST = 30;
export const SMALLEST = { chart: { w: 3, h: 7 }, list: { w: 2, h: 5 }, book: { w: 2, h: 8 }, depth: { w: 3, h: 6 } };
const START = { chart: { w: 6, h: 11 }, list: { w: 3, h: 11 }, book: { w: 3, h: 14 }, depth: { w: 6, h: 9 } };
const SYMBOL = /^[A-Z0-9^][A-Z0-9.\-^=]{0,14}$/;
export const isSymbol = (value: string) => SYMBOL.test(value);

/** Quick picks in the symbol search, named plainly. Symbols are Yahoo Finance's, except bitcoin. */
export const PRESETS: { group: string; items: Instrument[] }[] = [
  {
    group: "Money and metals",
    items: [
      { symbol: BITCOIN, name: "Bitcoin" },
      { symbol: "GC=F", name: "Gold" },
      { symbol: "SI=F", name: "Silver" },
      { symbol: "DX-Y.NYB", name: "US dollar index" },
      { symbol: "^TNX", name: "10-year Treasury yield" },
      { symbol: "CL=F", name: "Crude oil" },
    ],
  },
  {
    group: "Stock indexes",
    items: [
      { symbol: "^GSPC", name: "S&P 500" },
      { symbol: "^NDX", name: "Nasdaq 100" },
      { symbol: "^DJI", name: "Dow Jones" },
      { symbol: "^RUT", name: "Russell 2000" },
    ],
  },
  {
    group: "Stocks",
    items: [
      { symbol: "MSTR", name: "Strategy" },
      { symbol: "AAPL", name: "Apple" },
      { symbol: "NVDA", name: "Nvidia" },
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "MSFT", name: "Microsoft" },
      { symbol: "AMZN", name: "Amazon" },
    ],
  },
];
const preset = (symbol: string) => PRESETS.flatMap((group) => group.items).find((item) => item.symbol === symbol)!;

export function chart(id: string, instrument: Instrument, interval: Interval = "1h"): ChartSpec {
  return { id, kind: "chart", ...instrument, interval, style: "bars", volume: true, log: false, averages: [] };
}

/** What a first visit shows: bitcoin large, a watchlist beside it, gold and the S&P 500 below. */
export function defaultBoard(): Board {
  return {
    panels: [
      chart("p1", preset(BITCOIN), "15m"),
      { id: "p2", kind: "list", items: [BITCOIN, "GC=F", "SI=F", "^GSPC", "^NDX", "DX-Y.NYB", "^TNX", "CL=F", "MSTR"].map(preset) },
      chart("p3", preset("GC=F"), "1d"),
      chart("p4", preset("^GSPC"), "1d"),
    ],
    layout: [
      { i: "p1", x: 0, y: 0, w: 9, h: 13 },
      { i: "p2", x: 9, y: 0, w: 3, h: 13 },
      { i: "p3", x: 0, y: 13, w: 6, h: 10 },
      { i: "p4", x: 6, y: 13, w: 6, h: 10 },
    ],
    active: "p1",
  };
}

function nextId(board: Board) {
  const used = board.panels.map((panel) => Number(panel.id.slice(1))).filter(Number.isFinite);
  return `p${Math.max(0, ...used) + 1}`;
}

/** A new panel goes below everything already on the board. */
export function addPanel(board: Board, make: (id: string) => Spec): Board {
  if (board.panels.length >= MAX_PANELS) return board;
  const id = nextId(board);
  const panel = make(id);
  const bottom = Math.max(0, ...board.layout.map((slot) => slot.y + slot.h));
  return {
    panels: [...board.panels, panel],
    layout: [...board.layout, { i: id, x: 0, y: bottom, ...START[panel.kind] }],
    active: panel.kind === "chart" ? id : board.active,
  };
}

export function removePanel(board: Board, id: string): Board {
  const panels = board.panels.filter((panel) => panel.id !== id);
  const active = board.active === id ? (panels.find((panel) => panel.kind === "chart")?.id ?? null) : board.active;
  return { panels, layout: board.layout.filter((slot) => slot.i !== id), active };
}

export function changePanel<T extends Spec>(board: Board, id: string, patch: Partial<T>): Board {
  return { ...board, panels: board.panels.map((panel) => (panel.id === id ? ({ ...panel, ...patch } as Spec) : panel)) };
}

/** Every chart follows the top-bar switch again, dropping any choice made on a single chart. */
export function followLens(board: Board): Board {
  if (!board.panels.some((panel) => panel.kind === "chart" && panel.unit)) return board;
  return {
    ...board,
    panels: board.panels.map((panel) => {
      if (panel.kind !== "chart") return panel;
      const { unit: _dropped, ...rest } = panel;
      return rest;
    }),
  };
}

/** Every symbol the board shows, once each, bitcoin always among them. */
export function symbolsOn(board: Board): string[] {
  const all = board.panels.flatMap((panel) => (panel.kind === "chart" ? [panel.symbol] : panel.kind === "list" ? panel.items.map((item) => item.symbol) : []));
  return [...new Set([BITCOIN, ...all])].sort();
}

// ---------- Saving ----------

const KEY = "appalachian-bitcoin.markets.v1";
const whole = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;

function instrument(raw: unknown): Instrument | null {
  const item = raw as Partial<Instrument> | null;
  if (!item || typeof item.symbol !== "string" || !isSymbol(item.symbol)) return null;
  return { symbol: item.symbol, name: typeof item.name === "string" && item.name.trim() ? item.name.slice(0, 60) : item.symbol };
}

function panelFrom(raw: unknown): Spec | null {
  const item = raw as Record<string, unknown> | null;
  if (!item || typeof item.id !== "string" || !/^p\d{1,6}$/.test(item.id)) return null;
  if (item.kind === "list") {
    if (!Array.isArray(item.items)) return null;
    const items = item.items.map(instrument).filter((entry): entry is Instrument => entry !== null);
    return { id: item.id, kind: "list", items: items.slice(0, MAX_LIST) };
  }
  if (item.kind === "book") return { id: item.id, kind: "book", group: typeof item.group === "number" && item.group > 0 && item.group <= 100000 ? item.group : 1 };
  if (item.kind === "depth") return { id: item.id, kind: "depth", reach: REACHES.includes(item.reach as number) ? (item.reach as number) : 0.01 };
  if (item.kind !== "chart") return null;
  const base = instrument(item);
  if (!base) return null;
  return {
    id: item.id,
    kind: "chart",
    ...base,
    interval: INTERVALS.some((entry) => entry.id === item.interval) ? (item.interval as Interval) : "1h",
    style: STYLES.some((entry) => entry.id === item.style) ? (item.style as Style) : "bars",
    volume: item.volume !== false,
    log: item.log === true,
    averages: Array.isArray(item.averages) ? AVERAGES.filter((period) => (item.averages as unknown[]).includes(period)) : [],
    ...(item.unit === "USD" || item.unit === "BITCOIN" ? { unit: item.unit } : {}),
  };
}

/** A saved board read back safely: anything unreadable is dropped, and an unusable board is null. */
export function boardFrom(raw: unknown): Board | null {
  const saved = raw as Partial<Board> | null;
  if (!saved || !Array.isArray(saved.panels) || !Array.isArray(saved.layout)) return null;
  const panels: Spec[] = [];
  for (const entry of saved.panels) {
    const panel = panelFrom(entry);
    if (panel && panels.length < MAX_PANELS && !panels.some((other) => other.id === panel.id)) panels.push(panel);
  }
  let bottom = 0;
  const layout: Slot[] = [];
  for (const panel of panels) {
    const least = SMALLEST[panel.kind];
    const slot = (saved.layout as unknown[]).find((entry) => (entry as Slot | null)?.i === panel.id) as Slot | undefined;
    const good = slot && whole(slot.x, 0, COLUMNS - 1) && whole(slot.y, 0, 2000) && whole(slot.w, 1, COLUMNS) && whole(slot.h, 1, 60);
    const placed = good
      ? { i: panel.id, x: Math.min(slot.x, COLUMNS - Math.max(slot.w, least.w)), y: slot.y, w: Math.min(COLUMNS, Math.max(slot.w, least.w)), h: Math.max(slot.h, least.h) }
      : { i: panel.id, x: 0, y: bottom, ...START[panel.kind] };
    bottom = Math.max(bottom, placed.y + placed.h);
    layout.push(placed);
  }
  const active = panels.some((panel) => panel.kind === "chart" && panel.id === saved.active) ? (saved.active as string) : (panels.find((panel) => panel.kind === "chart")?.id ?? null);
  return { panels, layout, active };
}

export function loadBoard(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Board {
  try {
    const text = storage?.getItem(KEY);
    return (text && boardFrom(JSON.parse(text))) || defaultBoard();
  } catch {
    return defaultBoard();
  }
}

export function saveBoard(board: Board, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(board));
  } catch {
    /* Private windows can refuse storage; the board then lasts until the page is closed. */
  }
}
