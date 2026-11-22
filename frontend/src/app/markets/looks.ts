/** Colour themes for the Markets screen alone. The rest of the app keeps its own night and day themes. */
export const LOOKS = [
  { id: "app", name: "Appalachian", about: "the app's own colours", swatch: ["#0d181f", "#f1efe8", "#4cc38a", "#e2647c"] },
  { id: "terminal", name: "Terminal", about: "amber on black", swatch: ["#000000", "#ffa028", "#33d17a", "#ff433d"] },
  { id: "slate", name: "Slate", about: "dark grey, teal and red", swatch: ["#1e222d", "#d1d4dc", "#26a69a", "#ef5350"] },
  { id: "paper", name: "Paper", about: "black on white", swatch: ["#ffffff", "#111111", "#0a7d3e", "#c62828"] },
] as const;
export type Look = (typeof LOOKS)[number]["id"];

const KEY = "appalachian-bitcoin.markets.look";
const known = (value: unknown): value is Look => LOOKS.some((look) => look.id === value);

/** The look chosen in this browser, or the app's own when none was. */
export function loadLook(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Look {
  try {
    const saved = storage?.getItem(KEY);
    return known(saved) ? saved : "app";
  } catch {
    return "app";
  }
}

export function saveLook(look: Look, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, look);
  } catch {
    /* Private windows can refuse storage; the look then lasts until the page is closed. */
  }
}
