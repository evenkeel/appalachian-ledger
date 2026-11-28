import { Frame } from "../dashboard/charts";
import { Scrub, axisLabels } from "../design/timeline";
import { btc, btcShort, coordinate, monthYear, usd } from "../lib/format";

/** One month of the stack, from GET /api/stack/history. The buy figures are absent only on the
    six-month reading the dashboard already carries, which stands in while the long one loads. */
export interface StackMonth {
  month: string;
  held: string;
  stack_rate: string | null;
  buys?: number;
  bought?: string;
  paid_usd?: string;
}

/** What was bought in a month, in words: "bought ₿412,331 for $400.00". Empty when the reading has no buy figures. */
const bought = (point: StackMonth) => (point.bought === undefined ? "" : point.buys ? `bought ${btc(point.bought)} for ${usd(point.paid_usd)}` : "no buys");

export const heldReading = (point: StackMonth, current: boolean) => `${monthYear(point.month)}: held ${btc(point.held)}${current ? " so far" : ""}${bought(point) ? `, ${bought(point)}` : ""}`;
export const rateReading = (point: StackMonth, current: boolean) =>
  `${monthYear(point.month)}: ${point.stack_rate === null ? "no income recorded, so no rate" : `${point.stack_rate}% of income stacked${current ? " so far" : ""}`}${bought(point) && point.buys ? `, ${bought(point)}` : ""}`;

/** Round steps for an axis that starts at zero: about `count` of them, on 1, 2 or 5. */
function steps(top: number, count: number) {
  const raw = top / count,
    power = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 5, 10].map((lead) => lead * power).find((value) => value >= raw) ?? raw;
  const marks: number[] = [];
  for (let value = step; value <= top * 1.001; value += step) marks.push(value);
  return marks;
}

/** Bitcoin held at each month end over the months given. Needs at least two. `at` is the month being read. */
export function HeldChart({ months, latest, at, onAt }: { months: StackMonth[]; latest: string; at: number | null; onAt: (index: number | null) => void }) {
  const first = months[0],
    last = months[months.length - 1];
  const n = months.length;
  const left = 44,
    right = 10;
  const mark = at === null ? null : Math.min(at, n - 1);
  return (
    <Scrub
      label={`Bitcoin held by month, ${monthYear(first.month)} to ${monthYear(last.month)}. Arrow keys read each month.`}
      count={n}
      at={mark}
      onAt={onAt}
      text={(index) => heldReading(months[index], months[index].month === latest)}
      left={left}
      right={right}
    >
      <Frame height={170} label={`Bitcoin held at each month end, ${monthYear(first.month)} ${btc(first.held)} to ${monthYear(last.month)} ${btc(last.held)}.`}>
        {(W, H) => {
          const values = months.map((point) => coordinate(point.held));
          const low = Math.min(...values),
            high = Math.max(...values);
          // A long view starts at zero so the climb is in proportion; a short one zooms in to show the months apart.
          const zero = n > 13 || low <= 0;
          const room = (high - low || high || 1) * 0.12;
          const lo = zero ? Math.min(0, low) : Math.max(0, low - room),
            hi = high + (zero ? high * 0.08 : room);
          const top = 10,
            bottom = H - 20;
          const x = (i: number) => left + (i / (n - 1)) * (W - left - right);
          const y = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
          const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
          const lines = zero ? steps(high, H > 150 ? 3 : 2) : [high, low];
          const labels = axisLabels(
            months.map((point) => point.month),
            x,
            { right: W - 2 },
          );
          return (
            <>
              {lines.map((value) => (
                <g key={value}>
                  <line x1={left} x2={W - right} y1={y(value)} y2={y(value)} stroke="var(--hairline)" />
                  <text x={left - 6} y={y(value) + 3.5} textAnchor="end">
                    {btcShort(value)}
                  </text>
                </g>
              ))}
              {zero && (
                <text x={left - 6} y={bottom + 3.5} textAnchor="end">
                  0
                </text>
              )}
              {months.map((point, i) => point.month.endsWith("-01") && i > 0 && <line key={point.month} x1={x(i)} x2={x(i)} y1={top - 4} y2={bottom + 12} stroke="var(--hairline)" />)}
              <path d={`${d}V${bottom}H${x(0)}Z`} fill="var(--btc-soft)" />
              <line x1={left} x2={W - right} y1={bottom} y2={bottom} stroke="var(--bezel)" />
              <path d={d} fill="none" stroke="var(--btc)" strokeWidth="2" strokeLinejoin="round" />
              {n <= 13 && months.map((point, i) => <circle key={point.month} cx={x(i)} cy={y(values[i])} r={i === n - 1 ? 3.5 : 2.5} fill="var(--btc)" />)}
              {n > 13 && <circle cx={x(n - 1)} cy={y(values[n - 1])} r="3.5" fill="var(--btc)" />}
              {labels.map((label) => (
                <text key={label.index} x={label.x} y={H - 4} textAnchor={label.anchor} className={label.year ? "lbl" : undefined}>
                  {label.text}
                </text>
              ))}
              {mark !== null && (
                <g>
                  <line x1={x(mark)} x2={x(mark)} y1={top - 4} y2={bottom} stroke="var(--ink-2)" />
                  <circle cx={x(mark)} cy={y(values[mark])} r="4" fill="var(--btc)" stroke="var(--panel)" strokeWidth="1.5" />
                </g>
              )}
            </>
          );
        }}
      </Frame>
    </Scrub>
  );
}

