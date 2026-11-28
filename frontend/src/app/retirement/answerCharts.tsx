import { useState } from "react";
import { PrivateText, Tip } from "../lib/privacy";
import { Frame } from "../dashboard/charts";
import { btc, coordinate } from "../lib/format";
import { runwayText } from "./answer";
import type { Answer, CrossPoint, RunwayPoint } from "./answer";
import { compact, monthYear } from "./plan";

/** Round steps of 1, 2 and 5 between two values, thinned to whole powers of ten when there are many. */
function logTicks(low: number, high: number) {
  const ticks: number[] = [];
  for (let power = Math.floor(Math.log10(low)); power <= Math.log10(high); power++)
    for (const step of [1, 2, 5]) {
      const value = step * 10 ** power;
      if (value >= low && value <= high) ticks.push(value);
    }
  return ticks.length > 7 ? ticks.filter((value) => Number.isInteger(Math.log10(value))) : ticks;
}

/** The stack rising, the stack needed falling, and the ages where they cross. */
export function CrossingChart({ answer, lastAge }: { answer: Answer; lastAge: number }) {
  const [at, setAt] = useState<number | null>(null);
  const points = answer.chart;
  const values = points.flatMap((p) => [p.stack, p.need]).map(coordinate).filter((v) => v > 0);
  const stop = answer.first;
  const resting = answer.first ? points.findIndex((p) => p.month === answer.first!.month) : 0;
  const shown = points[Math.min(points.length - 1, at ?? Math.max(0, resting))];
  if (!points.length || !values.length) return null;
  const stacks = points.map((p) => coordinate(p.stack)).filter((v) => v > 0);
  const low = (stacks.length ? Math.min(...stacks) : Math.min(...values)) / 1.7,
    high = Math.max(Math.max(...values) * 1.25, low * 3);
  const move = (delta: number) => setAt((before) => Math.max(0, Math.min(points.length - 1, (before ?? resting) + delta)));
  const label = answer.first
    ? `Your stack and the stack you need, by age. They cross at ${answer.first.age}.`
    : `Your stack and the stack you need, by age. They do not cross before ${lastAge}.`;
  return (
    <>
      <div
        className="ret-cross"
        tabIndex={0}
        role="group"
        aria-label="Read the chart with the left and right arrow keys"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          move(event.key === "ArrowRight" ? 2 : -2);
        }}
        onPointerLeave={() => setAt(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const inside = (event.clientX - box.left - 52) / (box.width - 66);
          const age = coordinate(points[0].age) + Math.max(0, Math.min(1, inside)) * (coordinate(points[points.length - 1].age) - coordinate(points[0].age));
          let best = 0;
          points.forEach((p, i) => {
            if (Math.abs(coordinate(p.age) - age) < Math.abs(coordinate(points[best].age) - age)) best = i;
          });
          setAt(best);
        }}
      >
        <Frame height={310} label={label}>
          {(W, H) => {
            const left = 52,
              right = W - 14,
              top = 16,
              bottom = H - 48;
            const x0 = coordinate(points[0].age),
              x1 = coordinate(points[points.length - 1].age);
            const x = (age: number) => left + ((age - x0) / (x1 - x0 || 1)) * (right - left);
            const y = (v: number) => top + ((Math.log(high) - Math.log(Math.max(v, low))) / (Math.log(high) - Math.log(low))) * (bottom - top);
            const line = (key: "stack" | "need") => {
              let d = "";
              for (const p of points) {
                const v = coordinate(p[key]);
                if (v < low) {
                  if (d) break;
                  continue;
                }
                d += `${d ? "L" : "M"}${x(coordinate(p.age)).toFixed(1)},${y(v).toFixed(1)}`;
              }
              return d;
            };
            const step = x1 - x0 > 50 ? 10 : x1 - x0 > 22 ? 5 : 2;
            const ticks: number[] = [];
            for (let age = Math.ceil(x0 / step) * step; age <= x1; age += step) ticks.push(age);
            const ageOf = (month: number) => x0 + month / 12;
            const a = answer.first ? Math.min(x1, ageOf(answer.first.month)) : x1;
            const zones: [number, number, string, string][] = [
              [x0, a, "ret-zone-not", "Not yet"],
              [a, x1, "ret-zone-safe", "Funded"],
            ];
            return (
              <>
                {logTicks(low, high).map((v) => (
                  <g key={v}>
                    <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--hairline)" />
                    <text className="private" x={left - 6} y={y(v) + 3.5} textAnchor="end">
                      {compact(v, "BITCOIN")}
                    </text>
                  </g>
                ))}
                {ticks.map((age) => (
                  <text key={age} x={x(age)} y={bottom + 14} textAnchor="middle">
                    {age}
                  </text>
                ))}
                {zones.map(([from, to, name, text]) => {
                  const width = x(to) - x(from);
                  if (width < 2) return null;
                  return (
                    <g key={name}>
                      <rect className={name} x={x(from) + 1} y={bottom + 22} width={width - 2} height={18} rx={3} />
                      {width > text.length * 6.4 + 8 && (
                        <text x={(x(from) + x(to)) / 2} y={bottom + 34.5} textAnchor="middle">
                          {text}
                        </text>
                      )}
                    </g>
                  );
                })}
                <path d={line("need")} fill="none" stroke="var(--plan)" strokeWidth="2" />
                <path d={line("stack")} fill="none" stroke="var(--btc)" strokeWidth="2.5" />
                {stop && ageOf(stop.month) <= x1 && (
                  <g>
                    <line x1={x(ageOf(stop.month))} x2={x(ageOf(stop.month))} y1={y(coordinate(stop.bitcoin))} y2={bottom} stroke="var(--ink-3)" strokeDasharray="2 3" />
                    <circle cx={x(ageOf(stop.month))} cy={y(coordinate(stop.bitcoin))} r={5} fill="var(--btc)" stroke="var(--panel)" strokeWidth={2} />
                    <text className="ret-mark" x={Math.max(left + 10, Math.min(right - 8, x(ageOf(stop.month))))} y={y(coordinate(stop.bitcoin)) - 12} textAnchor="middle">
                      {stop.age}
                    </text>
                  </g>
                )}
                {at !== null && <line x1={x(coordinate(shown.age))} x2={x(coordinate(shown.age))} y1={top} y2={bottom} stroke="var(--ink-2)" />}
              </>
            );
          }}
        </Frame>
      </div>
      <div className="sub" role="status">
        <PrivateText text={reading(shown)} />
      </div>
    </>
  );
}

