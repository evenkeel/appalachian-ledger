/**
 * Bitcoin amounts drawn on screen that privacy would leave readable. A figure counts as blurred
 * when it sits inside a `.private` element. Bitcoin prices ("₿843 per $1", "₿100,000,000" as one
 * whole BTC) are public, so they are left out. Hover tips are checked apart: they are text the
 * blur cannot reach, so they must say "₿ hidden" instead.
 */
const AMOUNT = /₿[\d,]+/;
const PUBLIC = /per \$1|₿100,000,000|\bper BTC\b/;

export function readableBitcoin(root: Element) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!AMOUNT.test(text)) continue;
    const parent = node.parentElement!;
    if (parent.closest(".private, title")) continue;
    // A price is labelled "per $1" by its own line, so read the surrounding element too.
    if (PUBLIC.test(parent.closest("div, li, td, p, span, b")?.textContent ?? text)) continue;
    found.push(text.trim());
  }
  return found;
}

/** Hover tips (SVG titles and title attributes) that still show a bitcoin amount. */
export function readableTips(root: Element) {
  const titles = [...root.querySelectorAll("title")].map((title) => title.textContent ?? "");
  const attributes = [...root.querySelectorAll("[title]")].map((element) => element.getAttribute("title") ?? "");
  return [...titles, ...attributes].filter((text) => AMOUNT.test(text) && !PUBLIC.test(text));
}