/** Stack rate by month over the months given. A year or less labels every bar; a longer view draws the bars
    alone and marks the years. Needs at least one month with income. */
export function RateChart({ months, latest, at, onAt }: { months: StackMonth[]; latest: string; at: number | null; onAt: (index: number | null) => void }) {
  const known = months.filter((point) => point.stack_rate !== null);
  const average = known.reduce((sum, point) => sum + Number(point.stack_rate), 0) / known.length;
  const n = months.length;
  const few = n <= 13;
  const mark = at === null ? null : Math.min(at, n - 1);
  return (
    <Scrub
      className="stk-rate-chart"
      label={`Stack rate by month, ${monthYear(months[0].month)} to ${monthYear(months[n - 1].month)}, higher is better. Arrow keys read each month.`}
      count={n}
      at={mark}
      onAt={onAt}
      text={(index) => rateReading(months[index], months[index].month === latest)}
      slots
    >
      <Frame
        style={{ flex: 1, minHeight: 170 }}
        label={
          few
            ? `Stack rate by month, higher is better. ${months.map((p) => `${monthYear(p.month)} ${p.stack_rate === null ? "no income recorded" : `${p.stack_rate}%`}`).join(", ")}.`
            : `Stack rate by month, ${monthYear(months[0].month)} to ${monthYear(months[n - 1].month)}, higher is better. Average ${average.toFixed(1)}%.`
        }
      >
        {(W, H) => {
          const top = Math.max(...known.map((point) => Number(point.stack_rate)), 1) * 1.08;
          const slot = W / n,
            bar = Math.max(1.5, Math.min(54, slot * (few ? 0.62 : 0.72)));
          const base = H - 20,
            head = 16;
          const y = (v: number) => head + (1 - v / top) * (base - head);
          const centre = (i: number) => slot * i + slot / 2;
          // Figures over the bars only while a bar is wide enough to carry one; the reading below has them all.
          const figures = few && slot >= 36;
          const labels = axisLabels(
            months.map((point) => point.month),
            centre,
            { yearX: (i) => slot * i, left: 0, right: W, startAtEdge: false, room: few ? 22 : 34 },
          );
          return (
            <>
              <line x1="0" x2={W} y1={base} y2={base} stroke="var(--bezel)" />
              {/* Under the bars and their figures, so the average never strikes through a number. */}
              {known.length > 1 && <line x1="0" x2={W} y1={y(average)} y2={y(average)} stroke="var(--ink-3)" strokeDasharray="2 3" />}
              {!few && months.map((point, i) => point.month.endsWith("-01") && i > 0 && <line key={point.month} x1={slot * i} x2={slot * i} y1={head - 8} y2={base + 12} stroke="var(--hairline)" />)}
              {months.map((point, i) => {
                const cx = centre(i),
                  current = point.month === latest,
                  lit = current || mark === i;
                return (
                  <g key={point.month}>
                    {point.stack_rate !== null ? (
                      <>
                        <rect
                          x={cx - bar / 2}
                          y={y(Number(point.stack_rate))}
                          width={bar}
                          height={Math.max(1, base - y(Number(point.stack_rate)))}
                          rx={few ? 3 : Math.min(2, bar / 3)}
                          fill="var(--btc)"
                          opacity={lit ? 1 : few ? 0.42 : 0.55}
                        />
                        {figures && (
                          <text x={cx} y={y(Number(point.stack_rate)) - 4} textAnchor="middle" className="lbl" style={{ paintOrder: "stroke", stroke: "var(--panel)", strokeWidth: 4, ...(current ? { fill: "var(--btc)", fontWeight: 700 } : {}) }}>
                            {point.stack_rate}%
                          </text>
                        )}
                      </>
                    ) : (
                      figures && (
                        <text x={cx} y={base - 6} textAnchor="middle">
                          —
                        </text>
                      )
                    )}
                  </g>
                );
              })}
              {labels.map((label) => (
                <text key={label.index} x={label.x} y={H - 4} textAnchor={label.anchor} className={label.year ? "lbl" : undefined}>
                  {label.text}
                </text>
              ))}
              {mark !== null && !few && <line x1={centre(mark)} x2={centre(mark)} y1={head - 8} y2={base} stroke="var(--ink-2)" opacity="0.6" />}
            </>
          );
        }}
      </Frame>
    </Scrub>
  );
}
