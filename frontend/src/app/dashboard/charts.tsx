/* Hand-built SVG charts. Numbers are used for coordinates only; every label and
   title is formatted from the exact decimal string the API returned. */
import type { ReactNode } from "react";
import { btc, btcShort, coordinate, daysBetween, monthName, shortDate, usd, usdWhole } from "../lib/format";
import type { Lens } from "../lib/session";
import { useSize } from "../lib/useSize";
import type { Bill, DashboardData } from "./types";

function Frame({
  height,
  label,
  className = "",
  style,
  children,
}: {
  height?: number;
  label: string;
  className?: string;
  style?: React.CSSProperties;
  children: (width: number, height: number) => ReactNode;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className={`chart ${className}`} style={{ height, ...style }}>
      {size.width > 0 && size.height > 0 && (
        <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={label} preserveAspectRatio="none">
          {children(size.width, size.height)}
        </svg>
      )}
    </div>
  );
}

/** Cash ahead: projected checking balance against known bills and planned paychecks. */
export function CashAheadChart({ data }: { data: DashboardData }) {
  const cash = data.cash_ahead,
    days = cash.horizon_days;
  const short = cash.short !== null;
  const label = short
    ? `Projected checking balance. Falls short by ${usd(cash.short!.amount)} from ${shortDate(cash.short!.date)}.`
    : `Projected checking balance. Lowest point ${usd(cash.low.balance)} on ${shortDate(cash.low.date)}.`;
  return (
    <Frame height={150} label={label}>
      {(W, H) => {
        const pad = { l: 6, r: 6, t: 20, b: short ? 26 : 20 };
        const day = (iso: string) => Math.max(0, Math.min(days, daysBetween(data.today, iso)));
        const x = (d: number) => pad.l + (d / days) * (W - pad.l - pad.r);
        const start = coordinate(cash.start);
        const balances = cash.events.map((event) => coordinate(event.balance_after));
        const hi = Math.max(start, ...balances, 1) * 1.08;
        const lo = Math.min(0, ...balances) * 2.4;
        const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
        const firstPay = cash.next_paycheck ? day(cash.next_paycheck.date) : days;
        const maxBill = Math.max(1, ...cash.events.filter((e) => e.kind === "bill").map((e) => coordinate(e.amount)));
        let before = `M${x(0)},${y(start)}`,
          after = "",
          balance = start,
          paid = false;
        const marks: ReactNode[] = [],
          pays: ReactNode[] = [];
        cash.events.forEach((event, index) => {
          const ex = x(day(event.date)),
            next = coordinate(event.balance_after);
          if (event.kind === "paycheck") {
            if (!paid) before += `H${ex}`;
            else after += `H${ex}V${y(next)}`;
            if (!paid) after = `M${ex},${y(next)}`;
            pays.push(
              <g key={`p${index}`}>
                <line x1={ex} x2={ex} y1={pad.t - 8} y2={H - pad.b} stroke="var(--plan)" strokeDasharray="3 3" />
                <line x1={ex} x2={ex} y1={y(balance)} y2={y(next)} stroke="var(--plan)" strokeWidth="2" />
                <text x={Math.min(ex + 4, W - 78)} y={pad.t - 9} style={{ fill: "var(--plan)" }}>
                  Payday {shortDate(event.date)}
                </text>
                <circle cx={ex} cy={y(next)} r="7" fill="transparent">
                  <title>{`Planned: ${event.name} ${usd(event.amount)} on ${shortDate(event.date)}. Not recorded yet.`}</title>
                </circle>
              </g>,
            );
            paid = true;
          } else {
            const segment = `H${ex}V${y(next)}`;
            if (paid) after += segment;
            else before += segment;
            const amount = coordinate(event.amount),
              radius = 2.5 + 4.5 * Math.sqrt(amount / maxBill);
            if (amount >= maxBill * 0.95 && day(event.date) < firstPay) {
              const left = x(firstPay) - ex < 110 && ex > 110;
              marks.push(
                <text
                  key={`l${index}`}
                  x={left ? ex - 6 : ex + radius + 4}
                  y={(left ? y(balance) : y(next)) - 6}
                  textAnchor={left ? "end" : "start"}
                >
                  {event.name}
                </text>,
              );
            }
            marks.push(
              <circle
                key={`b${index}`}
                cx={ex}
                cy={y(next)}
                r={radius}
                fill="var(--panel)"
                stroke={event.overdue ? "var(--warn)" : "var(--usd)"}
                strokeWidth="1.6"
              >
                <title>{`${event.name} ${usd(event.amount)}, ${event.overdue ? "overdue" : `due ${shortDate(event.date)}`}. Balance after ${usd(event.balance_after)}.`}</title>
              </circle>,
            );
          }
          balance = next;
        });
        if (paid) after += `H${x(days)}`;
        else before += `H${x(days)}`;
        const y0 = y(0);
        const whole =
          `M${x(0)},${y(start)}` +
          cash.events.map((e) => `H${x(day(e.date))}V${y(coordinate(e.balance_after))}`).join("") +
          `H${x(days)}`;
        const lowX = x(day(cash.low.date)),
          lowY = y(coordinate(cash.low.balance));
        return (
          <>
            {short && (
              <>
                <defs>
                  <clipPath id="cash-below">
                    <rect x="0" y={y0} width={W} height={H} />
                  </clipPath>
                  <pattern id="cash-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="3" height="6" fill="var(--warn)" />
                  </pattern>
                </defs>
                <path d={`${whole}V${y0}H${x(0)}Z`} fill="url(#cash-hatch)" opacity=".55" clipPath="url(#cash-below)" />
              </>
            )}
            <line x1={pad.l} x2={W - pad.r} y1={y0} y2={y0} stroke="var(--bezel)" />
            <text x={W - pad.r} y={y0 - 4} textAnchor="end">
              $0
            </text>
            {pays}
            <path d={before} fill="none" stroke="var(--usd)" strokeWidth="2" strokeLinejoin="round" />
            {after && (
              <path d={after} fill="none" stroke="var(--usd)" strokeWidth="2" strokeDasharray="5 4" opacity=".75" />
            )}
            {marks}
            <circle cx={x(0)} cy={y(start)} r="4" fill="var(--usd)" />
            {short ? (
              <text
                className="lbl"
                x={(x(day(cash.short!.date)) + x(firstPay)) / 2}
                y={lowY + 16}
                textAnchor="middle"
                style={{ fill: "var(--warn)", fontWeight: 700 }}
              >
                Short {usd(cash.short!.amount)}
              </text>
            ) : (
              cash.events.length > 0 && (
                <text className="lbl" x={Math.max(lowX - 10, 96)} y={lowY + 15} textAnchor="end" style={{ fontWeight: 700 }}>
                  Low {usd(cash.low.balance)}
                </text>
              )
            )}
            {[0, 7, 14, 21, 28].map((d) => (
              <text key={d} x={x(d)} y={H - 5} textAnchor={d ? "middle" : "start"}>
                {d ? shortDate(addDay(data.today, d)) : "Today"}
              </text>
            ))}
          </>
        );
      }}
    </Frame>
  );
}

