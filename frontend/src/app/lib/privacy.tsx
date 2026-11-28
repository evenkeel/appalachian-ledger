import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

/**
 * Privacy blur: blurs the owner's bitcoin amounts (and the dollar worth of their bitcoin) so
 * nobody nearby can read them. The layout stays; only the figures go soft.
 *
 * It belongs to this device, not the ledger: someone using the app in public wants it on here
 * even before signing in, and remembered across launches. The choice lives on the page root as
 * `data-private`, so styles do the blurring and every screen follows at once.
 */
const KEY = "ledger:private";

function read() {
  try {
    return globalThis.localStorage?.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

let on = read();
const listeners = new Set<() => void>();

function apply() {
  if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-private", on);
}
apply();

export const isPrivate = () => on;

export function setPrivate(next: boolean) {
  on = next;
  try {
    if (next) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage may be refused; the blur still works until the app closes.
  }
  apply();
  listeners.forEach((listener) => listener());
}

/** For tests: read the saved choice again, as a fresh launch would. */
export function reloadPrivacy() {
  on = read();
  apply();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrivacy(): [boolean, (next: boolean) => void] {
  return [useSyncExternalStore(subscribe, isPrivate, isPrivate), setPrivate];
}

/** A figure that blurs while privacy is on. With `when` false (a dollar figure, say) it stays plain. */
export function Private({ children, className, when = true }: { children: ReactNode; className?: string; when?: boolean }) {
  if (!when) return className ? <span className={className}>{children}</span> : <>{children}</>;
  return <span className={className ? `private ${className}` : "private"}>{children}</span>;
}

// A bitcoin amount as `btc()` writes it (₿21,932,000, −₿1,200, +₿500), or a short label (₿2.1M, ₿45k).
const AMOUNT = /[+−-]?₿\d+(?:,\d{3})*(?:\.\d+)?(?:e\+?\d+)?[kMBT]?/g;
// A dollar amount, for figures that are the dollar worth of the owner's bitcoin.
const DOLLARS = /[+−-]?\$\d+(?:,\d{3})*(?:\.\d+)?(?:e\+?\d+)?[kMBT]?/g;

function split(text: string, wrap: (amount: string, key: number) => ReactNode) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(AMOUNT)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(wrap(match[0], match.index));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** A sentence whose bitcoin amounts blur while privacy is on; the words stay readable. */
export const PrivateText = ({ text }: { text: string }) =>
  split(text, (amount, key) => <Private key={key}>{amount}</Private>);

/** The same inside SVG text: each bitcoin amount becomes a blurred tspan. */
export const PrivateTspans = ({ text }: { text: string }) =>
  split(text, (amount, key) => (
    <tspan key={key} className="private">
      {amount}
    </tspan>
  ));

/**
 * Hover tips and other plain text that styles cannot blur: bitcoin amounts become "₿ hidden"
 * while privacy is on. Pass the current choice so the text follows a change.
 */
export const hideAmounts = (text: string, hidden: boolean) => (hidden ? text.replace(AMOUNT, "₿ hidden") : text);

/**
 * An SVG hover tip whose bitcoin amounts read "₿ hidden" while privacy is on. With `all`, for a
 * chart of what the owner's bitcoin is worth, dollar amounts read "$ hidden" too.
 */
export function Tip({ text, all = false }: { text: string; all?: boolean }) {
  const [hidden] = usePrivacy();
  const shown = hideAmounts(text, hidden);
  return <title>{hidden && all ? shown.replace(DOLLARS, "$ hidden") : shown}</title>;
}

/**
 * The blur for figures drawn inside charts. CSS blur() on SVG text is not dependable in every
 * engine, while an SVG filter is, so chart figures use this. Rendered once, by the app shell.
 */
export function PrivacyFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <filter id="private-blur" x="-30%" y="-60%" width="160%" height="220%">
        <feGaussianBlur stdDeviation="3.2" />
      </filter>
    </svg>
  );
}
