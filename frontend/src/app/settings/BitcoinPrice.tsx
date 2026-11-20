import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import type { Preferences, Rate } from "../../lib/types";
import { Panel } from "../dashboard/panels";
import type { DashboardData } from "../dashboard/types";
import { btc, shortDate, usd } from "../lib/format";
import { Note, Switch, moment, today, useAction } from "./controls";

type Source = Preferences["rate_source"];
interface PriceStatus {
  source: Source;
  automatic: boolean;
  quote: null | { usd_per_btc: string; source: string; observed_at: string; fetched_at: string; stale: boolean };
  history: null | {
    status: string;
    start: string | null;
    end: string | null;
    days_saved: number;
    days_missing: number;
    error: string | null;
    quote_error: string | null;
    last_success_at: string | null;
  };
}
type Price = DashboardData["price"];
const SOURCES: { value: Source; label: string }[] = [
  { value: "manual", label: "Manual · offline" },
  { value: "coinbase", label: "Coinbase" },
  { value: "coingecko", label: "CoinGecko" },
];
const nameOf = (source: Source) => SOURCES.find((item) => item.value === source)?.label ?? source;

/** Where the bitcoin price comes from. A missing price is shown as missing, never guessed. */
export function BitcoinPrice({ onChanged }: { onChanged: () => void }) {
  const [saved, setSaved] = useState<{ source: Source; automatic: boolean } | null>(null);
  const [source, setSource] = useState<Source>("manual");
  const [automatic, setAutomatic] = useState(false);
  const [status, setStatus] = useState<PriceStatus | null>(null);
  // undefined while loading, null when the ledger has no price at all, "unread" when the reading failed.
  const [price, setPrice] = useState<Price | "unread" | undefined>(undefined);
  const [rates, setRates] = useState<Rate[]>([]);
  const [loadError, setLoadError] = useState("");
  const settings = useAction(),
    feed = useAction(),
    manual = useAction();
  const lastQuote = useRef<string | null>(null);
  const priceForm = useRef<HTMLFormElement>(null);

  /** The price the ledger is using now, the feed's state, and the latest saved prices. */
  const readPrice = useCallback(async () => {
    const [state, list, reading] = await Promise.all([
      api<PriceStatus>("/prices/status"),
      api<Rate[]>("/rates"),
      api<DashboardData>("/dashboard").then(
        (dashboard) => dashboard.price,
        () => "unread" as const,
      ),
    ]);
    lastQuote.current = state.quote?.observed_at ?? null;
    setStatus(state);
    setRates(list.slice(0, 4));
    setPrice(reading);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { preferences } = await api<{ preferences: Preferences }>("/settings");
        if (!alive) return;
        const now = { source: preferences.rate_source, automatic: preferences.automatic_prices ?? false };
        setSaved(now);
        setSource(now.source);
        setAutomatic(now.automatic);
        await readPrice();
      } catch (e) {
        if (alive) setLoadError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [readPrice]);

  // While a provider is chosen, watch for the next quote so a queued refresh shows up here.
  const live = saved !== null && saved.source !== "manual";
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      api<PriceStatus>("/prices/status")
        .then((state) => {
          const seen = state.quote?.observed_at ?? null;
          if (seen !== lastQuote.current) void readPrice().catch(() => {});
          else setStatus(state);
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [live, readPrice]);

  function saveSource(event: FormEvent) {
    event.preventDefault();
    void settings.run(async () => {
      // Saving replaces every preference, so start from what is saved now and change two fields only.
      const fresh = await api<{ preferences: Preferences }>("/settings");
      const next = { source, automatic: source === "manual" ? false : automatic };
      await api("/settings", "PUT", { ...fresh.preferences, rate_source: next.source, automatic_prices: next.automatic });
      setSaved(next);
      setAutomatic(next.automatic);
      await readPrice();
      onChanged();
      return "Price settings saved.";
    });
  }

  function savePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const day = String(data.get("day") ?? "");
    const amount = String(data.get("usd_per_btc") ?? "").replace(/[$,\s]/g, "");
    void manual.run(async () => {
      if (!day) throw new Error("Choose the day this price is for.");
      if (day > today()) throw new Error("A price cannot be saved for a future day.");
      if (!/^\d+(\.\d{1,8})?$/.test(amount) || /^0+(\.0+)?$/.test(amount)) throw new Error("Enter the dollar price of one BTC, such as 97250.00.");
      await api("/rates", "POST", { day, usd_per_btc: amount });
      form.reset();
      await readPrice();
      onChanged();
      return `Saved ${usd(amount)} per BTC for ${shortDate(day)}.`;
    });
  }

  function refresh() {
    void feed.run(async () => {
      await api("/prices/refresh", "POST");
      return "Price update requested. It appears here when it arrives.";
    });
  }

  function fetchDay(form: HTMLFormElement | null) {
    const day = String(new FormData(form ?? undefined).get("day") ?? "");
    void manual.run(async () => {
      if (!day) throw new Error("Choose the day to look up.");
      const row = await api<{ usd_per_btc: string; day: string; source: string }>(`/rates/fetch?day=${encodeURIComponent(day)}`, "POST");
      await readPrice();
      onChanged();
      return `Saved ${usd(row.usd_per_btc)} per BTC for ${shortDate(row.day)} from ${row.source}.`;
    });
  }

  if (!saved)
    return (
      <Panel name="Bitcoin price" plain="where it comes from" inop={!loadError}>
        {loadError ? (
          <p className="set-note error" role="alert">
            {loadError}
          </p>
        ) : (
          <div className="sub" aria-busy="true">
            Reading your price settings…
          </div>
        )}
      </Panel>
    );

  const history = status?.history;
  const syncing = history ? ["pending", "running"].includes(history.status) : false;
  const dirty = source !== saved.source || (source !== "manual" && automatic !== saved.automatic);

  return (
    <Panel name="Bitcoin price" plain="where it comes from">
      <div className="set-price" aria-label="Price in use">
        {price === "unread" ? (
          <span className="sub">The price in use could not be read just now.</span>
        ) : price ? (
          <>
            <b className="num btc">{btc(price.bitcoin_per_usd)}</b>
            <span className="sub">per $1</span>
            <span className="sub num set-price-usd">{usd(price.usd_per_btc)} per BTC</span>
            <span className="hint">
              {price.source} · {price.day}
              {price.stale && <span className="tag miss">Stale</span>}
            </span>
          </>
        ) : price === null ? (
          <>
            <b className="dim">No price saved</b>
            <span className="hint">Bitcoin amounts that need a price show as missing until one is saved. Nothing is estimated.</span>
          </>
        ) : (
          <span className="sub">Reading the price…</span>
        )}
      </div>

      <form className="set-form" onSubmit={saveSource}>
        <label className="field">
          <span>Price source</span>
          <select value={source} onChange={(event) => setSource(event.target.value as Source)}>
            {SOURCES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="set-line">
          <Switch checked={automatic && source !== "manual"} disabled={source === "manual"} label="Automatic prices" onChange={setAutomatic} />
          <span>
            <b>Automatic prices</b>
            <span className="hint">
              {source === "manual"
                ? "Manual never contacts the internet. You enter each price yourself."
                : `Asks ${nameOf(source)} for the public bitcoin price every few minutes. Nothing from your ledger is sent.`}
            </span>
          </span>
        </div>
        <div className="set-actions">
          <button className="btn primary" disabled={settings.busy || !dirty}>
            Save price settings
          </button>
          {dirty && !settings.note && <span className="hint">Unsaved changes</span>}
        </div>
        <Note note={settings.note} />
      </form>

      {saved.source !== "manual" && (
        <div className="set-form">
          <div className="set-sub">Price feed · {nameOf(saved.source)}</div>
          <div className="sub">
            {status?.quote ? (
              <>
                Last price received {moment(status.quote.observed_at)}
                {status.quote.stale ? " · stale" : ""}
              </>
            ) : (
              "No price has been received from this source yet."
            )}
            {history?.start && (
              <>
                <br />
                Daily history {history.start} to {history.end}: {history.days_saved} days saved, {history.days_missing} {syncing ? "pending" : "missing"}
              </>
            )}
          </div>
          {(history?.quote_error || history?.error) && (
            <p className="set-note error" role="status">
              {[history.quote_error, history.error].filter(Boolean).join(" ")}
            </p>
          )}
          <div className="set-actions">
            <button type="button" className="btn" disabled={feed.busy} onClick={refresh}>
              Refresh now
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={feed.busy || syncing}
              onClick={() =>
                void feed.run(async () => {
                  await api("/prices/history", "POST", {});
                  await readPrice();
                  return "Past daily prices requested, back to your earliest entry.";
                })
              }
            >
              {syncing ? "Filling in past prices…" : "Fill in past prices"}
            </button>
          </div>
          <Note note={feed.note} />
        </div>
      )}

      <form className="set-form" ref={priceForm} onSubmit={savePrice}>
        <div className="set-sub">Enter a price for a day</div>
        <div className="set-pair">
          <label className="field">
            <span>Day</span>
            <input type="date" name="day" defaultValue={today()} max={today()} min="2009-01-01" required />
          </label>
          <label className="field">
            <span>Dollars per BTC</span>
            <input className="num" name="usd_per_btc" inputMode="decimal" autoComplete="off" placeholder="0.00" />
          </label>
        </div>
        <div className="hint">1 BTC is ₿100,000,000. A saved price also prices that day's expenses in bitcoin.</div>
        <div className="set-actions">
          <button className="btn" disabled={manual.busy}>
            Save this price
          </button>
          {saved.source !== "manual" && (
            <button type="button" className="btn ghost" disabled={manual.busy} onClick={() => fetchDay(priceForm.current)}>
              Look this day up at {nameOf(saved.source)}
            </button>
          )}
        </div>
        <Note note={manual.note} />
      </form>

      {rates.length > 0 && (
        <table className="set-rates">
          <caption>Latest saved prices</caption>
          <tbody>
            {rates.map((rate) => (
              <tr key={rate.id ?? `${rate.day}-${rate.source}`}>
                <td>{rate.day}</td>
                <td className="num">{usd(rate.usd_per_btc)} per BTC</td>
                <td className="dim" title={rate.method}>
                  {rate.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