function addDay(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Bills lane: 30 days left to right. Further left is sooner; a bigger target is a bigger bill. */
export function BillsLane({
  data,
  gone,
  onPick,
}: {
  data: DashboardData;
  gone: { id: number; mode: "pay" | "destroy" | "payoff" } | null;
  onPick: (bill: Bill) => void;
}) {
  const bills = data.bills.items.filter((bill) => bill.days_until <= 30);
  const late = bills.filter((bill) => bill.overdue),
    upcoming = bills.filter((bill) => !bill.overdue);
  const paydays = data.cash_ahead.events.filter((event) => event.kind === "paycheck");
  return (
    <Frame
      height={104}
      label={`${upcoming.length} bills in the next 30 days${late.length ? `, ${late.length} past due` : ""}. Nearest is furthest left.`}
    >
      {(W, H) => {
        const zone = late.length ? 62 : 16;
        const x = (d: number) => zone + (d / 30) * (W - zone - 24);
        const cy = (H - 16) / 2 + 4;
        const max = Math.max(1, ...bills.map((bill) => coordinate(bill.amount)));
        const size = (bill: Bill) => 12 + 24 * Math.sqrt(coordinate(bill.amount) / max);
        const target = (bill: Bill, tx: number, ty: number) => {
          const s = size(bill),
            going = gone?.id === bill.id,
            colour = bill.overdue ? "var(--warn)" : "var(--usd)";
          return (
            <g
              key={bill.id}
              transform={`translate(${tx.toFixed(1)},${ty.toFixed(1)})`}
              className="target"
              role="button"
              tabIndex={0}
              aria-label={`${bill.name}, ${usd(bill.amount)}, ${bill.overdue ? `${-bill.days_until} days overdue` : `due ${shortDate(bill.due_date)}`}`}
              onClick={() => onPick(bill)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPick(bill);
                }
              }}
            >
              <title>{`${bill.name} ${usd(bill.amount)}. ${bill.overdue ? `${-bill.days_until} days overdue` : `Due ${shortDate(bill.due_date)}, in ${bill.days_until} days`}. Select to pay, or destroy it for good.`}</title>
              <g className={going ? (gone!.mode === "pay" ? "hit" : "boom") : ""}>
                <circle
                  r={s / 2}
                  fill={bill.overdue ? "var(--warn)" : "var(--usd-soft)"}
                  stroke={colour}
                  strokeWidth="1.6"
                  strokeDasharray={bill.pays_account_id ? "4 3" : undefined}
                />
                {s > 22 && (
                  <circle r={s * 0.29} fill="none" stroke={bill.overdue ? "var(--lamp-on-ink)" : colour} strokeWidth="1.2" />
                )}
                <circle r={Math.max(1.8, s * 0.1)} fill={bill.overdue ? "var(--lamp-on-ink)" : colour} />
              </g>
              {going && gone!.mode !== "pay" && (
                <g className="burst">
                  {Array.from({ length: 8 }, (_, k) => {
                    const a = (k * Math.PI) / 4;
                    return (
                      <line
                        key={k}
                        x1={Math.cos(a) * s * 0.7}
                        y1={Math.sin(a) * s * 0.7}
                        x2={Math.cos(a) * s * 1.25}
                        y2={Math.sin(a) * s * 1.25}
                        stroke="var(--ink)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    );
                  })}
                </g>
              )}
            </g>
          );
        };
        let previousX = -99,
          previousSize = 0,
          flip = 1;
        return (
          <>
            <line x1={zone} x2={W} y1={cy} y2={cy} stroke="var(--hairline)" />
            {late.length > 0 && (
              <>
                <rect x="0" y="6" width={zone - 8} height={H - 26} rx="6" fill="var(--warn)" opacity=".14" />
                <text x={(zone - 8) / 2} y={H - 4} textAnchor="middle" style={{ fill: "var(--warn)", fontWeight: 700 }}>
                  Past due
                </text>
              </>
            )}
            <line x1={x(0)} x2={x(0)} y1="6" y2={H - 18} stroke="var(--ink-2)" strokeWidth="1.5" />
            {[0, 7, 14, 21, 28].map((d) => (
              <text key={d} x={x(d)} y={H - 4} textAnchor={d ? "middle" : "start"} className={d ? undefined : "lbl"}>
                {d ? shortDate(addDay(data.today, d)) : "Today"}
              </text>
            ))}
            {paydays.map((pay, index) => {
              const px = x(daysBetween(data.today, pay.date));
              return (
                <g key={index}>
                  <line x1={px} x2={px} y1="16" y2={H - 18} stroke="var(--plan)" strokeDasharray="3 3" />
                  <text x={px} y="11" textAnchor="middle" style={{ fill: "var(--plan)" }}>
                    <title>{`Planned paycheck ${usd(pay.amount)} on ${shortDate(pay.date)}. It reloads your ammo.`}</title>
                    Reload +{usdWhole(pay.amount)}
                  </text>
                </g>
              );
            })}
            {late.map((bill, index) => target(bill, (zone - 8) / 2 + index * 8, cy))}
            {upcoming.map((bill) => {
              const tx = x(bill.days_until),
                s = size(bill),
                crowded = tx - previousX < (s + previousSize) / 2 + 3;
              const node = target(bill, tx, crowded ? cy + flip * 15 : cy);
              flip = crowded ? -flip : 1;
              previousX = tx;
              previousSize = s;
              return node;
            })}
          </>
        );
      }}
    </Frame>
  );
}

