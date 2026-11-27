import { useState } from "react";
import { useSize } from "../lib/useSize";
import { REACHES } from "./board";
import type { DepthSpec } from "./board";
import { depth, useBook } from "./book";
import type { Reach } from "./book";
import { compact, price } from "./feed";

const PAD = { left: 10, right: 54, top: 12, bottom: 22 };
const percent = (share: number) => `±${+(share * 100).toFixed(2)}%`;

/** Bitcoin's live depth chart: the order book added up outward from the price, buyers left, sellers right. */
export function DepthChart({ spec, onChange, onRemove }: { spec: DepthSpec; onChange: (patch: Partial<DepthSpec>) => void; onRemove: () => void }) {
  const { book, live } = useBook();
  const [ref, size] = useSize<HTMLDivElement>();
  const [pointer, setPointer] = useState<number | null>(null);
  const data = book ? depth(book, spec.reach) : null;
  const wide = Math.max(0, size.width - PAD.left - PAD.right),
    tall = Math.max(0, size.height - PAD.top - PAD.bottom);
  const bought = data?.bids[data.bids.length - 1]?.total ?? 0,
    sold = data?.asks[data.asks.length - 1]?.total ?? 0;
  const ceiling = Math.max(bought, sold) * 1.08 || 1;
  const x = (dollars: number) => (data ? PAD.left + ((dollars - data.low) / (data.high - data.low)) * wide : 0);
  const y = (total: number) => PAD.top + tall - (total / ceiling) * tall;
  const floor = PAD.top + tall;

  // Each side is a staircase: flat across a price group, stepping up where the next group's orders begin.
  const stairs = (from: number, levels: Reach[], edge: number) => {
    let path = `M${x(from).toFixed(1)},${floor}`;
    for (const level of levels) path += `V${y(level.total).toFixed(1)}H${x(level.price).toFixed(1)}`;
    path += `H${x(edge).toFixed(1)}`;
    return { line: path, area: `${path}V${floor}Z` };
  };
  const buys = book && data ? stairs(book.bid, data.bids, data.low) : null;
  const sells = book && data ? stairs(book.ask, data.asks, data.high) : null;

  // What sits between the pointer and the price: everything a trade would pass through to get there.
  let reading: { side: "buy" | "sell"; at: number; reach: Reach } | null = null;
  if (book && data && pointer !== null && wide > 0) {
    const at = data.low + ((pointer - PAD.left) / wide) * (data.high - data.low);
    if (at <= book.bid) {
      const found = [...data.bids].reverse().find((level) => level.price >= at) ?? data.bids[data.bids.length - 1];
      if (found) reading = { side: "buy", at, reach: found };
    } else if (at >= book.ask) {
      const found = [...data.asks].reverse().find((level) => level.price <= at) ?? data.asks[data.asks.length - 1];
      if (found) reading = { side: "sell", at, reach: found };
    }
  }
  const ticks = data ? [data.low, (data.low + data.middle) / 2, data.middle, (data.middle + data.high) / 2, data.high] : [];
  return (
    <section className="inst mk-panel" aria-label="Bitcoin depth chart">
      <div className="mk-head mk-grip">
        <div className="mk-facts">
          <span className="inst-name">Depth</span>
          <span className="inst-plain">Bitcoin · {book && !live ? "reconnecting…" : "Coinbase, live"}</span>
          {data && (
            <span className="mk-move num" title={`Bitcoin waiting to be bought and sold within ${percent(spec.reach)} of the price`}>
              <span className="mk-up">{compact(bought)} BTC bid</span> · <span className="mk-down">{compact(sold)} BTC offered</span>
            </span>
          )}
        </div>
        <div className="mk-tools">
          <button className="mk-tool" onClick={onRemove} title="Remove the depth chart" aria-label="Remove the depth chart">
            ×
          </button>
        </div>
      </div>
      <div className="mk-bar">
        <label className="mk-label" htmlFor={`${spec.id}-reach`}>
          Reach
        </label>
        <select id={`${spec.id}-reach`} className="mk-select num" value={spec.reach} onChange={(event) => onChange({ reach: Number(event.target.value) })} title="How far either side of the price">
          {REACHES.map((reach) => (
            <option key={reach} value={reach}>
              {percent(reach)}
            </option>
          ))}
        </select>
      </div>
      <div ref={ref} className="mk-depth">
        {book && data && buys && sells && wide > 0 && tall > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`Within ${percent(spec.reach)} of $${price(data.middle, 0)}: ${compact(bought)} BTC of buy orders and ${compact(sold)} BTC of sell orders`}
            onPointerMove={(event) => setPointer(event.clientX - event.currentTarget.getBoundingClientRect().left)}
            onPointerLeave={() => setPointer(null)}
          >
            {[0.5, 1].map((share) => (
              <g key={share}>
                <line className="mk-depth-grid" x1={PAD.left} x2={PAD.left + wide} y1={y((ceiling / 1.08) * share)} y2={y((ceiling / 1.08) * share)} />
                <text className="mk-depth-tick" x={PAD.left + wide + 6} y={y((ceiling / 1.08) * share) + 3}>
                  {compact((ceiling / 1.08) * share)}
                </text>
              </g>
            ))}
            <path className="mk-depth-area bids" d={buys.area} />
            <path className="mk-depth-area asks" d={sells.area} />
            <path className="mk-depth-line bids" d={buys.line} />
            <path className="mk-depth-line asks" d={sells.line} />
            <line className="mk-depth-axis" x1={PAD.left} x2={PAD.left + wide} y1={floor} y2={floor} />
            <line className="mk-depth-mid" x1={x(data.middle)} x2={x(data.middle)} y1={PAD.top} y2={floor} />
            {ticks.map((tick, at) => (
              <text key={at} className="mk-depth-tick" x={x(tick)} y={floor + 15} textAnchor={at === 0 ? "start" : at === ticks.length - 1 ? "end" : "middle"}>
                {price(tick, 0)}
              </text>
            ))}
            <text className="mk-depth-tick" x={PAD.left + wide + 6} y={PAD.top + 4}>
              BTC
            </text>
            {reading && pointer !== null && (
              <>
                <line className="mk-depth-cross" x1={pointer} x2={pointer} y1={PAD.top} y2={floor} />
                <circle className={`mk-depth-dot ${reading.side === "buy" ? "bids" : "asks"}`} cx={pointer} cy={y(reading.reach.total)} r={3.5} />
              </>
            )}
          </svg>
        ) : (
          <div className="mk-empty" aria-busy="true">
            <p className="sub">{book ? "" : live ? "Reading the order book…" : "Connecting to Coinbase…"}</p>
          </div>
        )}
        {reading && (
          <div className={`mk-depth-read num ${reading.side === "buy" ? "left" : "right"}`} role="status">
            <b className={reading.side === "buy" ? "mk-up" : "mk-down"}>
              {compact(reading.reach.total)} BTC · ${compact(reading.reach.dollars)}
            </b>
            <span>
              {reading.side === "buy" ? "waiting to buy at" : "offered for sale at"} ${price(reading.at, 0)} or {reading.side === "buy" ? "higher" : "lower"}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
