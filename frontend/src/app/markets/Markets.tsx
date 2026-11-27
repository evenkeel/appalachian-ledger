import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactGridLayout, { useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Sheet } from "../dashboard/Sheets";
import { useSession } from "../lib/session";
import { BITCOIN, COLUMNS, MAX_PANELS, PRESETS, ROW, SMALLEST, addPanel, changePanel, chart, defaultBoard, followLens, loadBoard, removePanel, saveBoard, symbolsOn, ticks } from "./board";
import type { Board, BookSpec, ChartSpec, DepthSpec, Instrument, Spec, TicksSpec } from "./board";
import { ChartPanel } from "./ChartPanel";
import { DepthChart } from "./DepthChart";
import { Menu } from "./Menu";
import { OrderBook } from "./OrderBook";
import { useQuotes } from "./feed";
import { LOOKS, loadLook, saveLook } from "./looks";
import type { Look } from "./looks";
import { SymbolPicker } from "./SymbolPicker";
import { TickChart } from "./TickChart";
import { Watchlist } from "./Watchlist";
import "./markets.css";

/** Below this width the panels stack in one column and stop being draggable. */
const STACK_BELOW = 720;

/** Live prices: a board of charts and watchlists you arrange and size yourself. */
export function Markets() {
  const { lens } = useSession();
  const [board, setBoard] = useState<Board>(() => loadBoard());
  const [look, setLook] = useState<Look>(() => loadLook());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();
  useEffect(() => saveBoard(board), [board]);
  // The switch in the top bar moves every chart at once, including any that had been set on its own.
  const followed = useRef(lens);
  useEffect(() => {
    if (followed.current === lens) return;
    followed.current = lens;
    setBoard(followLens);
  }, [lens]);
  const inBitcoin = board.panels.some((panel) => panel.kind === "chart" && panel.symbol !== BITCOIN && (panel.unit ?? lens) === "BITCOIN");
  const { quotes, error } = useQuotes(useMemo(() => symbolsOn(board), [board]));

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      // Escape first closes any open dialog or menu; only a bare Escape leaves the full-screen chart.
      if (event.key === "Escape" && !document.querySelector(".sheet, .mk-pop")) setExpanded(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  const onLayout = useCallback((next: Layout) => {
    setBoard((before) => {
      const layout = next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
      return JSON.stringify(layout) === JSON.stringify(before.layout) ? before : { ...before, layout };
    });
  }, []);

  const activeChart = board.panels.find((panel): panel is ChartSpec => panel.kind === "chart" && panel.id === board.active) ?? null;
  const show = (item: Instrument) =>
    setBoard((before) => {
      const target = before.panels.find((panel) => panel.kind === "chart" && panel.id === before.active);
      return target ? changePanel<ChartSpec>(before, target.id, item) : addPanel(before, (id) => chart(id, item));
    });
  const remove = (id: string) => {
    setExpanded((open) => (open === id ? null : open));
    setBoard((before) => removePanel(before, id));
  };

  const panel = (spec: Spec) =>
    spec.kind === "chart" ? (
      <ChartPanel
        spec={spec}
        quote={quotes[spec.symbol]}
        lens={lens}
        look={look}
        active={board.active === spec.id && board.panels.filter((other) => other.kind === "chart").length > 1}
        expanded={expanded === spec.id}
        onChange={(patch) => setBoard((before) => changePanel<ChartSpec>(before, spec.id, patch))}
        onRemove={() => remove(spec.id)}
        onExpand={() => setExpanded(expanded === spec.id ? null : spec.id)}
        onActivate={() => setBoard((before) => (before.active === spec.id ? before : { ...before, active: spec.id }))}
      />
    ) : spec.kind === "book" ? (
      <OrderBook spec={spec} onChange={(patch) => setBoard((before) => changePanel<BookSpec>(before, spec.id, patch))} onRemove={() => remove(spec.id)} />
    ) : spec.kind === "ticks" ? (
      <TickChart
        spec={spec}
        look={look}
        expanded={expanded === spec.id}
        onChange={(patch) => setBoard((before) => changePanel<TicksSpec>(before, spec.id, patch))}
        onRemove={() => remove(spec.id)}
        onExpand={() => setExpanded(expanded === spec.id ? null : spec.id)}
      />
    ) : spec.kind === "depth" ? (
      <DepthChart spec={spec} onChange={(patch) => setBoard((before) => changePanel<DepthSpec>(before, spec.id, patch))} onRemove={() => remove(spec.id)} />
    ) : (
      <Watchlist
        spec={spec}
        quotes={quotes}
        current={activeChart?.symbol ?? null}
        onPick={show}
        onChange={(items) => setBoard((before) => changePanel(before, spec.id, { items }))}
        onRemove={() => remove(spec.id)}
      />
    );

  const open = board.panels.find((spec) => spec.id === expanded);
  const full = board.panels.length >= MAX_PANELS;
  const stacked = mounted && width < STACK_BELOW;
  const layout = board.layout.map((slot) => {
    const kind = board.panels.find((spec) => spec.id === slot.i)?.kind ?? "chart";
    return { ...slot, minW: SMALLEST[kind].w, minH: SMALLEST[kind].h };
  });
  return (
    <div className="page mk" data-look={look}>
      <div className="mk-top">
        <h1>Markets</h1>
        <span className={`mk-live${error ? " off" : ""}`} role="status" title={error || "Prices are updating"}>
          <i aria-hidden="true" />
          {error ? "Reconnecting…" : "Live"}
        </span>
        <span className="mk-gap" />
        <Menu label="Colors" className="btn" align="right">
          {(close) =>
            LOOKS.map((option) => (
              <button
                key={option.id}
                aria-pressed={look === option.id}
                onClick={() => {
                  close();
                  setLook(option.id);
                  saveLook(option.id);
                }}
              >
                <span className="mk-swatch" aria-hidden="true">
                  {option.swatch.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                {option.name} <small>{option.about}</small>
              </button>
            ))
          }
        </Menu>
        {full ? (
          <button className="btn" disabled title={`The board holds ${MAX_PANELS} panels`}>
            + Add
          </button>
        ) : (
          <Menu label="+ Add" className="btn" align="right">
            {(close) => {
              const add = (make: (id: string) => Spec) => () => {
                close();
                setBoard((before) => addPanel(before, make));
              };
              return (
                <>
                  <button
                    onClick={() => {
                      close();
                      setAdding(true);
                    }}
                  >
                    Chart <small>any symbol</small>
                  </button>
                  <button onClick={add((id) => ({ id, kind: "list", items: PRESETS[0].items.slice(0, 3) }))}>
                    Watchlist <small>several prices</small>
                  </button>
                  <button onClick={add((id) => ({ id, kind: "book", group: 1 }))}>
                    Order book <small>bitcoin, live</small>
                  </button>
                  <button onClick={add((id) => ({ id, kind: "depth", reach: 0.01 }))}>
                    Depth chart <small>bitcoin, live</small>
                  </button>
                  <button onClick={add(ticks)}>
                    Tick chart <small>bitcoin, by trades</small>
                  </button>
                </>
              );
            }}
          </Menu>
        )}
        <button className="btn ghost" onClick={() => setResetting(true)}>
          Reset board
        </button>
      </div>
      {error && (
        <p className="gate-error" role="alert">
          Live prices could not be read: {error}
        </p>
      )}
      <div ref={containerRef} className="mk-board">
        {board.panels.length === 0 ? (
          <section className="inst mk-none">
            <div className="lead">Nothing on the board.</div>
            <div className="sub">Add a chart to follow bitcoin, gold, a stock or an index, or a watchlist to keep several prices in view.</div>
            <div>
              <button className="btn primary" onClick={() => setAdding(true)}>
                Add a chart
              </button>
            </div>
          </section>
        ) : open ? (
          <div className="mk-full">{panel(open)}</div>
        ) : stacked ? (
          <div className="mk-stack">
            {board.panels.map((spec) => (
              <div key={spec.id} className={`mk-cell-${spec.kind}`}>
                {panel(spec)}
              </div>
            ))}
          </div>
        ) : (
          mounted && (
            <ReactGridLayout
              width={width}
              layout={layout}
              gridConfig={{ cols: COLUMNS, rowHeight: ROW, margin: [12, 12], containerPadding: [0, 0] }}
              dragConfig={{ handle: ".mk-grip", cancel: "button, input, label, a" }}
              resizeConfig={{ handles: ["se", "s", "e"] }}
              onLayoutChange={onLayout}
            >
              {board.panels.map((spec) => (
                <div key={spec.id}>{panel(spec)}</div>
              ))}
            </ReactGridLayout>
          )
        )}
      </div>
      {inBitcoin && (
        <p className="hint mk-note">
          Priced in bitcoin: each bar's open is restated at bitcoin's price when that bar opened, and its close at bitcoin's price when it closed. The high and low inside a bar are not known
          in bitcoin, so a bar spans only its open and close. Bitcoin's own chart stays in dollars.
        </p>
      )}
      <p className="hint mk-note">
        {stacked ? "" : "Drag a panel by its top edge to move it and by its bottom-right corner to resize it. The board is saved in this browser. "}
        The $ and ₿ buttons on a chart price that chart alone; the switch in the top bar prices them all. Scrolling over a chart moves the page; to zoom a chart hold Ctrl or ⌘ and
        scroll, pinch, use its − and + buttons, or drag along its dates. 
        Bitcoin prices come from Coinbase trade by trade. Everything else comes from Yahoo Finance, where some exchanges run up to 15 minutes behind. Only ticker symbols leave your
        ledger. Charts drawn with{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™
        </a>
        .
      </p>
      {adding && (
        <SymbolPicker
          title="Add a chart"
          onClose={() => setAdding(false)}
          onPick={(item) => {
            setAdding(false);
            setBoard((before) => addPanel(before, (id) => chart(id, item)));
          }}
        />
      )}
      {resetting && (
        <Sheet label="Reset the board" onClose={() => setResetting(false)}>
          <h2>Reset the board?</h2>
          <p className="sub">Your charts, watchlists and their arrangement go back to the starting set. Nothing in your ledger changes.</p>
          <div className="acts">
            <button
              className="btn primary"
              data-autofocus
              onClick={() => {
                setResetting(false);
                setExpanded(null);
                setBoard(defaultBoard());
              }}
            >
              Reset
            </button>
            <button className="btn" onClick={() => setResetting(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