/** Vertical tape centred on bitcoin held, showing this month's climb. */
export function StackTape({ stack }: { stack: DashboardData["stack"] }) {
  const held = coordinate(stack.held),
    start = coordinate(stack.month_start);
  return (
    <Frame
      label={`Bitcoin held ${btc(stack.held)}, from ${btc(stack.month_start)} at the start of the month.`}
      style={{ width: 74, height: 132, flex: "none" }}
    >
      {(W, H) => {
        // Enough range to show this month's change, on a round step.
        const span = niceSpan(Math.max(Math.abs(held - start) * 2.2, held * 0.02, 1000));
        const step = span / 6;
        const y = (v: number) => H / 2 - ((v - held) / span) * (H / 2);
        const ticks: ReactNode[] = [];
        for (let v = Math.ceil((held - span) / step) * step; v <= held + span; v += step) {
          const ty = y(v),
            major = Math.round(v / step) % 2 === 0;
          if (ty < 8 || ty > H - 4) continue;
          ticks.push(<line key={`t${v}`} x1={W - (major ? 14 : 8)} x2={W} y1={ty} y2={ty} stroke="var(--ink-3)" />);
          if (major && Math.abs(ty - H / 2) > 11 && v >= 0)
            ticks.push(
              <text key={`n${v}`} x={W - 18} y={ty + 3.5} textAnchor="end">
                {btcShort(v)}
              </text>,
            );
        }
        const y1 = Math.max(4, Math.min(H - 4, y(start))),
          yc = H / 2;
        return (
          <>
            <rect x="0" y="0" width={W} height={H} rx="6" fill="var(--well)" stroke="var(--hairline)" />
            <rect x={W - 6} y={Math.min(yc, y1)} width="6" height={Math.abs(y1 - yc)} fill="var(--btc)">
              <title>{`This month: ${btc(stack.month_start)} to ${btc(stack.held)}`}</title>
            </rect>
            {ticks}
            <path d={`M0,${yc - 10}H${W - 16}L${W - 7},${yc}L${W - 16},${yc + 10}H0Z`} fill="var(--panel-2)" stroke="var(--btc)" strokeWidth="1.2" />
            <text x={W - 21} y={yc + 4} textAnchor="end" style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 700 }}>
              {btcShort(held)}
            </text>
          </>
        );
      }}
    </Frame>
  );
}
function niceSpan(value: number) {
  const power = 10 ** Math.floor(Math.log10(value));
  const lead = value / power;
  return (lead <= 1.5 ? 1.5 : lead <= 3 ? 3 : lead <= 6 ? 6 : 12) * power;
}

