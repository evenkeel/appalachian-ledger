import { useSyncExternalStore } from "react";

/**
 * Privacy blur: blurs the bitcoin balance (on the dashboard and the Stack page) so nobody nearby can read it. Spending
 * and this month's stacking stay readable; only the figures that give the balance away go soft
 * (mark them with the `private` class). The layout stays.
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

// A bitcoin amount as `btc()` writes it: ₿21,932,000, −₿1,200, +₿500.
const AMOUNT = /[+−-]?₿\d+(?:,\d{3})*(?:\.\d+)?/g;

/** Hover tips cannot be blurred, so while privacy is on their bitcoin amounts read "₿ hidden". */
export const hideAmounts = (text: string, hidden: boolean) => (hidden ? text.replace(AMOUNT, "₿ hidden") : text);

/** An SVG hover tip about the balance, which hides its amounts while privacy is on. */
export function Tip({ text }: { text: string }) {
  const [hidden] = usePrivacy();
  return <title>{hideAmounts(text, hidden)}</title>;
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