const reading = (p: CrossPoint) =>
  `At ${Math.floor(coordinate(p.age))}, ${monthYear(p.date)}: your stack ${btc(p.stack)}, stack you need ${btc(p.need)}.`;

const RUNWAY_TICKS: [number, string][] = [
  [1, "1 mo"],
  [3, "3 mo"],
  [6, "6 mo"],
  [12, "1 yr"],
  [24, "2 yr"],
  [60, "5 yr"],
  [120, "10 yr"],
  [240, "20 yr"],
  [600, "50 yr"],
];

/** How long the stack lasts if the owner stops at each age, climbing until it meets the rest of their life. */
export function RunwayChart({ points, answer, lastAge }: { points: RunwayPoint[]; answer: Answer; lastAge: number }) {
  const [at, setAt] = useState<number | null>(null);
  if (points.length < 2) return null;
  const shown = points[Math.min(points.length - 1, at ?? 0)];
  const value = (p: RunwayPoint, key: "months" | "left_months") => Math.max(1, key === "left_months" || p.exact_months === null ? p.left_months : coordinate(p.exact_months));
  const low = Math.max(1, Math.min(...points.map((p) => value(p, "months")))) / 1.3,
    high = Math.max(...points.map((p) => p.left_months)) * 1.25;
  const move = (delta: number) => setAt((before) => Math.max(0, Math.min(points.length - 1, (before ?? 0) + delta)));
  const label = `Runway by the age you stop. It is ${runwayText(points[0].months).toLowerCase()} today${
    answer.first ? ` and reaches the rest of your life at ${answer.first.age}` : ` and does not reach the rest of your life before ${lastAge}`
  }.`;
  return (
    <>
      <div
        className="ret-cross"
        tabIndex={0}
        role="group"
        aria-label="Read the chart with the left and right arrow keys"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          move(event.key === "ArrowRight" ? 2 : -2);
        }}
        onPointerLeave={() => setAt(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const inside = Math.max(0, Math.min(1, (event.clientX - box.left - 46) / (box.width - 60)));
          const age = coordinate(points[0].age) + inside * (coordinate(points[points.length - 1].age) - coordinate(points[0].age));
          let best = 0;
          points.forEach((p, i) => {
            if (Math.abs(coordinate(p.age) - age) < Math.abs(coordinate(points[best].age) - age)) best = i;
          });
          setAt(best);
        }}
      >
        <Frame height={310} label={label}>
          {(W, H) => {
            const left = 46,
              right = W - 14,
              top = 16,
              bottom = H - 22;
            const x0 = coordinate(points[0].age),
              x1 = coordinate(points[points.length - 1].age);
            const x = (age: number) => left + ((age - x0) / (x1 - x0 || 1)) * (right - left);
            const y = (v: number) => top + ((Math.log(high) - Math.log(Math.max(v, low))) / (Math.log(high) - Math.log(low))) * (bottom - top);
            const line = (key: "months" | "left_months") =>
              points.map((p, i) => `${i ? "L" : "M"}${x(coordinate(p.age)).toFixed(1)},${y(value(p, key)).toFixed(1)}`).join("");
            const step = x1 - x0 > 50 ? 10 : x1 - x0 > 22 ? 5 : 2;
            const ticks: number[] = [];
            for (let age = Math.ceil(x0 / step) * step; age <= x1; age += step) ticks.push(age);
            const met = answer.first && points.find((p) => p.month === answer.first!.month);
            return (
              <>
                {RUNWAY_TICKS.filter(([v]) => v >= low && v <= high).map(([v, text]) => (
                  <g key={v}>
                    <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--hairline)" />
                    <text x={left - 6} y={y(v) + 3.5} textAnchor="end">
                      {text}
                    </text>
                  </g>
                ))}
                {ticks.map((age) => (
                  <text key={age} x={x(age)} y={bottom + 16} textAnchor="middle">
                    {age}
                  </text>
                ))}
                <path d={line("left_months")} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" />
                <path d={line("months")} fill="none" stroke="var(--btc)" strokeWidth="2.5" />
                {met && (
                  <g>
                    <circle cx={x(coordinate(met.age))} cy={y(met.left_months)} r={5} fill="var(--btc)" stroke="var(--panel)" strokeWidth={2} />
                    <text className="ret-mark" x={Math.max(left + 10, Math.min(right - 8, x(coordinate(met.age))))} y={y(met.left_months) - 12} textAnchor="middle">
                      {answer.first!.age}
                    </text>
                  </g>
                )}
                {at !== null && <line x1={x(coordinate(shown.age))} x2={x(coordinate(shown.age))} y1={top} y2={bottom} stroke="var(--ink-2)" />}
              </>
            );
          }}
        </Frame>
      </div>
      <div className="sub" role="status">
        {`If you stop at ${Math.floor(coordinate(shown.age))}, ${monthYear(shown.date)}: runway ${runwayText(shown.months).toLowerCase()}.`}
      </div>
    </>
  );
}

