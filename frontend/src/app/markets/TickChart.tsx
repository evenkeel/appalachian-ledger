import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { STYLES, TICKS } from "./board";
import type { TicksSpec } from "./board";
import { EXPAND, SHRINK, STYLE_ICON } from "./ChartPanel";
import { price } from "./feed";
import { onTrades, useLive } from "./live";
import type { Trade } from "./live";
import { Menu } from "./Menu";
import { PriceChart } from "./PriceChart";
import { tickBars } from "./series";

/** The most trades held. Older ones are let go a block at a time, a whole number of bars at every size. */
const MOST = 60000;
const BLOCK = 10000;

/** Bitcoin's recent trades from GET /api/market/trades, then every trade from the live stream after them. */
function useTrades() {
  const [held, setHeld] = useState<{ trades: Trade[]; dropped: number }>({ trades: [], dropped: 0 });
  const [error, setError] = useState("");
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    let alive = true;
    let ready = false;
    let early: Trade[] = [];
    const add = (fresh: Trade[]) =>
      setHeld((before) => {
        if (!fresh.length) return before;
        let trades = before.trades.concat(fresh);
        let dropped = before.dropped;
        while (trades.length > MOST) {
          trades = trades.slice(BLOCK);
          dropped += BLOCK;
        }
        return { trades, dropped };
      });
    const stop = onTrades((batch) => {
      if (ready) add(batch);
      else early = early.concat(batch);
    });
    const start = (recent: Trade[]) => {
      if (!alive) return;
      // Trades that came down the stream while the recent ones were read are kept when they are newer.
      const newest = recent[recent.length - 1]?.t ?? -Infinity;
      add([...recent, ...early.filter((trade) => trade.t > newest)]);
      early = [];
      ready = true;
      setSeeded(true);
    };
    api<{ trades: Trade[] }>("/market/trades")
      .then((reply) => {
        setError("");
        start(reply.trades);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
        start([]);
      });
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return { ...held, error, seeded };
}

/** Bitcoin's tick chart: each bar is a set number of trades, so busy minutes get many bars and quiet ones few. */
export function TickChart({
  spec,
  look,
  expanded,
  onChange,
  onRemove,
  onExpand,
}: {
  spec: TicksSpec;
  look: string;
  expanded: boolean;
  onChange: (patch: Partial<TicksSpec>) => void;
  onRemove: () => void;
  onExpand: () => void;
}) {
  const { trades, dropped, error, seeded } = useTrades();
  const live = useLive();
  const first = dropped / spec.ticks;
  const { bars, times } = useMemo(() => tickBars(trades, spec.ticks, first), [trades, spec.ticks, first]);
  const timesRef = useRef(times);
  timesRef.current = times;
  const firstRef = useRef(first);
  firstRef.current = first;
  const clock = useCallback((bar: number) => timesRef.current[bar - firstRef.current], []);
  const last = trades[trades.length - 1];
  const filling = bars.length ? trades.length - (bars.length - 1) * spec.ticks : 0;
  return (
    <section className="inst mk-panel" aria-label={`Bitcoin tick chart, ${spec.ticks} trades a bar`}>
      <div className="mk-head mk-grip">
        <div className="mk-facts">
          <span className="inst-name">Ticks</span>
          <span className="inst-plain">Bitcoin · {live ? "Coinbase, every trade" : seeded ? "reconnecting…" : "Coinbase"}</span>
          {last && <span className="mk-price num">${price(last.p, 2)}</span>}
          {bars.length > 0 && (
            <span className="mk-move num" title="Trades in the newest bar so far">
              {filling} of {spec.ticks} in this bar
            </span>
          )}
        </div>
        <div className="mk-tools">
          <button className="mk-tool" onClick={onExpand} title={expanded ? "Back to the board" : "Fill the screen"} aria-label={expanded ? "Back to the board" : "Fill the screen with the tick chart"}>
            {expanded ? SHRINK : EXPAND}
          </button>
          <button className="mk-tool" onClick={onRemove} title="Remove the tick chart" aria-label="Remove the tick chart">
            ×
          </button>
        </div>
      </div>
      <div className="mk-bar">
        <div className="seg mk-tf" role="group" aria-label="Trades a bar">
          {TICKS.map((count) => (
            <button key={count} aria-pressed={spec.ticks === count} title={`${count.toLocaleString("en-US")} trades a bar`} aria-label={`${count} trades a bar`} onClick={() => onChange({ ticks: count })}>
              {count >= 1000 ? `${count / 1000}K` : count}T
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
        <Menu label="Indicators">
          <label>
            <input type="checkbox" checked={spec.volume} onChange={(event) => onChange({ volume: event.target.checked })} /> Volume
          </label>
          <label>
            <input type="checkbox" checked={spec.rsi} onChange={(event) => onChange({ rsi: event.target.checked })} /> RSI <small>14</small>
          </label>
        </Menu>
        <span className="mk-src" title="Where these trades come from">
          Coinbase · {trades.length.toLocaleString("en-US")} trades held
        </span>
      </div>
      <div className="mk-body">
        {bars.length > 1 ? (
          <PriceChart
            bars={bars}
            dataKey={`ticks|${spec.ticks}`}
            interval="1m"
            clock={clock}
            style={spec.style}
            volume={spec.volume}
            rsi={spec.rsi}
            log={false}
            averages={[]}
            digits={2}
            bitcoin
            fillsScreen={expanded}
            look={look}
          />
        ) : error && !trades.length ? (
          <div className="mk-empty" role="alert">
            <p className="sub">{error}</p>
          </div>
        ) : (
          <div className="mk-empty" aria-busy="true">
            <p className="sub">{seeded ? "Waiting for trades…" : "Reading bitcoin's recent trades…"}</p>
          </div>
        )}
      </div>
    </section>
  );
}