/** Month-end bitcoin held. */
export function StackSpark({ history }: { history: DashboardData["stack"]["history"] }) {
  if (history.length < 2) return null;
  return (
    <Frame height={42} label={`Bitcoin held by month, ${monthName(history[0].month)} to ${monthName(history[history.length - 1].month)}.`}>
      {(W, H) => {
        const values = history.map((point) => coordinate(point.held));
        const lo = Math.min(...values),
          hi = Math.max(...values);
        const x = (i: number) => 4 + (i / (history.length - 1)) * (W - 8);
        const y = (v: number) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 22);
        const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
        return (
          <>
            <path d={`${d}V${H - 12}H${x(0)}Z`} fill="var(--btc-soft)" />
            <path d={d} fill="none" stroke="var(--btc)" strokeWidth="1.8" />
            {history.map((point, i) => (
              <circle key={point.month} cx={x(i)} cy={y(values[i])} r="2" fill="var(--btc)">
                <title>{`${monthName(point.month)}: ${btc(point.held)}`}</title>
              </circle>
            ))}
            <text x={x(0)} y={H - 1}>
              {monthName(history[0].month)}
            </text>
            <text x={x(history.length - 1)} y={H - 1} textAnchor="end">
              {monthName(history[history.length - 1].month)}
            </text>
          </>
        );
      }}
    </Frame>
  );
}

