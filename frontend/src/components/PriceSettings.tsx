import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Preferences, Rate } from "../lib/types";
import { Money } from "./Money";
import { Button } from "./ui/button";
import { Field } from "./EntryDialog";

export interface PriceStatus {
  source: string;
  automatic: boolean;
  quote: null | {
    usd_per_btc: string;
    source: string;
    observed_at: string;
    fetched_at: string;
    stale: boolean;
  };
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
interface ConversionReview {
  missing: number;
  items: {
    entry_id: number;
    rate_id: number;
    date: string;
    description: string;
    source: string;
    method: string;
    usd_per_btc: string;
    bitcoin: string;
    usd: string;
  }[];
}

export function QuoteStatus({ status }: { status: PriceStatus | null }) {
  const quote = status?.quote;
  return (
    <div className="stack">
      <div className="key-value">
        <span>USD / ₿100,000,000</span>
        <Money value={quote?.usd_per_btc ?? null} unit="USD" />
      </div>
      {quote && (
        <small className={quote.stale ? "warning-text" : "muted"}>
          {quote.stale ? "Stale" : "Updated"} ·{" "}
          {new Date(quote.observed_at).toLocaleString()} · {quote.source}
        </small>
      )}
      {status?.history?.quote_error && (
        <p className="hint" role="status">
          {status.history.quote_error}
        </p>
      )}
    </div>
  );
}

export function PriceSettings({
  preferences,
  rates,
  onRefresh,
  onRate,
  onNotice,
}: {
  preferences: Preferences;
  rates: Rate[];
  onRefresh: () => void;
  onRate: () => void;
  onNotice: (text: string) => void;
}) {
  const [source, setSource] = useState(preferences.rate_source);
  const [automatic, setAutomatic] = useState(
    preferences.automatic_prices ?? false,
  );
  const [status, setStatus] = useState<PriceStatus | null>(null);
  const [review, setReview] = useState<ConversionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [start, setStart] = useState("");
  const savedSource = preferences.rate_source,
    savedAutomatic = preferences.automatic_prices ?? false;
  useEffect(() => {
    setSource(savedSource);
    setAutomatic(savedAutomatic);
    setReview(null);
  }, [savedSource, savedAutomatic]);
  const pollFailed = useRef(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api<PriceStatus>("/prices/status");
        if (!active) return;
        setStatus(result);
        // A recovered poll withdraws its own earlier error, not one from a save.
        if (pollFailed.current) {
          pollFailed.current = false;
          setError("");
        }
      } catch (e) {
        if (!active) return;
        pollFailed.current = true;
        setError((e as Error).message);
      }
    }
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [preferences]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setStatus(await api<PriceStatus>("/prices/status"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const enabled = preferences.rate_source !== "manual";
  const syncing = ["pending", "running"].includes(
    status?.history?.status ?? "",
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Prices</h2>
        <Button size="sm" variant="outline" onClick={onRate}>
          Manual rate
        </Button>
      </div>
      <div className="panel-body stack">
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/settings", "PUT", {
                ...preferences,
                rate_source: source,
                automatic_prices: source === "manual" ? false : automatic,
              });
              onRefresh();
              onNotice("Price settings saved.");
            });
          }}
        >
          <Field label="Price source">
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as Preferences["rate_source"])
              }
            >
              <option value="manual">Manual · offline</option>
              <option value="coinbase">Coinbase</option>
              <option value="coingecko">CoinGecko</option>
            </select>
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={automatic && source !== "manual"}
              disabled={source === "manual"}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            Automatic prices
          </label>
          <Button disabled={busy}>Save price settings</Button>
        </form>
        <QuoteStatus status={status} />
        <div className="button-row">
          <Button
            variant="outline"
            disabled={busy || !enabled}
            onClick={() =>
              void run(async () => {
                await api("/prices/refresh", "POST");
                onNotice("Price update queued.");
              })
            }
          >
            Refresh price
          </Button>
          <Button
            variant="outline"
            disabled={busy || !enabled || syncing}
            onClick={() =>
              void run(async () => {
                await api("/prices/history", "POST", start ? { start } : {});
                onNotice("History sync queued.");
              })
            }
          >
            {syncing ? "Syncing…" : "Sync history"}
          </Button>
        </div>
        {status?.history?.start && (
          <small className="muted">
            {status.history.days_saved} days saved ·{" "}
            {status.history.days_missing} {syncing ? "pending" : "missing"}
            <br />
            {status.history.start} – {status.history.end}
          </small>
        )}
        {status?.history?.error && (
          <p className="hint" role="status">
            {status.history.error}
          </p>
        )}
        <details>
          <summary>Price details</summary>
          <div className="stack restore-form">
            <p className="hint">
              Current prices update every five minutes. History uses{" "}
              {source === "coingecko"
                ? "CoinGecko midnight UTC snapshots; Demo history is limited to 365 days"
                : "Coinbase daily closes in UTC"}
              . Today’s close is available after the day ends. Missing prices
              stay unavailable.
            </p>
            <p className="hint">
              Original amounts and saved conversions stay fixed. Only public market prices are requested;
              your records stay here.
            </p>
            <Field
              label="History start"
              hint="Leave empty to start with your earliest entry."
            >
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                min="2009-01-01"
              />
            </Field>
            {rates.length > 0 && (
              <div className="mini-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>USD / ₿100,000,000</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.slice(0, 8).map((r) => (
                      <tr key={r.id}>
                        <td>{r.day}</td>
                        <td>
                          <Money value={r.usd_per_btc} unit="USD" />
                        </td>
                        <td title={r.method}>{r.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
        <hr />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setReview(await api<ConversionReview>("/prices/conversions"));
            })
          }
        >
          Review missing conversions
        </Button>
        {review && (
          <div className="stack">
            <p className="hint">
              {review.items.length} ready · {review.missing} missing. Only the
              entries below will receive a saved conversion.
            </p>
            {review.items.length > 0 && (
              <>
                <div className="mini-table conversion-review">
                  <table>
                    <thead>
                      <tr>
                        <th>Entry</th>
                        <th>USD</th>
                        <th>bitcoin</th>
                        <th>Rate source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.items.map((item) => (
                        <tr key={item.entry_id}>
                          <td>
                            {item.description}
                            <br />
                            <small>{item.date}</small>
                          </td>
                          <td>
                            <Money value={item.usd} unit="USD" />
                          </td>
                          <td>
                            <Money value={item.bitcoin} />
                          </td>
                          <td
                            title={`${item.method} · ${item.usd_per_btc} USD / ₿100,000,000`}
                          >
                            {item.source}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{ attached: number }>(
                        "/prices/conversions",
                        "POST",
                        {
                          items: review.items.map(({ entry_id, rate_id }) => ({
                            entry_id,
                            rate_id,
                          })),
                        },
                      );
                      setReview(null);
                      onRefresh();
                      onNotice(`${result.attached} conversions saved.`);
                    })
                  }
                >
                  Save {review.items.length} conversions
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => setReview(null)}>
              Close review
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
