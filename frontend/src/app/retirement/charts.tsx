import type { ReactNode } from "react";
import { Frame } from "../dashboard/charts";
import { compact } from "./plan";

export interface Line {
  name: string;
  color: string;
  /** SVG dash pattern, so lines differ by more than colour. */
  dash?: string;
  /** One point per position on the x axis; x is any number (age, or a date in days). */
  points: { x: number; y: number; title: string }[];
  /** Shade under the line. Only for a chart with one line. */
  fill?: string;
}
export interface Marker {
  x: number;
  label: string;
  color: string;
}

/** A sample of a line for the legend: the same colour and the same dashes. */
export function Sample({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg className="ret-sample" viewBox="0 0 22 8" aria-hidden="true">
      <line x1="1" x2="21" y1="4" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

export function Legend({ lines, children }: { lines: { name: string; color: string; dash?: string }[]; children?: ReactNode }) {
  return (
    <div className="key">
      {lines.map((line, index) => (
        <span key={index}>
          <Sample color={line.color} dash={line.dash} />
          {line.name}
        </span>
      ))}
      {children}
    </div>
  );
}

/** Projected values over time. Every figure drawn here comes from the server's projection. */
export function LineChart({
  label,
  lines,
  unit,
  markers = [],
  tick,
  numbered,
  height = 190,
}: {
  label: string;
  lines: Line[];
  unit: "USD" | "BITCOIN";
  markers?: Marker[];
  /** Label for a position on the x axis. */
  tick: (x: number) => string;
  /** Put 1, 2, 3… at the end of each line, matching a numbered legend. */
  numbered?: boolean;
  height?: number;
}) {
  const all = lines.flatMap((line) => line.points);
  if (!all.length) return null;
  return (
    <Frame height={height} label={label}>
      {(W, H) => {
        const left = 50,
          right = numbered ? 18 : 10,
          top = markers.length ? 22 : 10,
          bottom = H - 18;
        const xs = all.map((point) => point.x);
        const x0 = Math.min(...xs),
          x1 = Math.max(...xs);
        const high = Math.max(...all.map((point) => point.y), 0) || 1;
        const x = (value: number) => left + (x1 === x0 ? 0 : (value - x0) / (x1 - x0)) * (W - left - right);
        const y = (value: number) => bottom - (Math.max(0, value) / (high * 1.06)) * (bottom - top);
        const steps = Math.max(2, Math.min(8, Math.floor((W - left - right) / 56)));
        const ticks = Array.from({ length: steps + 1 }, (_, index) => x0 + ((x1 - x0) * index) / steps);
        return (
          <>
            {[high, high / 2, 0].map((value, index) => (
              <g key={index}>
                <line x1={left} x2={W - right} y1={y(value)} y2={y(value)} stroke={index === 2 ? "var(--bezel)" : "var(--hairline)"} />
                <text x={left - 6} y={y(value) + 3.5} textAnchor="end">
                  {compact(value, unit)}
                </text>
              </g>
            ))}
            {x1 > x0 &&
              ticks.map((value, index) => (
                <text key={index} x={x(value)} y={H - 3} textAnchor={index === 0 ? "start" : index === steps ? "end" : "middle"}>
                  {tick(value)}
                </text>
              ))}
            {markers
              .filter((marker) => marker.x >= x0 && marker.x <= x1)
              .map((marker, index) => {
                const mx = x(marker.x);
                const anchor = mx > W - 96 ? "end" : "start";
                return (
                  <g key={index}>
                    <line x1={mx} x2={mx} y1={top - 6} y2={bottom} stroke={marker.color} strokeDasharray="3 3" />
                    <text x={anchor === "end" ? mx - 4 : mx + 4} y={top - 10 + index * 11} textAnchor={anchor} className="lbl" style={{ fill: marker.color }}>
                      {marker.label}
                    </text>
                  </g>
                );
              })}
            {lines.map((line, index) => {
              const path = line.points.map((point, i) => `${i ? "L" : "M"}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join("");
              const first = line.points[0],
                last = line.points[line.points.length - 1];
              const dots = line.points.length <= 60;
              return (
                <g key={index}>
                  {line.fill && line.points.length > 1 && <path d={`${path}V${bottom}H${x(first.x).toFixed(1)}Z`} fill={line.fill} />}
                  <path d={path} fill="none" stroke={line.color} strokeWidth="2" strokeDasharray={line.dash} strokeLinejoin="round" />
                  {dots &&
                    line.points.map((point, i) => (
                      <circle key={i} cx={x(point.x)} cy={y(point.y)} r={i === 0 || i === line.points.length - 1 ? 3 : 2} fill={line.color}>
                        <title>{point.title}</title>
                      </circle>
                    ))}
                  {numbered && (
                    <text x={x(last.x) + 6} y={y(last.y) + 3.5} className="lbl" style={{ fill: line.color, fontWeight: 700 }}>
                      {index + 1}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        );
      }}
    </Frame>
  );
}
