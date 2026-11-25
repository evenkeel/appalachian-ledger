import type { CSSProperties } from "react";
import { useSize } from "../lib/useSize";
import type { BookSpec } from "./board";
import { grouped, groupsOf, reaches, spread, useBook } from "./book";
import type { Reach } from "./book";
import { price } from "./feed";
import { useLivePrice } from "./live";

/** Pixel heights the rows are laid out to, so the panel shows as many levels as fit. */
const ROW = 19;
const MIDDLE = 38;
const HEADINGS = 22;

function Rows({ side, levels, most, digits }: { side: "asks" | "bids"; levels: Reach[]; most: number; digits: number }) {
  return (
    <ol className={`mk-ob-side ${side}`} aria-label={side === "asks" ? "Sell orders, lowest price nearest the middle" : "Buy orders, highest price first"}>
      {levels.map((level) => (
        // The shaded bar is everything resting between this price and the middle, against the most shown.
        <li key={level.price} style={{ "--fill": `${most > 0 ? Math.min(100, (level.total / most) * 100).toFixed(1) : 0}%` } as CSSProperties}>
          <span className={side === "asks" ? "mk-down" : "mk-up"}>{price(level.price, digits)}</span>
          <span>{level.size.toFixed(4)}</span>
          <span className="dim">{level.total.toFixed(3)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Bitcoin's live order book: sellers above, buyers below, the spread between them. */
export function OrderBook({ spec, onChange, onRemove }: { spec: BookSpec; onChange: (patch: Partial<BookSpec>) => void; onRemove: () => void }) {
  const { book, live } = useBook();
  const traded = useLivePrice();
  const [ref, size] = useSize<HTMLDivElement>();
  const groups = book ? groupsOf(book) : [];
  // A saved group that today's price no longer offers falls back to the fine one.
  const width = book ? (groups.find((group) => Math.abs(group - spec.group) < 1e-9) ?? book.near.step) : spec.group;
  const view = book ? grouped(book, width) : null;
  const count = Math.max(2, Math.floor((size.height - MIDDLE - HEADINGS) / 2 / ROW));
  const asks = view ? reaches(view.asks.slice(0, count)) : [];
  const bids = view ? reaches(view.bids.slice(0, count)) : [];
  const most = Math.max(asks[asks.length - 1]?.total ?? 0, bids[bids.length - 1]?.total ?? 0);
  const digits = width < 1 ? 2 : 0;
  const gap = book ? spread(book) : null;
  return (
    <section className="inst mk-panel" aria-label="Bitcoin order book">
      <div className="mk-head mk-grip">
        <div className="mk-facts">
          <span className="inst-name">Order book</span>
          <span className="inst-plain">Bitcoin · {book && !live ? "reconnecting…" : "Coinbase, live"}</span>
        </div>
        <div className="mk-tools">
          <button className="mk-tool" onClick={onRemove} title="Remove the order book" aria-label="Remove the order book">
            ×
          </button>
        </div>
      </div>
      {groups.length > 0 && (
        <div className="mk-bar">
          <span className="mk-label">Group $</span>
          <div className="seg mk-tf" role="group" aria-label="Price group in dollars">
            {groups.map((group) => (
              <button key={group} aria-pressed={group === width} title={group < 1 ? "Every price level, to the cent" : `Prices grouped in steps of $${group}`} onClick={() => onChange({ group })}>
                {group}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={ref} className="mk-ob num">
        {book && gap ? (
          <>
            <div className="mk-ob-head" aria-hidden="true">
              <span>Price ($)</span>
              <span>Size (BTC)</span>
              <span>Total (BTC)</span>
            </div>
            <Rows side="asks" levels={asks} most={most} digits={digits} />
            <div className="mk-ob-mid">
              <b>${price(traded ?? (book.bid + book.ask) / 2, 2)}</b>
              <span className="dim" title="The gap between the lowest seller and the highest buyer">
                spread ${price(gap.dollars, 2)}
              </span>
            </div>
            <Rows side="bids" levels={bids} most={most} digits={digits} />
          </>
        ) : (
          <div className="mk-empty" aria-busy="true">
            <p className="sub">{live ? "Reading the order book…" : "Connecting to Coinbase…"}</p>
          </div>
        )}
      </div>
    </section>
  );
}
