/* Hand-built SVG charts. Numbers are used for coordinates only; every label and
   title is formatted from the exact decimal string the API returned. */
import { useId } from "react";
import type { ReactNode } from "react";
import { btc, btcShort, coordinate, daysBetween, longMonth, monthName, monthYear, plural, shortDate, usd } from "../lib/format";
import type { Lens } from "../lib/session";
import { Tip } from "../lib/privacy";
import { useSize } from "../lib/useSize";
import type { Bill, CashEvent, DashboardData } from "./types";

// Without layout (tests), charts draw at a nominal size so their labels can still be checked.
export const NO_LAYOUT = typeof ResizeObserver === "undefined";

export function Frame({
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
  const width = size.width || (NO_LAYOUT ? 600 : 0),
    tall = size.height || (NO_LAYOUT ? (height ?? 150) : 0);
  return (
    <div ref={ref} className={`chart ${className}`} style={{ height, ...style }}>
      {(width > 0 && tall > 0) && (
        <svg viewBox={`0 0 ${width} ${tall}`} role="img" aria-label={label} preserveAspectRatio="none">
          {children(width, tall)}
        </svg>
      )}
    </div>
  );
}

/** A payment to a credit card: the card paid off in full on its due day, or a bill that pays a card down. */
export const isCardPayment = (event: CashEvent) => event.kind === "card" || (event.kind === "bill" && event.account_id != null);

/** Checking forecast: the dollars in checking over the next 30 days, as one line. Bills step it down, each card
    payment is named with its amount and due date, and planned paychecks step it up. */
export function CashAheadChart({ data }: { data: DashboardData }) {
  const uid = useId().replace(/:/g, "");
  const cash = data.cash_ahead,
    days = cash.horizon_days;
  const short = cash.short;
  const cardName = (event: CashEvent) => cash.cards.find((card) => card.account_id === event.account_id)?.name ?? "the card";
  const label = [
    short
      ? `Projected checking balance. Falls short by ${usd(short.amount)} from ${shortDate(short.date)}.`
      : `Projected checking balance. Lowest point ${usd(cash.low.balance)} on ${shortDate(cash.low.date)}.`,
    ...cash.events.filter(isCardPayment).map((event) => `${event.name} ${usd(event.amount)} due ${shortDate(event.date)}.`),
  ].join(" ");
  return (
    <Frame height={184} label={label}>
      {(W, H) => {
        const day = (iso: string) => Math.max(0, Math.min(days, daysBetween(data.today, iso)));
        const x0 = 6,
          x1 = W - 6;
        const x = (d: number) => x0 + (d / days) * (x1 - x0);
        // Paydays and card payments are named along the top. A label that would run into another drops to the next row.
        const flags = cash.events
          .filter((event) => event.kind === "paycheck" || isCardPayment(event))
          .map((event) => {
            const pay = event.kind === "paycheck";
            const text = pay ? `Payday ${shortDate(event.date)}` : `${event.name} ${usd(event.amount)} · ${shortDate(event.date)}`;
            const ex = x(day(event.date)),
              wide = text.length * 5.9 + (pay ? 0 : 4);
            const flip = ex + 5 + wide > x1 && ex - 5 - wide >= x0;
            return { event, pay, ex, wide, flip, left: flip ? ex - 5 - wide : ex + 5, row: 0 };
          });
        flags.forEach((flag, index) => {
          const taken = (row: number) =>
            flags.slice(0, index).some((other) => other.row === row && flag.left < other.left + other.wide + 8 && other.left < flag.left + flag.wide + 8);
          while (flag.row < 4 && taken(flag.row)) flag.row += 1;
        });
        const rows = Math.max(1, ...flags.map((flag) => flag.row + 1));
        const top = 6 + rows * 13,
          bottom = H - 20;
        const start = coordinate(cash.start);
        const balances = cash.events.map((event) => coordinate(event.balance_after));
        const hi = Math.max(start, ...balances, 1) * 1.06;
        const lo = Math.min(0, ...balances) * 1.3;
        const y = (v: number) => top + 6 + (1 - (v - lo) / (hi - lo)) * (bottom - top - 6);
        const y0 = y(0);
        let line = `M${x(0)},${y(start)}`,
          balance = start;
        const steps: ReactNode[] = [],
          marks: ReactNode[] = [];
        // Where each event's step begins, from above: its guide comes down from the label and stops there.
        const reach = new Map<CashEvent, number>();
        cash.events.forEach((event, index) => {
          const ex = x(day(event.date)),
            next = coordinate(event.balance_after);
          line += `H${ex}V${y(next)}`;
          reach.set(event, Math.min(y(balance), y(next)));
          if (event.kind === "paycheck") {
            steps.push(<line key={`s${index}`} x1={ex} x2={ex} y1={y(balance)} y2={y(next)} stroke="var(--plan)" strokeWidth="2.5" strokeLinecap="round" />);
            marks.push(
              <circle key={`m${index}`} cx={ex} cy={y(next)} r="8" fill="transparent">
                <title>{`${event.estimate ? "Expected" : "Planned"}: ${event.name} ${event.estimate ? "about " : ""}${usd(event.amount)} on ${shortDate(event.date)}. ${event.estimate ? "The amount varies. " : ""}Not recorded yet. Checking after: ${usd(event.balance_after)}.`}</title>
              </circle>,
            );
          } else if (isCardPayment(event)) {
            const title =
              event.kind === "card"
                ? `${event.name} paid in full from checking on ${shortDate(event.date)}: ${usd(event.amount)}. That is ${
                    coordinate(event.owed_now) > 0
                      ? `${usd(event.owed_now)} owed today${event.charged_count ? ` plus ${plural(event.charged_count, "bill")} charged before then (${usd(event.charged)})` : ""}`
                      : `${plural(event.charged_count ?? 0, "bill")} charged since the last payment`
                  }. Checking after: ${usd(event.balance_after)}.`
                : `${event.name} ${usd(event.amount)}, ${event.overdue ? "overdue" : `due ${shortDate(event.date)}`}. It pays ${cardName(event)} down. Checking after: ${usd(event.balance_after)}.`;
            // The drop itself is drawn heavier, so a card payment reads as one clear step.
            steps.push(<line key={`s${index}`} x1={ex} x2={ex} y1={y(balance)} y2={y(next)} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />);
            marks.push(
              <g key={`m${index}`}>
                <circle cx={ex} cy={y(next)} r="4.5" fill="var(--ink)" stroke="var(--panel)" strokeWidth="1.5" />
                <circle cx={ex} cy={y(next)} r="9" fill="transparent">
                  <title>{title}</title>
                </circle>
              </g>,
            );
          } else {
            marks.push(
              <g key={`m${index}`}>
                <circle cx={ex} cy={y(next)} r="3" fill="var(--panel)" stroke={event.overdue ? "var(--warn)" : "var(--usd)"} strokeWidth="1.5" />
                <circle cx={ex} cy={y(next)} r="8" fill="transparent">
                  <title>{`${event.name} ${usd(event.amount)}, ${event.overdue ? "overdue" : `due ${shortDate(event.date)}`}. Checking after: ${usd(event.balance_after)}.`}</title>
                </circle>
              </g>,
            );
          }
          balance = next;
        });
        line += `H${x(days)}`;
        const area = `${line}V${y0}H${x(0)}Z`;
        // The lowest point is named beside itself, on whichever side is clear of the next payday or due date.
        const lowX = x(day(cash.low.date)),
          lowY = y(coordinate(cash.low.balance));
        const lowText = short ? `Short ${usd(short.amount)}` : `Low ${usd(cash.low.balance)}`,
          lowWide = lowText.length * 6.6;
        const stops = cash.events.map((event) => x(day(event.date)));
        const nextStop = Math.min(x1, ...stops.filter((px) => px > lowX + 1));
        const roomRight = nextStop - (lowX + 8),
          roomLeft = lowX - 10 - x0;
        const under = lowY + 15 > bottom - 2 ? lowY - 8 : lowY + 15;
        const low =
          roomRight >= lowWide
            ? { x: lowX + 8, y: under, end: false }
            : roomLeft >= lowWide
              ? { x: lowX - 10, y: under, end: true }
              : short && nextStop + 6 + lowWide <= x1 && lowY - y0 >= 12
                ? // A shortfall squeezed against payday: named past the paycheck, in the clear band under $0.
                  { x: nextStop + 6, y: lowY + 3, end: false }
                : roomRight >= roomLeft
                  ? { x: Math.min(lowX + 8, x1 - lowWide), y: under, end: false }
                  : { x: Math.max(lowX - 10, x0 + lowWide), y: under, end: true };
        return (
          <>
            <defs>
              <clipPath id={`${uid}-above`}>
                <rect x="0" y="0" width={W} height={y0} />
              </clipPath>
              <clipPath id={`${uid}-below`}>
                <rect x="0" y={y0} width={W} height={Math.max(H - y0, 0)} />
              </clipPath>
              <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="3" height="6" fill="var(--warn)" />
              </pattern>
            </defs>
            <path d={area} fill="var(--usd-soft)" clipPath={`url(#${uid}-above)`} />
            {short && <path d={area} fill={`url(#${uid}-hatch)`} opacity=".55" clipPath={`url(#${uid}-below)`} />}
            {flags.map((flag, index) => {
              const ty = 10 + flag.row * 13;
              const color = flag.pay ? "var(--plan)" : "var(--ink)";
              // The guide runs from its label down to the line, and steps over any label it would cross on the way.
              const gaps = flags
                .filter((other) => other.row > flag.row && flag.ex > other.left - 3 && flag.ex < other.left + other.wide + 3)
                .map((other) => other.row)
                .sort((a, b) => a - b);
              const runs: [number, number][] = [];
              let from = ty + 3;
              for (const row of gaps) {
                const band = 10 + row * 13;
                if (band - 9 > from) runs.push([from, band - 9]);
                from = band + 3;
              }
              const end = (reach.get(flag.event) ?? bottom) - 1;
              if (end > from) runs.push([from, end]);
              return (
                <g key={`f${index}`}>
                  {runs.map(([y1, y2]) => (
                    <line key={y1} x1={flag.ex} x2={flag.ex} y1={y1} y2={y2} stroke={color} strokeDasharray="3 3" opacity={flag.pay ? 0.9 : 0.5} />
                  ))}
                  <text x={flag.flip ? flag.ex - 5 : flag.ex + 5} y={ty} textAnchor={flag.flip ? "end" : "start"} style={{ fill: color }}>
                    {flag.pay ? (
                      `Payday ${shortDate(flag.event.date)}`
                    ) : (
                      <>
                        {flag.event.name} <tspan style={{ fontWeight: 700 }}>{usd(flag.event.amount)}</tspan>
                        <tspan style={{ fill: "var(--ink-2)" }}> · {shortDate(flag.event.date)}</tspan>
                      </>
                    )}
                  </text>
                </g>
              );
            })}
            <line x1={x0} x2={x1} y1={y0} y2={y0} stroke="var(--bezel)" />
            <text x={x1} y={y0 - 4} textAnchor="end">
              $0
            </text>
            <path d={line} fill="none" stroke="var(--usd)" strokeWidth="2" strokeLinejoin="round" />
            {steps}
            {marks}
            <circle cx={x(0)} cy={y(start)} r="4" fill="var(--usd)">
              <title>{`In checking today: ${usd(cash.start)}.`}</title>
            </circle>
            {cash.events.length > 0 && (
              <text className="lbl" x={low.x} y={low.y} textAnchor={low.end ? "end" : "start"} style={{ fontWeight: 700, fill: short ? "var(--warn)" : undefined }}>
                {lowText}
              </text>
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

/** Bills lane: 30 days left to right. Further left is sooner; a bigger target is a bigger bill. Only bills are drawn here; paydays are on the Checking forecast chart. */
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
              <text key={`n${v}`} className="private" x={W - 18} y={ty + 3.5} textAnchor="end">
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
              <Tip text={`This month: ${btc(stack.month_start)} to ${btc(stack.held)}`} />
            </rect>
            {ticks}
            <path d={`M0,${yc - 10}H${W - 16}L${W - 7},${yc}L${W - 16},${yc + 10}H0Z`} fill="var(--panel-2)" stroke="var(--btc)" strokeWidth="1.2" />
            <text className="private" x={W - 21} y={yc + 4} textAnchor="end" style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 700 }}>
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
    <Frame height={42} label={`Bitcoin held by month, ${monthYear(history[0].month)} to ${monthYear(history[history.length - 1].month)}.`}>
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
                <Tip text={`${monthYear(point.month)}: ${btc(point.held)}`} />
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
    <Frame height={50} label={`Stack rate by month. ${known.map((p) => `${monthYear(p.month)} ${p.rate}%`).join(", ")}.`}>
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
                    <title>{`${monthYear(point.month)}: ${point.rate}% of income stacked${i === n - 1 ? " so far" : ""}`}</title>
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
                    <title>{`Day ${i + 1}: ${format(value)} so far${previous?.[i] != null ? `; ${longMonth(shift(month, -1))} ${format(previous[i])}` : ""}`}</title>
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
