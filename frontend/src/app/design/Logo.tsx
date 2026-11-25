import { useId } from "react";

type Point = [number, number];

/** Smooth curve through the points (Catmull-Rom converted to cubic segments). */
export function spline(points: Point[]) {
  const f = (n: number) => +n.toFixed(2);
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i],
      p1 = points[i],
      p2 = points[i + 1],
      p3 = points[i + 2] ?? p2;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

type Tone = "back" | "mid" | "front";

/**
 * Three gentle rolling hills, layered like rows of Appalachian ridges, on a 220 x 28 grid.
 * The dark blue ridge is the nearest and runs the whole width, with two low swells.
 * Light blue rises behind its left swell; orange (bitcoin) peeks over its right one.
 * The mark is a block: every ridge is filled down to the flat baseline.
 */
export const RIDGES: { tone: Tone; points: Point[] }[] = [
  {
    tone: "back",
    points: [[0, 19.5], [10, 14.5], [22, 9.6], [34, 7.8], [46, 6], [58, 2], [69, 0.2], [80, 1.8], [96, 5], [112, 8], [140, 13.5], [170, 20], [200, 28]],
  },
  {
    tone: "mid",
    points: [[60, 24], [84, 15.5], [100, 11.5], [118, 6], [127, 3.7], [133.5, 3.1], [140, 3.7], [152, 6.5], [166, 10.5], [178, 12.8], [190, 13.9], [200, 16.5], [210, 19.5], [220, 23]],
  },
  {
    tone: "front",
    points: [[0, 23.6], [14, 20.5], [28, 17.5], [40, 14.3], [47, 12.7], [53, 12.2], [60, 12.7], [72, 14.5], [88, 17.5], [102, 19.2], [116, 17.5], [128, 15], [137, 13.7], [144, 13.3], [152, 13.8], [164, 16.5], [178, 17.2], [190, 17.7], [200, 20], [210, 22.5], [220, 24.4]],
  },
];

const MARK_W = 220;
const MARK_H = 28;

function Ridges() {
  return (
    <>
      {RIDGES.map(({ tone, points }) => (
        <path key={tone} fill={`var(--mark-${tone})`} d={`${spline(points)}V${MARK_H}H${points[0][0]}Z`} />
      ))}
    </>
  );
}

/**
 * The app icon is its own drawing on a 48 x 48 grid, not a crop of the mark: three low, wide, rounded hills
 * big enough to read at 16 px, in the logo's order (light blue behind on the left, orange peeking
 * on the right, the blue ridge across the front), on a deep navy tile so all three colours show.
 */
const ICON_BG = "#12222b";
const ICON_HILLS: { fill: string; points: Point[] }[] = [
  {
    fill: "#a9c1cf",
    points: [[-6, 24.1], [-1, 21.6], [4, 18.7], [9, 16], [14, 14.6], [19, 15], [24, 17], [29, 19.9], [34, 22.7], [39, 24.9], [44, 26.3], [49, 27], [54, 27.3]],
  },
  {
    fill: "#db8046",
    points: [[-6, 36], [-1, 35.4], [4, 34.6], [9, 33.2], [14, 31.1], [19, 27.9], [24, 24.3], [29, 21.2], [34, 20], [39, 21.1], [44, 23.5], [49, 26.1], [54, 27.9]],
  },
  {
    fill: "#3f6a80",
    points: [[-6, 35.7], [-1, 34.9], [4, 34], [9, 33.5], [14, 33.7], [19, 34.3], [24, 34.7], [29, 34.7], [34, 34.3], [39, 34.1], [44, 34.3], [49, 34.9], [54, 35.6]],
  },
];

export function Tile({ size = 34 }: { size?: number }) {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <rect width="48" height="48" rx="11" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="48" height="48" fill={ICON_BG} />
        {ICON_HILLS.map(({ fill, points }) => (
          <path key={fill} fill={fill} d={`${spline(points)}V48H${points[0][0]}Z`} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The logo: the mark sitting on the name, which is set in a bold serif to exactly the mark's width.
 * One lockup everywhere; the header shows it small and the sign-in screen large.
 */
export function Lockup({ width = 240, className }: { width?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 49"
      width={width}
      height={(width * 49) / 200}
      role="img"
      aria-label="Appalachian Bitcoin"
    >
      <g transform={`scale(${200 / MARK_W})`}>
        <Ridges />
      </g>
      <text
        x="0"
        y="44"
        textLength="200"
        lengthAdjust="spacing"
        fill="currentColor"
        style={{ fontFamily: "var(--font-brand)", fontSize: 19.2, fontWeight: 700 }}
      >
        Appalachian Bitcoin
      </text>
    </svg>
  );
}
