import { useModalDialog } from "../lib/useModalDialog";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Account } from "../lib/types";
import { api } from "../lib/api";
import { Money } from "./Money";
import { Field } from "./EntryDialog";
import { Button } from "./ui/button";

export function HoldingsSummary({ account }: { account: Account }) {
  const portfolio = account.portfolio;
  if (!portfolio)
    return (
      <p className="hint">
        Enter a ticker and shares to calculate market value automatically.
      </p>
    );
  return (
    <div className="holdings-summary">
      {portfolio.error && (
        <p className="alert error" role="alert">
          {portfolio.error} Showing last recorded values.
        </p>
      )}
      {portfolio.holdings.map((h) => (
        <div className="holding-detail" key={h.symbol}>
          <div className="key-value">
            <strong>{h.symbol}</strong>
            <span>
              {h.shares} shares × <Money value={h.price} unit="USD" />
            </span>
          </div>
          <div className="key-value">
            <span>Market value</span>
            <Money value={h.value} unit="USD" />
          </div>
          <div className="key-value">
            <span>Unrealized gain / loss</span>
            <span className={h.gain?.startsWith("-") ? "negative" : "positive"}>
              <Money value={h.gain} unit="USD" />
              {h.gain_percent !== null && ` (${h.gain_percent}%)`}
            </span>
          </div>
          <div className="key-value">
            <span>Daily price change × shares</span>
            <Money value={h.day_change} unit="USD" />
          </div>
          {h.cost_basis === null && (
            <small>
              Add total cost basis to calculate your unrealized return.
            </small>
          )}
          <small>
            {portfolio.source} · regular session quote{" "}
            {h.observed_at
              ? new Date(h.observed_at).toLocaleString()
              : "unavailable"}
            {h.stale ? " · cached / refresh overdue" : ""}
          </small>
        </div>
      ))}
      <div className="key-value">
        <span>Uninvested cash</span>
        <Money value={portfolio.cash} unit="USD" />
      </div>
      <small>
        Refreshes every minute while open. Quotes may be delayed; outside market
        hours, the last session’s price remains. Returns exclude dividends, fees
        and realized gains.
      </small>
    </div>
  );
}

export function HoldingsDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState(
    account.portfolio?.holdings.map((h) => ({
      symbol: h.symbol,
      shares: h.shares,
      cost_basis: h.cost_basis ?? "",
    })) ?? [
      {
        symbol: /^[A-Z][A-Z0-9.\-]{0,9}$/.test(account.name)
          ? account.name
          : (account.name.match(/\(([A-Z][A-Z0-9.\-]{0,9})\)/)?.[1] ?? ""),
        shares: "",
        cost_basis: "",
      },
    ],
  );
  const [cash, setCash] = useState(account.portfolio?.cash ?? "0");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useModalDialog(ref);
  function update(
    index: number,
    field: "symbol" | "shares" | "cost_basis",
    value: string,
  ) {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/accounts/${account.id}/holdings`, "PUT", {
        cash,
        holdings: rows.map((r) => ({
          ...r,
          symbol: r.symbol.trim().toUpperCase(),
          cost_basis: r.cost_basis || null,
        })),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="entry-dialog holdings-dialog"
      aria-labelledby="holdings-title"
      onCancel={(e) => {
        e.stopPropagation();
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">{account.name}</span>
            <h2 id="holdings-title">Shares & market value</h2>
          </div>
        </div>
        <p className="hint">
          Enter your current holdings. Market value = shares × latest USD quote,
          plus cash. Fractional shares are supported.
        </p>
        {!account.portfolio && (
          <p className="alert">
            This replaces the current manual account value of{" "}
            <Money value={account.balance} unit="USD" /> with the value of all
            holdings and cash below. Existing history is preserved.
          </p>
        )}
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="holdings-fields">
          {rows.map((row, i) => (
            <div className="holding-input" key={i}>
              <Field label={`Ticker ${i + 1}`}>
                <input
                  required
                  placeholder="MSTR"
                  maxLength={15}
                  value={row.symbol}
                  onChange={(e) => update(i, "symbol", e.target.value)}
                />
              </Field>
              <Field label={`Shares ${i + 1}`}>
                <input
                  required
                  inputMode="decimal"
                  placeholder="10.5"
                  value={row.shares}
                  onChange={(e) => update(i, "shares", e.target.value)}
                />
              </Field>
              <Field
                label={`Total cost basis ${i + 1} · USD`}
                hint="Optional · total paid for these remaining shares, not per share."
              >
                <input
                  inputMode="decimal"
                  placeholder="Optional"
                  value={row.cost_basis}
                  onChange={(e) => update(i, "cost_basis", e.target.value)}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                aria-label={`Remove holding ${i + 1}`}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={rows.length >= 25}
            onClick={() =>
              setRows([...rows, { symbol: "", shares: "", cost_basis: "" }])
            }
          >
            Add holding
          </Button>
          <Field label="Uninvested cash · USD">
            <input
              required
              inputMode="decimal"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
          </Field>
        </fieldset>
        <p className="hint">
          Keep shares and cost basis current after trades or splits. Holdings
          edits reconcile today’s balance; they do not record trade proceeds or
          realized returns. Use transfers for deposits and withdrawals.
        </p>
        <p className="hint">
          Tickers are sent to Yahoo Finance for quotes. Share counts and cost
          basis remain local.
        </p>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? "Fetching quotes…" : "Save & fetch prices"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
