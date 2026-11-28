import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { btc, plural, shortDate, usd } from "../lib/format";
import { Note, useAction } from "./controls";

interface Item {
  entry_id: number;
  rate_id: number;
  date: string;
  description: string;
  source: string;
  method: string;
  usd_per_btc: string;
  bitcoin: string | null;
  usd: string | null;
}
interface Review {
  missing: number;
  items: Item[];
}
const entries = (count: number) => plural(count, "entry").replace("entrys", "entries");

/** Entries recorded before a price was saved for their day. A price is attached only from a saved price for that day. */
export function MissingPrices({ onChanged }: { onChanged: () => void }) {
  const action = useAction();
  const [review, setReview] = useState<Review | null>(null);
  const [failed, setFailed] = useState("");

  const read = useCallback(async () => {
    try {
      setReview(await api<Review>("/prices/conversions"));
      setFailed("");
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  function attach() {
    // Exactly the rows on screen: the server refuses any whose price changed since they were read.
    const items = review!.items.map(({ entry_id, rate_id }) => ({ entry_id, rate_id }));
    void action
      .run(async () => {
        const result = await api<{ attached: number }>("/prices/conversions", "POST", { items });
        onChanged();
        return `Attached a saved price to ${entries(result.attached)}.`;
      })
      .then(() => read());
  }

  const ready = review?.items.length ?? 0;
  const waiting = review ? review.missing - ready : 0;
  return (
    <Panel name="Missing prices" plain="entries recorded without a bitcoin price" inop={review?.missing === 0}>
      {failed && !review ? (
        <p className="set-note error" role="alert">
          {failed}
        </p>
      ) : !review ? (
        <div className="sub">Checking for entries without a price…</div>
      ) : review.missing === 0 ? (
        <div className="sub">Every entry has a bitcoin price for its day. Nothing to do.</div>
      ) : (
        <>
          <div className="sub">
            <b>{entries(review.missing)}</b> {review.missing === 1 ? "has" : "have"} no bitcoin price. <b>{ready}</b> can be priced now from a price already saved for that day
            {waiting > 0 && (
              <>
                ; <b>{waiting}</b> {waiting === 1 ? "has" : "have"} no saved price for {waiting === 1 ? "its" : "their"} day yet
              </>
            )}
            .
          </div>
          {ready > 0 && (
            <div className="set-scroll">
              <table className="set-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Entry</th>
                    <th className="r">Dollars</th>
                    <th className="r">Bitcoin</th>
                    <th className="set-hide-s">Price from</th>
                  </tr>
                </thead>
                <tbody>
                  {review.items.map((item) => (
                    <tr key={item.entry_id}>
                      <td className="num dim">{shortDate(item.date)}</td>
                      <td className="set-clip">{item.description}</td>
                      <td className="num r">{item.usd === null ? "—" : usd(item.usd)}</td>
                      <td className="num r btc">{item.bitcoin === null ? "—" : btc(item.bitcoin)}</td>
                      <td className="dim set-hide-s" title={`${usd(item.usd_per_btc)} per BTC`}>
                        {item.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="set-actions">
            {ready > 0 && (
              <button type="button" className="btn" disabled={action.busy} onClick={attach}>
                {action.busy ? "Attaching…" : `Attach ${plural(ready, "saved price")}`}
              </button>
            )}
            <button type="button" className="btn ghost" disabled={action.busy} onClick={() => void read()}>
              Check again
            </button>
          </div>
        </>
      )}
      <div className="hint">
        A price is attached only from a price saved for that exact day. Nothing is guessed and no entry is changed. To price the rest, save a price for their days under Bitcoin price.
      </div>
      <Note note={action.note} />
    </Panel>
  );
}
