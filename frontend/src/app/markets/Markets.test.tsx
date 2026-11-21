import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BITCOIN, MAX_PANELS, addPanel, boardFrom, chart, defaultBoard, followLens, loadBoard, removePanel, saveBoard, symbolsOn } from "./board";
import type { Board } from "./board";
import { change, compact, inBitcoin, mergeBars } from "./feed";
import type { Bar, Quote } from "./feed";
import { applyTrades, barStart, resetLive } from "./live";
import { movingAverage, rowsFrom } from "./series";

const calls: string[] = [];
let failing = "";
let lens: "USD" | "BITCOIN" = "USD";
const setLens = vi.fn();
const bars: Bar[] = [
  [1794787200, 60000, 60100, 59900, 60050, 12],
  [1794788100, 60050, 60300, 60000, 60250, 9],
];
const quotes: Quote[] = [
  { symbol: BITCOIN, name: "Bitcoin", price: 60000, previous: 58000, basis: "24 hours", session: "open", source: "Coinbase", spark: [58000, 59000, 60000] },
  { symbol: "GC=F", name: "Gold Dec 26", price: 3515.4, previous: 3685.5, basis: "previous close", session: "closed", source: "Yahoo Finance", spark: [3600, 3515.4] },
  { symbol: "^TNX", error: "No price found for ^TNX." },
];
vi.mock("../../lib/api", () => ({
  setCsrf: () => {},
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (failing && path.includes(failing)) throw new Error("No prices found for NOPE. Check the symbol.");
    if (path.startsWith("/market/quotes")) return { quotes };
    if (path.startsWith("/market/search")) return { results: [{ symbol: "AAPL", name: "Apple Inc.", kind: "Equity", exchange: "NASDAQ" }] };
    if (path.startsWith("/market/candles")) {
      const query = new URLSearchParams(path.split("?")[1]);
      const gold = query.get("symbol") === "GC=F";
      // The server restates dollar prices only; bitcoin itself and yields come back as they are.
      const restated = query.get("unit") === "bitcoin" && gold;
      if (restated)
        return {
          symbol: "GC=F",
          name: "Gold Dec 26",
          digits: 0,
          unit: "BITCOIN",
          currency: "USD",
          kind: "future",
          exchange: "COMEX",
          source: "Yahoo Finance, priced with Coinbase",
          session: "closed",
          stale: false,
          interval: query.get("interval"),
          full: true,
          candles: [[1794787200, 5850000, 5900000, 5850000, 5900000, 7]],
        };
      return {
        symbol: query.get("symbol"),
        name: gold ? "Gold Dec 26" : "Bitcoin",
        digits: 2,
        unit: "USD",
        currency: "USD",
        kind: gold ? "future" : "bitcoin",
        exchange: gold ? "COMEX" : "Coinbase",
        source: gold ? "Yahoo Finance" : "Coinbase",
        session: gold ? "closed" : "open",
        stale: false,
        interval: query.get("interval"),
        full: !query.has("after"),
        candles: query.has("after") ? bars.slice(-1) : bars,
      };
    }
    return {};
  }),
}));
vi.mock("../lib/session", () => ({ useSession: () => ({ lens, setLens }) }));
// jsdom has no canvas and no layout: the chart and the grid are stood in for by plain elements.
vi.mock("./PriceChart", () => ({
  PriceChart: (props: { dataKey: string; style: string; bars: Bar[]; averages: number[]; volume: boolean; inBitcoin?: boolean }) => (
    <div
      data-testid="chart"
      data-key={props.dataKey}
      data-style={props.style}
      data-bars={props.bars.length}
      data-averages={props.averages.join(",")}
      data-volume={String(props.volume)}
      data-bitcoin={String(Boolean(props.inBitcoin))}
    />
  ),
}));
vi.mock("react-grid-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="grid">{children}</div>,
  useContainerWidth: () => ({ width: 1280, mounted: true, containerRef: { current: null } }),
}));

import { Markets } from "./Markets";

const saved = () => JSON.parse(localStorage.getItem("appalachian-bitcoin.markets.v1")!) as Board;
beforeEach(() => {
  calls.length = 0;
  failing = "";
  lens = "USD";
  setLens.mockClear();
  localStorage.clear();
  resetLive();
});
afterEach(() => vi.unstubAllGlobals());

