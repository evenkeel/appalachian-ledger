/**
 * True only in the website demo build (`vite build --mode demo`): the real interface on a
 * fictional ledger, with no server, no sign-in and nothing saved.
 */
export const DEMO = import.meta.env.MODE === "demo";

/** Where the demo's Download button leads. Relative, so the site can live under any address. */
export const DOWNLOAD_URL = (import.meta.env.VITE_DEMO_DOWNLOAD_URL as string | undefined) ?? "../download/";

export const NOT_SAVED = "This is the demo, so nothing is saved. Download Appalachian Bitcoin to keep a ledger of your own.";
