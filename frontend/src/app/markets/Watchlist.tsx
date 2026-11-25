import { useState } from "react";
import { BITCOIN, MAX_LIST } from "./board";
import type { Instrument, ListSpec } from "./board";
import { change, digitsFor, price } from "./feed";
import type { Quote } from "./feed";
import { useLivePrice } from "./live";
import { SymbolPicker } from "./SymbolPicker";

/** Today's closes as a small line, scaled to its own high and low. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="mk-spark" />;
  const low = Math.min(...values),
    span = Math.max(...values) - low || 1;
  const points = values.map((value, at) => `${((at / (values.length - 1)) * 100).toFixed(2)},${(25 - ((value - low) / span) * 22).toFixed(2)}`).join(" ");
  return (
    <svg className="mk-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A row's price and change. Bitcoin's moves with every trade while the stream is live. */
function Figure({ quote, live }: { quote: Quote | undefined; live: boolean }) {
  const now = useLivePrice(live) ?? quote?.price;
  const moved = change(now, quote?.previous);
  const tone = moved ? (moved.up ? "mk-up" : "mk-down") : "";
  return (
    <span className="mk-fig num">
      {now !== undefined ? <b>{price(now, digitsFor(now))}</b> : <b className="dim">{quote?.error ? "No price" : "…"}</b>}
      <small className={tone} title={moved && quote?.basis ? `Change over the ${quote.basis === "24 hours" ? "last 24 hours" : "day, since the previous close"}` : undefined}>
        {moved ? moved.text : quote?.session === "closed" ? "closed" : " "}
      </small>
    </span>
  );
}

/** Prices to keep an eye on. Clicking one loads it into the selected chart. */
export function Watchlist({
  spec,
  quotes,
  current,
  onPick,
  onChange,
  onRemove,
}: {
  spec: ListSpec;
  quotes: Record<string, Quote>;
  /** The symbol on the selected chart, marked in the list. */
  current: string | null;
  onPick: (item: Instrument) => void;
  onChange: (items: Instrument[]) => void;
  onRemove: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const full = spec.items.length >= MAX_LIST;
  return (
    <section className="inst mk-panel" aria-label="Watchlist">
      <div className="mk-head mk-grip">
        <div className="mk-facts">
          <span className="inst-name">Watchlist</span>
          <span className="inst-plain">click a row to chart it</span>
        </div>
        <div className="mk-tools">
        <button className="mk-tool" onClick={() => setAdding(true)} disabled={full} title={full ? `A watchlist holds ${MAX_LIST} symbols` : "Add a symbol"} aria-label="Add a symbol to this watchlist">
          +
        </button>
        <button className="mk-tool" onClick={onRemove} title="Remove this watchlist" aria-label="Remove this watchlist">
          ×
        </button>
        </div>
      </div>
      {spec.items.length === 0 ? (
        <div className="mk-empty">
          <p className="sub">Nothing on this list yet.</p>
          <button className="btn sm" onClick={() => setAdding(true)}>
            Add a symbol
          </button>
        </div>
      ) : (
        <ul className="mk-list">
          {spec.items.map((item) => {
            const quote = quotes[item.symbol];
            const moved = change(quote?.price, quote?.previous);
            const tone = moved ? (moved.up ? "mk-up" : "mk-down") : "";
            return (
              <li key={item.symbol} className={item.symbol === current ? "sel" : undefined}>
                <button className="mk-row" onClick={() => onPick(item)} title={quote?.error ?? `Chart ${item.name}`}>
                  <span className="mk-who">
                    <b>{item.name}</b>
                    <small className="num">{item.symbol}</small>
                  </span>
                  <span className={tone}>{quote?.spark ? <Spark values={quote.spark} /> : <span className="mk-spark" />}</span>
                  <Figure quote={quote} live={item.symbol === BITCOIN} />
                </button>
                <button className="mk-drop" onClick={() => onChange(spec.items.filter((other) => other.symbol !== item.symbol))} title={`Remove ${item.name}`} aria-label={`Remove ${item.name} from this watchlist`}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <SymbolPicker
          title="Add to watchlist"
          onClose={() => setAdding(false)}
          onPick={(item) => {
            setAdding(false);
            if (!spec.items.some((other) => other.symbol === item.symbol)) onChange([...spec.items, item]);
          }}
        />
      )}
    </section>
  );
}