/** Yearly costs, recorded and projected. Labels are rounded; exact figures are in each bar's title. */
export function YearBars({
  label,
  unit,
  rows,
  exact,
}: {
  label: string;
  unit: "USD" | "BITCOIN";
  rows: { year: number; value: string; planned?: boolean }[];
  exact: (value: string) => string;
}) {
  const high = Math.max(...rows.map((row) => coordinate(row.value)), 0) || 1;
  return (
    <Frame height={150} label={`${label}: ${rows.map((row) => `${row.year} ${exact(row.value)}${row.planned ? " projected" : ""}`).join(", ")}`}>
      {(W, H) => {
        const top = 18,
          bottom = H - 18,
          slot = (W - 4) / rows.length,
          width = Math.min(40, slot - 6),
          narrow = slot < 40;
        return (
          <>
            <line x1={0} x2={W} y1={bottom} y2={bottom} stroke="var(--bezel)" />
            {rows.map((row, i) => {
              const tall = Math.max(1, (coordinate(row.value) / high) * (bottom - top)),
                x = 2 + slot * i + (slot - width) / 2;
              const ends = i === 0 || i === rows.length - 1 || (rows[i + 1]?.planned && !row.planned);
              return (
                <g key={row.year}>
                  <rect
                    x={x}
                    y={bottom - tall}
                    width={Math.max(2, width)}
                    height={tall}
                    rx={2}
                    fill={row.planned ? "var(--plan-soft)" : unit === "USD" ? "var(--usd)" : "var(--btc)"}
                    stroke={row.planned ? "var(--plan)" : "none"}
                    strokeDasharray="3 3"
                  >
                    <Tip text={`${row.year}${row.planned ? " projected" : ""}: ${exact(row.value)}`} />
                  </rect>
                  {(!narrow || ends) && (
                    <text className={unit === "BITCOIN" ? "private" : undefined} x={x + width / 2} y={bottom - tall - 5} textAnchor="middle">
                      {compact(coordinate(row.value), unit)}
                    </text>
                  )}
                  {(!narrow || i % 2 === 0) && (
                    <text x={x + width / 2} y={H - 4} textAnchor="middle">
                      {narrow ? `’${String(row.year).slice(2)}` : row.year}
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