/** Stack rate: share of income stacked each month. Higher is better. */
export function StackRateBars({ rates }: { rates: DashboardData["stack"]["rates"] }) {
  const known = rates.filter((point) => point.rate !== null);
  if (!known.length) return null;
  return (
    <Frame height={50} label={`Stack rate by month. ${known.map((p) => `${monthName(p.month)} ${p.rate}%`).join(", ")}.`}>
      {(W, H) => {
        const n = rates.length;
        const top = Math.max(...known.map((p) => Number(p.rate)), 1) * 1.1;
        const bar = Math.min(26, (W - 4) / n - 5);
        const stepX = n > 1 ? (W - bar) / (n - 1) : 0;
        const y = (v: number) => 2 + (1 - v / top) * (H - 16);
        const average = known.reduce((sum, p) => sum + Number(p.rate), 0) / known.length;
        return (
          <>
            {rates.map((point, i) => (
              <g key={point.month}>
                {point.rate !== null && (
                  <rect
                    x={i * stepX}
                    y={y(Number(point.rate))}
                    width={bar}
                    height={H - 14 - y(Number(point.rate))}
                    rx="2"
                    fill="var(--btc)"
                    opacity={i === n - 1 ? 1 : 0.38}
                  >
                    <title>{`${monthName(point.month)}: ${point.rate}% of income stacked${i === n - 1 ? " so far" : ""}`}</title>
                  </rect>
                )}
                <text x={i * stepX + bar / 2} y={H - 2} textAnchor="middle" className={i === n - 1 ? "lbl" : undefined}>
                  {monthName(point.month)}
                </text>
              </g>
            ))}
            <line x1="0" x2={W} y1={y(average)} y2={y(average)} stroke="var(--ink-3)" strokeDasharray="2 3" />
          </>
        );
      }}
    </Frame>
  );
}

/** Spend pace: cumulative spending this month against the same days last month. */
export function PaceChart({ pace, lens, month }: { pace: DashboardData["pace"]; lens: Lens; month: string }) {
  const format = lens === "USD" ? usd : btc;
  const current = pace.current[lens],
    previous = pace.previous?.[lens] ?? null;
  const last = [...current].reverse().find((value) => value !== null) ?? null;
  const prior = monthName(shift(month, -1));
  return (
    <Frame
      className="grow-chart"
      style={{ flex: 1, minHeight: 118 }}
      label={`Cumulative spending this month: ${format(last)} through day ${pace.day}.`}
    >
      {(W, H) => {
        const pad = { l: 4, r: 4, t: 12, b: 18 },
          n = 31;
        const all = [...current, ...(previous ?? [])].filter((v): v is string => v !== null).map(Number);
        const hi = Math.max(1, ...all) * 1.08;
        const x = (d: number) => pad.l + ((d - 1) / (n - 1)) * (W - pad.l - pad.r);
        const y = (v: number) => pad.t + (1 - v / hi) * (H - pad.t - pad.b);
        const line = (series: (string | null)[]) => {
          let pen = false;
          return series
            .map((value, i) => {
              if (value === null) {
                pen = false;
                return "";
              }
              const segment = `${pen ? "L" : "M"}${x(i + 1)},${y(Number(value))}`;
              pen = true;
              return segment;
            })
            .join("");
        };
        const colour = lens === "USD" ? "var(--usd)" : "var(--btc)";
        const end = previous?.[previous.length - 1] ?? null;
        return (
          <>
            <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--bezel)" />
            {previous && (
              <>
                <path d={line(previous)} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="2 3" />
                {end !== null && (
                  <text x={W - pad.r} y={y(Number(end)) - 5} textAnchor="end">
                    {prior} {format(end)}
                  </text>
                )}
              </>
            )}
            <line x1={x(pace.day)} x2={x(pace.day)} y1={pad.t} y2={H - pad.b} stroke="var(--hairline)" />
            <path d={line(current)} fill="none" stroke={colour} strokeWidth="2.2" strokeLinejoin="round" />
            {last !== null && <circle cx={x(pace.day)} cy={y(Number(last))} r="4" fill={colour} />}
            {current.map(
              (value, i) =>
                value !== null && (
                  <circle key={i} cx={x(i + 1)} cy={y(Number(value))} r="6" fill="transparent">
                    <title>{`Day ${i + 1}: ${format(value)} so far${previous?.[i] != null ? `; ${prior} ${format(previous[i])}` : ""}`}</title>
                  </circle>
                ),
            )}
            <text x={x(1)} y={H - 4}>
              1
            </text>
            <text x={x(pace.day)} y={H - 4} textAnchor="middle" className="lbl">
              Today
            </text>
            <text x={x(31)} y={H - 4} textAnchor="end">
              31
            </text>
          </>
        );
      }}
    </Frame>
  );
}

export function shift(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
