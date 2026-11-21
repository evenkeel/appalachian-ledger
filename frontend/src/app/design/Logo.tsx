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

/**
 * Three gentle rolling hills, layered like rows of Appalachian ridges:
 * light blue furthest back, orange (bitcoin) in the middle, dark blue in front.
 * Free-standing mark on a 160 x 40 grid; every ridge tapers to the baseline.
 */
export const RIDGES: { fill: string; points: Point[] }[] = [
  { fill: "var(--mark-back)", points: [[0, 40], [26, 27], [56, 8], [92, 19], [124, 30], [150, 40]] },
  { fill: "var(--mark-mid)", points: [[30, 40], [74, 31], [108, 13], [140, 26], [160, 40]] },
  { fill: "var(--mark-front)", points: [[0, 40], [20, 33], [50, 25], [84, 33], [116, 38], [160, 40]] },
];

/** The same ridges running edge to edge on a 150 x 44 grid, for the app icon. */
export const BLEED: { fill: string; points: Point[] }[] = [
  { fill: "#a9c1cf", points: [[0, 22], [45, 7], [98, 22], [150, 15]] },
  { fill: "#db8046", points: [[0, 31], [50, 29], [108, 15], [150, 25]] },
  { fill: "#304e5d", points: [[0, 33], [42, 27], [98, 38], [150, 34]] },
];

function Ridges() {
  return (
    <>
      {RIDGES.map((ridge) => (
        <path key={ridge.fill} fill={ridge.fill} d={spline(ridge.points) + "Z"} />
      ))}
    </>
  );
}

export function Mark({ width = 92 }: { width?: number }) {
  return (
    <svg viewBox="0 0 160 40" width={width} height={width / 4} aria-hidden="true">
      <Ridges />
    </svg>
  );
}

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
        <rect width="48" height="48" fill="#f8f7f3" />
        <g transform="translate(-3 18.5) scale(.36)">
          {BLEED.map((ridge) => (
            <path key={ridge.fill} fill={ridge.fill} d={spline(ridge.points) + "V90H0Z"} />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** Header lockup: mark, then the wordmark on one line. */
export function Lockup() {
  return (
    <div className="lockup">
      <Mark />
      <span className="wordmark">
        Appalachian <b>Bitcoin</b>
      </span>
    </div>
  );
}

/** Sign-in lockup: the wordmark is set to exactly the mark's width. */
export function StackedLockup({ width = 240 }: { width?: number }) {
  return (
    <svg
      viewBox="0 0 200 78"
      width={width}
      height={(width * 78) / 200}
      role="img"
      aria-label="Appalachian Bitcoin"
    >
      <g transform="scale(1.25)">
        <Ridges />
      </g>
      <text
        x="0"
        y="72"
        textLength="200"
        lengthAdjust="spacing"
        fill="currentColor"
        style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, letterSpacing: ".2em" }}
      >
        APPALACHIAN <tspan fontWeight="700">BITCOIN</tspan>
      </text>
    </svg>
  );
}
