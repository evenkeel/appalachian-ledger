import { useEffect, useState } from "react";
import { estimateText } from "../dashboard/flowLayout";
import type { Measure } from "../dashboard/flowLayout";

let context: CanvasRenderingContext2D | null | undefined;

/** Width of chart text in the app's typeface, so labels can be given exactly the room they need. */
export const measureText: Measure = (text, size, weight = 400) => {
  // No layout engine (tests): there is no font to measure against.
  if (context === undefined) context = typeof ResizeObserver === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!context) return estimateText(text, size, weight);
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "sans-serif";
  context.font = `${weight} ${size}px ${family}`;
  // A hair of slack covers sub-pixel differences between canvas and SVG text.
  return context.measureText(text).width * 1.02 + 1;
};

/** Draw again once the web font has loaded: widths measured against the fallback font are off. */
export function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
