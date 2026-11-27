import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { btc } from "../lib/format";
import type { Lens } from "../lib/session";
import { AVERAGES, BITCOIN, INTERVALS, STYLES } from "./board";
import type { ChartSpec, Style } from "./board";
import { bitcoinPrice, change, digitsFor, inBitcoin, isYield, price, useCandles } from "./feed";
import type { Quote } from "./feed";
import { useLive } from "./live";
import { Menu } from "./Menu";
import { PriceChart } from "./PriceChart";
import { SymbolPicker } from "./SymbolPicker";

const glyph = (children: ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const STYLE_ICON: Record<Style, ReactNode> = {
  bars: glyph(<path d="M4 3v10M4 5H2M4 10h2M11 2v11M11 4H9M11 11h2" />),
  candles: glyph(
    <>
      <path d="M4.5 1.5v13M11.5 1.5v13" />
      <rect x="3" y="4" width="3" height="6" fill="currentColor" />
      <rect x="10" y="6" width="3" height="6" fill="currentColor" />
    </>,
  ),
};
export const EXPAND = glyph(<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5l4.5-4.5" />);
export const SHRINK = glyph(<path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4" />);

/** Whether the newest price ticked up or down, for a brief flash. The count restarts the flash each tick. */
function useTick(value: number | undefined) {
  const before = useRef<number | undefined>(undefined);
  const [tick, setTick] = useState({ way: "", count: 0 });
  useEffect(() => {
    const was = before.current;
    before.current = value;
    if (value === undefined || was === undefined || value === was) return;
    setTick((last) => ({ way: value > was ? "up" : "down", count: last.count + 1 }));
  }, [value]);
  return tick;
}

/** One live chart with its own symbol, bar size and style. */
export function ChartPanel({
  spec,
  quote,
  lens,
  look,
  active,
  expanded,
  onChange,
  onRemove,
  onExpand,
  onActivate,
}: {
  spec: ChartSpec;
  quote: Quote | undefined;
  lens: Lens;
  /** The Markets colour theme, passed on so the chart redraws when it changes. */
  look: string;
  active: boolean;
  expanded: boolean;
  onChange: (patch: Partial<ChartSpec>) => void;
  onRemove: () => void;
  onExpand: () => void;
  onActivate: () => void;
}) {
  // A chart follows the switch in the top bar until it is set on its own. Bitcoin's own chart stays in dollars.
  const unit = spec.unit ?? lens;
  const asked = unit === "BITCOIN" && spec.symbol !== BITCOIN;
  const feed = useCandles(spec.symbol, spec.interval, asked);
  const [picking, setPicking] = useState(false);
  const streaming = useLive(spec.symbol === BITCOIN);
  const info = feed.info;
  // The server says what it sent: a yield or a price in another currency comes back as it was.
  const priced = info?.unit === "BITCOIN";
  const last = feed.bars.length ? feed.bars[feed.bars.length - 1][4] : undefined;
  // In dollars the chart's newest bar is the freshest figure; the shared quote covers the moment before bars arrive.
  const now = priced ? quote?.price : (last ?? quote?.price);
  const digits = info?.digits ?? (now !== undefined ? digitsFor(now) : 2);
  const dollarDigits = priced ? (now !== undefined ? digitsFor(now) : 2) : digits;
  const moved = change(now, quote?.previous);
  const tick = useTick(priced ? last : now);
  const dollars = !info || info.currency === "USD";
  const suffix = isYield(spec.symbol) ? "%" : dollars ? "" : ` ${info?.currency ?? ""}`;
  const perDollar = lens === "BITCOIN" && spec.symbol === BITCOIN ? inBitcoin(spec.symbol, info?.currency, now, now) : null;
  const size = INTERVALS.find((entry) => entry.id === spec.interval)!;
  return (
    <section className={`inst mk-panel${active ? " mk-active" : ""}`} aria-label={`${spec.name} chart, ${size.long} bars`} onPointerDownCapture={onActivate}>
      <div className="mk-head mk-grip">
        <div className="mk-facts">
        <button className="mk-symbol" onClick={() => setPicking(true)} title="Change what this chart shows">
          <b>{spec.name}</b>
          <small className="num">{spec.symbol}</small>
          <span aria-hidden="true">▾</span>
        </button>
        {priced && last !== undefined && (
          <span key={tick.count} className={`mk-price num btc${tick.way ? ` mk-tick-${tick.way}` : ""}`} title="The newest bar's close, priced in bitcoin">
            {bitcoinPrice(last, digits)}
          </span>
        )}
        {now !== undefined && (
          <span key={priced ? "dollars" : tick.count} className={priced ? "mk-move num" : `mk-price num${tick.way ? ` mk-tick-${tick.way}` : ""}`}>
            {dollars && !suffix ? "$" : ""}
            {price(now, dollarDigits)}
            {suffix}
          </span>
        )}
        {moved && (
          <span className={`mk-move num ${moved.up ? "mk-up" : "mk-down"}`} title={priced ? "The change in dollars" : undefined}>
            {moved.text} <small>{quote?.basis === "24 hours" ? "24 hours" : priced ? "today in dollars" : "today"}</small>
          </span>
        )}
        {perDollar && (
          <span className="mk-move num btc" title="At the live bitcoin price">
            {btc(perDollar)} per $1
          </span>
        )}
        {asked && info && !priced && (
          <span className="tag" title={isYield(spec.symbol) ? "A yield is a rate, not a price, so it is not restated in bitcoin." : `This is quoted in ${info.currency}, not dollars, so it is not restated in bitcoin.`}>
            Not priced in bitcoin
          </span>
        )}
        {info?.session === "closed" && <span className="tag">Market closed</span>}
        {(info?.stale || (feed.error && feed.bars.length > 0)) && (
          <span className="tag miss" title={feed.error || `${info?.source} did not answer the last request. These are the last prices received.`}>
            Not updating
          </span>
        )}
        </div>
        <div className="mk-tools">
        <button className="mk-tool" onClick={onExpand} title={expanded ? "Back to the board" : "Fill the screen"} aria-label={expanded ? "Back to the board" : "Fill the screen with this chart"}>
          {expanded ? SHRINK : EXPAND}
        </button>
        <button className="mk-tool" onClick={onRemove} title="Remove this chart" aria-label={`Remove the ${spec.name} chart`}>
          ×
        </button>
        </div>
      </div>
      <div className="mk-bar">
        <div className="seg mk-tf" role="group" aria-label="Bar size">
          {INTERVALS.map((entry) => (
            <button key={entry.id} aria-pressed={spec.interval === entry.id} title={`${entry.long} bars`} aria-label={`${entry.long} bars`} onClick={() => onChange({ interval: entry.id })}>
              {entry.label}
            </button>
          ))}
        </div>
        <div className="seg mk-style" role="group" aria-label="Chart style">
          {STYLES.map((entry) => (
            <button key={entry.id} aria-pressed={spec.style === entry.id} title={entry.label} aria-label={entry.label} onClick={() => onChange({ style: entry.id })}>
              {STYLE_ICON[entry.id]}
            </button>
          ))}
        </div>
        {spec.symbol !== BITCOIN && (
          <div className="seg mk-unit" role="group" aria-label="Price this chart in">
            <button aria-pressed={unit === "USD"} title="Chart in dollars" aria-label="Chart in dollars" onClick={() => onChange({ unit: "USD" })}>
              $
            </button>
            <button className="b" aria-pressed={unit === "BITCOIN"} title="Chart in bitcoin" aria-label="Chart in bitcoin" onClick={() => onChange({ unit: "BITCOIN" })}>
              ₿
            </button>
          </div>
        )}
        <Menu label="Indicators">
          <label>
            <input type="checkbox" checked={spec.volume} onChange={(event) => onChange({ volume: event.target.checked })} /> Volume
          </label>
          {AVERAGES.map((period) => (
            <label key={period}>
              <input
                type="checkbox"
                checked={spec.averages.includes(period)}
                onChange={(event) => onChange({ averages: AVERAGES.filter((other) => (other === period ? event.target.checked : spec.averages.includes(other))) })}
              />{" "}
              {period}-bar moving average
            </label>
          ))}
          <label>
            <input type="checkbox" checked={spec.bands} onChange={(event) => onChange({ bands: event.target.checked })} /> Bollinger bands <small>20, 2</small>
          </label>
          <label>
            <input type="checkbox" checked={spec.rsi} onChange={(event) => onChange({ rsi: event.target.checked })} /> RSI <small>14</small>
          </label>
          <label>
            <input type="checkbox" checked={spec.macd} onChange={(event) => onChange({ macd: event.target.checked })} /> MACD <small>12, 26, 9</small>
          </label>
          <label>
            <input type="checkbox" checked={spec.log} onChange={(event) => onChange({ log: event.target.checked })} /> Log scale
          </label>
        </Menu>
        {info && (
          <span className="mk-src" title="Where these prices come from">
            {info.source}
            {info.exchange && info.exchange !== info.source ? ` · ${info.exchange}` : ""}
            {streaming ? " · every trade" : ""}
          </span>
        )}
      </div>
      <div className="mk-body">
        {feed.bars.length > 0 ? (
          <PriceChart bars={feed.bars} dataKey={feed.key} interval={spec.interval} style={spec.style} volume={spec.volume} log={spec.log} averages={spec.averages} bands={spec.bands} rsi={spec.rsi} macd={spec.macd} digits={digits} bitcoin={spec.symbol === BITCOIN} inBitcoin={priced} fillsScreen={expanded} look={look} />
        ) : feed.error ? (
          <div className="mk-empty" role="alert">
            <p className="sub">{feed.error}</p>
            <button className="btn sm" onClick={() => setPicking(true)}>
              Choose another symbol
            </button>
          </div>
        ) : (
          <div className="mk-empty" aria-busy="true">
            <p className="sub">Loading {spec.name} prices…</p>
          </div>
        )}
      </div>
      {picking && (
        <SymbolPicker
          title="Chart a symbol"
          onClose={() => setPicking(false)}
          onPick={(item) => {
            setPicking(false);
            onChange(item);
          }}
        />
      )}
    </section>
  );
}