/** Stands in for the browser's event stream so a test can hand trades to the screen. */
class FakeStream {
  static opened: FakeStream[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  closed = false;
  constructor(public url: string) {
    FakeStream.opened.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  trade(p: number, s: number, seconds: number) {
    this.onmessage?.({ data: JSON.stringify({ p, s, t: seconds * 1000 }) });
  }
}

describe("the board", () => {
  it("starts with bitcoin, a watchlist, gold and the S&P 500, all as bar charts", () => {
    const board = defaultBoard();
    expect(board.panels.map((panel) => (panel.kind === "chart" ? `${panel.symbol} ${panel.style} ${panel.interval}` : `list of ${panel.items.length}`))).toEqual([
      "BTC-USD bars 15m",
      "list of 9",
      "GC=F bars 1d",
      "^GSPC bars 1d",
    ]);
    expect(symbolsOn(board)).toContain(BITCOIN);
    expect(new Set(symbolsOn(board)).size).toBe(symbolsOn(board).length);
  });

  it("adds a panel below the rest, stops at the limit, and passes the selection on when a chart is removed", () => {
    let board = addPanel(defaultBoard(), (id) => chart(id, { symbol: "AAPL", name: "Apple" }));
    expect(board.layout[4]).toMatchObject({ i: "p5", x: 0, y: 23 });
    expect(board.active).toBe("p5");
    board = removePanel(board, "p5");
    expect(board.active).toBe("p1");
    expect(board.layout.map((slot) => slot.i)).toEqual(["p1", "p2", "p3", "p4"]);
    for (let n = 0; n < 20; n++) board = addPanel(board, (id) => chart(id, { symbol: "AAPL", name: "Apple" }));
    expect(board.panels).toHaveLength(MAX_PANELS);
  });

  it("reads a saved board back safely and falls back to the starting board", () => {
    const board = defaultBoard();
    saveBoard(board);
    expect(loadBoard()).toEqual(board);
    const damaged = boardFrom({
      panels: [
        { id: "p1", kind: "chart", symbol: "AAPL", name: "", interval: "2m", style: "pie", averages: [20, 7], unit: "EUR" },
        { id: "p1", kind: "chart", symbol: "MSFT", name: "Duplicate id" },
        { id: "p2", kind: "chart", symbol: "../../etc", name: "Bad symbol" },
        { id: "p3", kind: "list", items: [{ symbol: "GC=F", name: "Gold" }, { symbol: "<script>" }, null] },
        "nonsense",
      ],
      layout: [{ i: "p1", x: 11, y: 0, w: 1, h: 2 }, { i: "p3", x: "left" }],
      active: "p3",
    })!;
    expect(damaged.panels).toEqual([
      { id: "p1", kind: "chart", symbol: "AAPL", name: "AAPL", interval: "1h", style: "bars", volume: true, log: false, averages: [20] },
      { id: "p3", kind: "list", items: [{ symbol: "GC=F", name: "Gold" }] },
    ]);
    // Too small a slot is grown to the smallest usable size and kept on the board; a broken one is placed below.
    expect(damaged.layout).toEqual([
      { i: "p1", x: 9, y: 0, w: 3, h: 7 },
      { i: "p3", x: 0, y: 7, w: 3, h: 11 },
    ]);
    expect(damaged.active).toBe("p1");
    localStorage.setItem("appalachian-bitcoin.markets.v1", "{not json");
    expect(loadBoard()).toEqual(defaultBoard());
    expect(boardFrom({ panels: "x" })).toBeNull();
    // A chart set on its own keeps that choice across a reload.
    const pinned = { ...board, panels: board.panels.map((panel) => (panel.id === "p3" ? { ...panel, unit: "BITCOIN" as const } : panel)) };
    expect(boardFrom(JSON.parse(JSON.stringify(pinned)))).toEqual(pinned);
    expect(followLens(pinned)).toEqual(board);
    expect(followLens(board)).toBe(board);
  });
});

describe("price figures", () => {
  it("lays newer bars over the bar in progress", () => {
    const fresh: Bar[] = [
      [1794788100, 60050, 60400, 60000, 60390, 11],
      [1794789000, 60390, 60395, 60380, 60385, 1],
    ];
    expect(mergeBars(bars, fresh).map((bar) => [bar[0], bar[4]])).toEqual([
      [1794787200, 60050],
      [1794788100, 60390],
      [1794789000, 60385],
    ]);
    expect(mergeBars(bars, [])).toBe(bars);
  });

  it("states a change against the earlier price and says nothing without one", () => {
    expect(change(60000, 58000)).toMatchObject({ up: true, text: "▲ 3.45%" });
    expect(change(3515.4, 3685.5)).toMatchObject({ up: false, text: "▼ 4.62%" });
    expect(change(100, null)).toBeNull();
    expect(change(undefined, 5)).toBeNull();
    expect(compact(626370000)).toBe("626.37M");
    expect(compact(7.7)).toBe("7.70");
  });

  it("restates dollar prices in whole bitcoin, and never a yield or another currency", () => {
    expect(inBitcoin("GC=F", "USD", 3515.4, 60000)).toBe("5859000");
    expect(inBitcoin(BITCOIN, "USD", 60000, 60000)).toBe("1667");
    expect(inBitcoin("^TNX", "USD", 4.9, 60000)).toBeNull();
    expect(inBitcoin("^N225", "JPY", 50000, 60000)).toBeNull();
    expect(inBitcoin("GC=F", "USD", 3515.4, undefined)).toBeNull();
  });

  it("folds trades into the newest bar and opens the next bar when its time comes", () => {
    // 15-minute bars: the newest runs from 1794788100 to 1794789000.
    const during = applyTrades(
      bars,
      [
        { p: 60400, s: 0.5, t: 1794788200_000 },
        { p: 59950, s: 0.25, t: 1794788300_500 },
        { p: 60100, s: 0, t: 1794788999_999 },
      ],
      "15m",
    );
    expect(during).toHaveLength(2);
    expect(during[1]).toEqual([1794788100, 60050, 60400, 59950, 60100, 9.75]);
    // The bars handed in are not changed, and untouched bars are the very same ones.
    expect(bars[1]).toEqual([1794788100, 60050, 60300, 60000, 60250, 9]);
    expect(during[0]).toBe(bars[0]);

    const next = applyTrades(during, [{ p: 60120, s: 0.1, t: 1794789000_000 }, { p: 60130, s: 0.2, t: 1794789001_000 }], "15m");
    expect(next[2]).toEqual([1794789000, 60120, 60130, 60120, 60130, 0.30000000000000004]);
    // A trade older than the newest bar is already in the server's bars; nothing changes.
    expect(applyTrades(bars, [{ p: 1, s: 1, t: 1794787000_000 }], "15m")).toBe(bars);
    expect(applyTrades([], [{ p: 1, s: 1, t: 1 }], "15m")).toEqual([]);
    // Bars are cut on UTC boundaries, and a week starts on Monday (16 November 2026).
    expect(barStart(1794788999, "15m")).toBe(1794788100);
    expect(barStart(1794787200 + 5 * 86400 + 7, "1w")).toBe(1794787200);
    expect(barStart(1794787200 - 1, "1w")).toBe(1794787200 - 7 * 86400);
    expect(barStart(1794787200 + 3 * 3600, "4h")).toBe(1794787200);
  });

  it("averages the last closes and waits until there are enough", () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(movingAverage([1, 2], 3)).toEqual([null, null]);
  });

  it("keeps daily bars on their date and bars within a day in rising local time", () => {
    expect(rowsFrom(bars, "1d").map((row) => row.time)).toEqual([1794787200, 1794788100]);
    const shifted = rowsFrom(bars, "15m");
    expect(shifted[0].time).toBe(1794787200 - new Date(1794787200000).getTimezoneOffset() * 60);
    // A repeated or earlier time is dropped rather than handed to the chart out of order.
    expect(rowsFrom([bars[1], bars[0], bars[1]], "1d").map((row) => row.time)).toEqual([1794788100]);
  });
});

describe("markets screen", () => {
  it("shows live bar charts and a watchlist from the first visit", async () => {
    render(<Markets />);
    const bitcoin = await screen.findByLabelText("Bitcoin chart, 15 minutes bars");
    await waitFor(() => expect(within(bitcoin).getByTestId("chart")).toHaveAttribute("data-bars", "2"));
    expect(within(bitcoin).getByTestId("chart")).toHaveAttribute("data-style", "bars");
    expect(within(bitcoin).getByText("$60,250.00")).toBeInTheDocument();
    expect(within(bitcoin).getByText(/▲ 3\.88%/)).toBeInTheDocument();
    expect(within(bitcoin).getByRole("button", { name: "15 minutes bars" })).toHaveAttribute("aria-pressed", "true");
    expect(calls).toContain("/market/candles?symbol=BTC-USD&interval=15m");
    expect(calls).toContain("/market/candles?symbol=GC%3DF&interval=1d");

    const list = screen.getByLabelText("Watchlist");
    const gold = await within(list).findByRole("button", { name: /^Gold/ });
    expect(gold).toHaveTextContent("3,515.40");
    expect(gold).toHaveTextContent("▼ 4.62%");
    // A symbol the provider has no price for says so instead of showing a figure.
    expect(within(list).getByRole("button", { name: /^10-year Treasury yield/ })).toHaveTextContent("No price");
    expect(within(await screen.findByLabelText("Gold chart, 1 day bars")).getByText("Market closed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live");
    expect(screen.getByRole("link", { name: /TradingView/ })).toHaveAttribute("href", "https://www.tradingview.com/");
    expect(document.body.textContent).not.toMatch(/\bsats?\b|satoshi/i);
  });

  it("changes bar size and style with one click and remembers them", async () => {
    render(<Markets />);
    const bitcoin = await screen.findByLabelText("Bitcoin chart, 15 minutes bars");
    fireEvent.click(within(bitcoin).getByRole("button", { name: "4 hours bars" }));
    const four = await screen.findByLabelText("Bitcoin chart, 4 hours bars");
    await waitFor(() => expect(calls).toContain("/market/candles?symbol=BTC-USD&interval=4h"));
    await waitFor(() => expect(within(four).getByTestId("chart")).toHaveAttribute("data-key", "BTC-USD|4h"));
    fireEvent.click(within(four).getByRole("button", { name: "Candles" }));
    expect(within(four).getByTestId("chart")).toHaveAttribute("data-style", "candles");
    fireEvent.click(within(four).getByRole("button", { name: /Indicators/ }));
    fireEvent.click(within(four).getByLabelText("50-bar moving average"));
    fireEvent.click(within(four).getByLabelText("Volume"));
    expect(within(four).getByTestId("chart")).toHaveAttribute("data-averages", "50");
    expect(within(four).getByTestId("chart")).toHaveAttribute("data-volume", "false");
    await waitFor(() => expect(saved().panels[0]).toMatchObject({ interval: "4h", style: "candles", averages: [50], volume: false }));
  });

  it("loads a watchlist row into the selected chart", async () => {
    render(<Markets />);
    const sp = await screen.findByLabelText("S&P 500 chart, 1 day bars");
    fireEvent.pointerDown(sp);
    fireEvent.click(await within(screen.getByLabelText("Watchlist")).findByRole("button", { name: /^Silver/ }));
    expect(await screen.findByLabelText("Silver chart, 1 day bars")).toBeInTheDocument();
    expect(screen.queryByLabelText("S&P 500 chart, 1 day bars")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Bitcoin chart, 15 minutes bars")).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain("/market/candles?symbol=SI%3DF&interval=1d"));
  });

  it("finds a symbol by name and adds it as a new chart, and removes panels", async () => {
    render(<Markets />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Chart" }));
    const dialog = screen.getByRole("dialog", { name: "Add a chart" });
    expect(within(dialog).getByRole("button", { name: /^Gold/ })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name or ticker"), { target: { value: "apple" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: /^Apple Inc\./ }));
    expect(await screen.findByLabelText("Apple Inc. chart, 1 hour bars")).toBeInTheDocument();
    expect(calls).toContain("/market/search?q=apple");
    await waitFor(() => expect(saved().panels).toHaveLength(5));

    fireEvent.click(screen.getByRole("button", { name: "Remove the Apple Inc. chart" }));
    expect(screen.queryByLabelText("Apple Inc. chart, 1 hour bars")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Gold from this watchlist" }));
    expect(within(screen.getByLabelText("Watchlist")).queryByRole("button", { name: /^Gold/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset board" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Reset the board" })).getByRole("button", { name: "Reset" }));
    expect(await within(screen.getByLabelText("Watchlist")).findByRole("button", { name: /^Gold/ })).toBeInTheDocument();
    await waitFor(() => expect(saved()).toEqual(defaultBoard()));
  });

  it("fills the screen with one chart and comes back", async () => {
    render(<Markets />);
    await screen.findByLabelText("Gold chart, 1 day bars");
    fireEvent.click(screen.getAllByRole("button", { name: "Fill the screen with this chart" })[0]);
    expect(screen.getByLabelText("Bitcoin chart, 15 minutes bars")).toBeInTheDocument();
    expect(screen.queryByLabelText("Gold chart, 1 day bars")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByLabelText("Gold chart, 1 day bars")).toBeInTheDocument();
  });

  it("prices one chart in bitcoin on its own, leaving the others in dollars", async () => {
    render(<Markets />);
    const gold = await screen.findByLabelText("Gold chart, 1 day bars");
    await waitFor(() => expect(within(gold).getByTestId("chart")).toHaveAttribute("data-bitcoin", "false"));
    expect(within(gold).getByRole("button", { name: "Chart in dollars" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Price in bitcoin/ })).not.toBeInTheDocument();
    fireEvent.click(within(gold).getByRole("button", { name: "Chart in bitcoin" }));
    await waitFor(() => expect(within(gold).getByTestId("chart")).toHaveAttribute("data-bitcoin", "true"));
    expect(within(gold).getByRole("button", { name: "Chart in bitcoin" })).toHaveAttribute("aria-pressed", "true");
    // The bitcoin figure leads; the dollar price and its change stay beside it, labelled.
    expect(within(gold).getByText("₿5,900,000")).toBeInTheDocument();
    expect(within(gold).getByText("$3,515.40")).toBeInTheDocument();
    expect(within(gold).getByText("today in dollars")).toBeInTheDocument();
    expect(screen.getByText(/each bar's open is restated at bitcoin's price when that bar opened/)).toBeInTheDocument();
    // Only that chart was asked for in bitcoin, the top-bar switch was left alone, and the choice is saved.
    expect(calls).toContain("/market/candles?symbol=GC%3DF&interval=1d&unit=bitcoin");
    expect(calls.filter((path) => path.includes("unit=bitcoin")).every((path) => path.includes("GC%3DF"))).toBe(true);
    expect(setLens).not.toHaveBeenCalled();
    await waitFor(() => expect(saved().panels[2]).toMatchObject({ symbol: "GC=F", unit: "BITCOIN" }));

    fireEvent.click(within(gold).getByRole("button", { name: "Chart in dollars" }));
    await waitFor(() => expect(within(gold).getByTestId("chart")).toHaveAttribute("data-bitcoin", "false"));
    // Bitcoin's own chart has no such choice: it is always in dollars.
    expect(within(screen.getByLabelText("Bitcoin chart, 15 minutes bars")).queryByRole("button", { name: "Chart in bitcoin" })).not.toBeInTheDocument();
  });

  it("follows the switch in the top bar on every chart, over any chart set on its own", async () => {
    const view = render(<Markets />);
    const gold = await screen.findByLabelText("Gold chart, 1 day bars");
    await waitFor(() => expect(within(gold).getByTestId("chart")).toHaveAttribute("data-bars", "2"));
    // Gold is pinned to dollars, then the top bar is switched to bitcoin.
    fireEvent.click(within(gold).getByRole("button", { name: "Chart in dollars" }));
    await waitFor(() => expect(saved().panels[2]).toMatchObject({ unit: "USD" }));
    lens = "BITCOIN";
    view.rerender(<Markets />);
    await waitFor(() => expect(within(gold).getByTestId("chart")).toHaveAttribute("data-bitcoin", "true"));
    expect(calls).toContain("/market/candles?symbol=%5EGSPC&interval=1d&unit=bitcoin");
    await waitFor(() => expect(saved().panels.some((panel) => "unit" in panel)).toBe(false));

    // Bitcoin's own chart stays in dollars and is never asked for in bitcoin.
    const bitcoin = screen.getByLabelText("Bitcoin chart, 15 minutes bars");
    expect(within(bitcoin).getByTestId("chart")).toHaveAttribute("data-bitcoin", "false");
    expect(within(bitcoin).getByText("$60,250.00")).toBeInTheDocument();
    expect(await within(bitcoin).findByText("₿1,660 per $1")).toBeInTheDocument();
    expect(calls.some((path) => path.includes("symbol=BTC-USD") && path.includes("unit=bitcoin"))).toBe(false);

    // With the top bar on bitcoin, one chart can still be put back in dollars.
    fireEvent.click(within(gold).getByRole("button", { name: "Chart in dollars" }));
    await waitFor(() => expect(within(gold).getByTestId("chart")).toHaveAttribute("data-bitcoin", "false"));
    expect(within(screen.getByLabelText("S&P 500 chart, 1 day bars")).getByRole("button", { name: "Chart in bitcoin" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when a chart cannot be priced in bitcoin", async () => {
    lens = "BITCOIN";
    render(<Markets />);
    // The stand-in server restates only gold, as the real one leaves yields and other currencies alone.
    const sp = await screen.findByLabelText("S&P 500 chart, 1 day bars");
    expect(await within(sp).findByText("Not priced in bitcoin")).toBeInTheDocument();
    expect(within(sp).getByTestId("chart")).toHaveAttribute("data-bitcoin", "false");
  });

  it("moves bitcoin's chart, price and watchlist row with every trade", async () => {
    FakeStream.opened = [];
    vi.stubGlobal("EventSource", FakeStream);
    const view = render(<Markets />);
    const bitcoin = await screen.findByLabelText("Bitcoin chart, 15 minutes bars");
    await waitFor(() => expect(within(bitcoin).getByTestId("chart")).toHaveAttribute("data-bars", "2"));
    // One stream serves the whole screen.
    expect(FakeStream.opened.map((stream) => stream.url)).toEqual(["/api/market/stream"]);
    const stream = FakeStream.opened[0];
    expect(within(bitcoin).queryByText(/every trade/)).not.toBeInTheDocument();

    stream.trade(60300, 0.5, 1794788100 + 60);
    // The price is redrawn on each tick, so it is looked up afresh rather than held on to.
    await waitFor(() => expect(within(bitcoin).getByText("$60,300.00")).toBeInTheDocument());
    expect(within(bitcoin).getByText(/Coinbase · every trade/)).toBeInTheDocument();
    expect(within(bitcoin).getByText(/▲ 3\.97%/)).toBeInTheDocument();
    expect(within(bitcoin).getByTestId("chart")).toHaveAttribute("data-bars", "2");
    const row = within(screen.getByLabelText("Watchlist")).getByRole("button", { name: /^Bitcoin/ });
    expect(row).toHaveTextContent("60,300.00");

    // A trade in the next quarter-hour opens the next bar.
    stream.trade(60310, 0.1, 1794788100 + 900);
    await waitFor(() => expect(within(bitcoin).getByTestId("chart")).toHaveAttribute("data-bars", "3"));
    await waitFor(() => expect(within(bitcoin).getByText("$60,310.00")).toBeInTheDocument());
    // Gold is not streamed and is untouched.
    expect(within(screen.getByLabelText("Gold chart, 1 day bars")).getByTestId("chart")).toHaveAttribute("data-bars", "2");
    expect(within(screen.getByLabelText("Gold chart, 1 day bars")).queryByText(/every trade/)).not.toBeInTheDocument();

    view.unmount();
    expect(stream.closed).toBe(true);
  });

  it("says so when a symbol has no prices instead of drawing an empty chart", async () => {
    failing = "symbol=GC%3DF";
    render(<Markets />);
    const gold = await screen.findByLabelText("Gold chart, 1 day bars");
    expect(await within(gold).findByRole("alert")).toHaveTextContent("No prices found for NOPE. Check the symbol.");
    expect(within(gold).queryByTestId("chart")).not.toBeInTheDocument();
    expect(within(gold).getByRole("button", { name: "Choose another symbol" })).toBeInTheDocument();
  });
});
