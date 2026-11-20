import { Frame } from "../dashboard/charts";
import type { DashboardData } from "../dashboard/types";
import { btc, btcShort, coordinate, longMonth, monthName } from "../lib/format";

type Stack = DashboardData["stack"];

/** Month-end bitcoin held, at full size. Needs at least two months. */
export function HeldChart({ history }: { history: Stack["history"] }) {
  const first = history[0],
    last = history[history.length - 1];
  return (
    <Frame height={150} label={`Bitcoin held at each month end, ${longMonth(first.month)} ${btc(first.held)} to ${longMonth(last.month)} ${btc(last.held)}.`}>
      {(W, H) => {
        const values = history.map((point) => coordinate(point.held));
        const low = Math.min(...values),
          high = Math.max(...values);
        const room = (high - low || high || 1) * 0.12;
        const lo = Math.max(0, low - room),
          hi = high + room;
        const left = 44,
          right = 8,
          top = 10,
          bottom = H - 18;
        const n = history.length;
        const x = (i: number) => left + (i / (n - 1)) * (W - left - right);
        const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
        const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
        // Month names thin out before they collide.
        const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - left - right) / 40))));
        return (
          <>
            {[high, low].map((value, index) => (
              <g key={index}>
                <line x1={left} x2={W - right} y1={y(value)} y2={y(value)} stroke="var(--hairline)" />
                <text x={left - 6} y={y(value) + 3.5} textAnchor="end">
                  {btcShort(value)}
                </text>
              </g>
            ))}
            <path d={`${d}V${bottom}H${x(0)}Z`} fill="var(--btc-soft)" />
            <path d={d} fill="none" stroke="var(--btc)" strokeWidth="2" />
            {history.map((point, i) => (
              <g key={point.month}>
                <circle cx={x(i)} cy={y(values[i])} r={i === n - 1 ? 3.5 : 2.5} fill="var(--btc)">
                  <title>{`${longMonth(point.month)}: ${btc(point.held)}${i === n - 1 ? " so far" : ""}`}</title>
                </circle>
                {(i === n - 1 || (i % every === 0 && n - 1 - i >= every)) && (
                  <text x={x(i)} y={H - 3} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className={i === n - 1 ? "lbl" : undefined}>
                    {monthName(point.month)}
                  </text>
                )}
              </g>
            ))}
          </>
        );
      }}
    </Frame>
  );
}

/** Stack rate by month, every bar labelled with its figure. Needs at least one month with income. */
export function RateChart({ rates }: { rates: Stack["rates"] }) {
  const known = rates.filter((point) => point.rate !== null);
  const average = known.reduce((sum, point) => sum + Number(point.rate), 0) / known.length;
  return (
    <Frame
      className="stk-rate-chart"
      height={170}
      label={`Stack rate by month, higher is better. ${rates.map((p) => `${longMonth(p.month)} ${p.rate === null ? "no income recorded" : `${p.rate}%`}`).join(", ")}.`}
    >
      {(W, H) => {
        const n = rates.length;
        const top = Math.max(...known.map((point) => Number(point.rate)), 1) * 1.08;
        const slot = W / n,
          bar = Math.min(54, slot * 0.62);
        const base = H - 18,
          head = 16;
        const y = (v: number) => head + (1 - v / top) * (base - head);
        return (
          <>
            <line x1="0" x2={W} y1={base} y2={base} stroke="var(--bezel)" />
            {rates.map((point, i) => {
              const cx = slot * i + slot / 2,
                current = i === n - 1;
              return (
                <g key={point.month}>
                  {point.rate !== null ? (
                    <>
                      <rect x={cx - bar / 2} y={y(Number(point.rate))} width={bar} height={Math.max(1, base - y(Number(point.rate)))} rx="3" fill="var(--btc)" opacity={current ? 1 : 0.42}>
                        <title>{`${longMonth(point.month)}: ${point.rate}% of income stacked${current ? " so far" : ""}`}</title>
                      </rect>
                      <text x={cx} y={y(Number(point.rate)) - 4} textAnchor="middle" className="lbl" style={current ? { fill: "var(--btc)", fontWeight: 700 } : undefined}>
                        {point.rate}%
                      </text>
                    </>
                  ) : (
                    <text x={cx} y={base - 6} textAnchor="middle">
                      <title>{`${longMonth(point.month)}: no income recorded, so no rate`}</title>—
                    </text>
                  )}
                  <text x={cx} y={H - 3} textAnchor="middle" className={current ? "lbl" : undefined}>
                    {monthName(point.month)}
                  </text>
                </g>
              );
            })}
            {known.length > 1 && (
              <line x1="0" x2={W} y1={y(average)} y2={y(average)} stroke="var(--ink-3)" strokeDasharray="2 3">
                <title>{`Average of the months shown: ${average.toFixed(1)}%`}</title>
              </line>
            )}
          </>
        );
      }}
    </Frame>
  );
}
