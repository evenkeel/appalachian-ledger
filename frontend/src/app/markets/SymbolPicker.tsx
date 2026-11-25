import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api";
import { Sheet } from "../dashboard/Sheets";
import { PRESETS, isSymbol } from "./board";
import type { Instrument } from "./board";

/** GET /api/market/search */
interface Match extends Instrument {
  kind: string;
  exchange: string;
}

/** Find something to follow: quick picks first, then a search by name or ticker. */
export function SymbolPicker({ title, onPick, onClose }: { title: string; onPick: (item: Instrument) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState("");
  const query = text.trim();

  useEffect(() => {
    setMatches(null);
    setError("");
    if (!query) return;
    let alive = true;
    // Wait for a pause in typing so each keystroke is not a request.
    const timer = window.setTimeout(() => {
      api<{ results: Match[] }>(`/market/search?q=${encodeURIComponent(query)}`)
        .then((reply) => alive && setMatches(reply.results))
        .catch((e) => alive && setError((e as Error).message));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  // A ticker typed exactly can be used even when the search does not list it.
  const typed = query.toUpperCase();
  const direct = isSymbol(typed) && !matches?.some((match) => match.symbol === typed) ? typed : null;
  const row = (item: Instrument, detail: string, label = item.name) => (
    <li key={item.symbol}>
      <button className="mk-pick" onClick={() => onPick({ symbol: item.symbol, name: item.name })}>
        <span>{label}</span>
        <small className="num">{detail}</small>
      </button>
    </li>
  );
  // Board panels are moved with CSS transforms, which would trap a fixed dialog inside the panel.
  return createPortal(
    <Sheet label={title} onClose={onClose}>
      <h2>{title}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const first = matches?.[0];
          if (first) onPick({ symbol: first.symbol, name: first.name });
          else if (direct) onPick({ symbol: direct, name: direct });
        }}
      >
        <label className="field">
          <span>Name or ticker</span>
          <input data-autofocus type="search" value={text} maxLength={40} placeholder="Apple, gold, NVDA…" autoComplete="off" spellCheck={false} onChange={(event) => setText(event.target.value)} />
        </label>
      </form>
      <div className="mk-picks">
        {!query ? (
          PRESETS.map((group) => (
            <section key={group.group}>
              <h3>{group.group}</h3>
              <ul>{group.items.map((item) => row(item, item.symbol))}</ul>
            </section>
          ))
        ) : (
          <>
            {error && (
              <p className="sub" role="alert">
                Search is unavailable: {error}
              </p>
            )}
            {!error && matches === null && <p className="sub">Searching…</p>}
            {matches?.length === 0 && !direct && <p className="sub">Nothing found for “{query}”.</p>}
            <ul>
              {matches?.map((match) => row(match, [match.symbol, match.kind, match.exchange].filter(Boolean).join(" · ")))}
              {direct && row({ symbol: direct, name: direct }, "ticker as typed", `Use ${direct}`)}
            </ul>
          </>
        )}
      </div>
      <div className="acts">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>,
    document.body,
  );
}
