import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "../../lib/api";
import { LevelIcon } from "../design/icons";
import { btc, cents, coordinate, fromCents, longMonth, monthName, plural, shortDate, usd, usdWhole } from "../lib/format";
import type { Route } from "../lib/router";
import type { Lens } from "../lib/session";
import { BillsLane, CashAheadChart, PaceChart, StackRateBars, StackSpark, StackTape, isCardPayment, shift } from "./charts";
import type { BillMode } from "./Sheets";
import type { Bill, CashCard, DashboardData } from "./types";

type Go = (route: Route, sub?: string) => void;
/** Set when an alert light concerns this panel: it takes the alert's colour and a chip that opens it. */
export type Flag = { level: "advisory" | "caution" | "warning"; onOpen: () => void } | undefined;

export function Panel({
  className = "",
  name,
  plain,
  link,
  inop,
  flag,
  children,
}: {
  className?: string;
  name: string;
  plain?: string;
  flag?: Flag;
  link?: { label: string; onClick: () => void };
  inop?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`inst ${inop ? "inop " : ""}${flag ? `flag-${flag.level} ` : ""}${className}`} aria-label={plain ? `${name}: ${plain}` : name}>
      <div className="inst-h">
        <span className="inst-name" style={inop ? { color: "var(--ink-3)" } : undefined}>
          {name}
        </span>
        <span className="inst-plain">{plain}</span>
        {flag && (
          <button className={`flagchip ${flag.level}`} onClick={flag.onOpen}>
            {LevelIcon[flag.level]}
            {flag.level}
          </button>
        )}
        {link && !flag && (
          <button className="inst-link" onClick={link.onClick}>
            {link.label} →
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Shown instead of an empty chart: what the panel needs, and the one action that provides it. */
function NotSetUp({ className, name, plain, needs, action }: { className?: string; name: string; plain: string; needs: ReactNode; action?: ReactNode }) {
  return (
    <Panel className={className} name={name} plain={plain} inop>
      <div className="sub" style={{ flex: 1 }}>
        {needs}
      </div>
      {action && <div>{action}</div>}
    </Panel>
  );
}

export function Collecting({ className, name, plain, have, need, note }: { className?: string; name: string; plain: string; have: number; need: number; note: string }) {
  const shown = Math.min(have, need);
  return (
    <Panel className={className} name={name} plain={plain} inop>
      <div className="wait">
        <div className="sub">
          Collecting data — <b className="num">{shown} of {need}</b> days
        </div>
        <div className="meter" role="img" aria-label={`${shown} of ${need} days collected`}>
          <i style={{ width: `${(shown / need) * 100}%` }} />
        </div>
        <div className="hint">{note}</div>
      </div>
    </Panel>
  );
}

/** The panel's name: the dollars in checking, looked at ahead, with every bill and card payment they have to cover. */
export const FORECAST = "Checking forecast";
export const FORECAST_PLAIN = "after bills and card payments";

/** A card with no due day cannot be placed on the chart. This asks for the day right where it is missing. */
function CardDueDay({ card, limit, onSaved }: { card: CashCard; /** The card's saved limit, sent back unchanged. */ limit: string | null; onSaved?: () => void }) {
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/accounts/${card.account_id}/card-terms`, "PUT", { credit_limit: limit, due_day: Number(day) });
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const owes = cents(card.owed) > 0n;
  return (
    <form className="duerow" onSubmit={save}>
      <div className="sub">
        <b style={{ color: "var(--ink)" }}>{card.name}</b>{" "}
        {owes ? (
          <>
            owes <b className="num">{usd(card.owed)}</b>
            {card.charges.count > 0 && <>, with {plural(card.charges.count, "more bill")} charged to it in the next 30 days</>}
          </>
        ) : (
          <>has {plural(card.charges.count, "bill")} charged to it in the next 30 days</>
        )}
        . It has no due day, so paying it off is not in this forecast yet.
      </div>
      <div className="duerow-set">
        <label>
          Due on day{" "}
          <input className="num" type="number" inputMode="numeric" min={1} max={31} required value={day} onChange={(e) => setDay(e.target.value)} placeholder="1–31" aria-label={`Day of the month ${card.name} is due`} />{" "}
          of each month
        </label>
        <button className="btn sm" disabled={busy}>
          Add to forecast
        </button>
      </div>
      {error && (
        <div className="hint" role="alert" style={{ color: "var(--warn)" }}>
          {error}
        </div>
      )}
    </form>
  );
}

export function CashAheadPanel({
  className,
  data,
  flag,
  go,
  onPaycheck,
  onChanged,
  own,
}: {
  className?: string;
  flag?: Flag;
  data: DashboardData;
  go: Go;
  onPaycheck: () => void;
  /** Called after a card's due day is saved here, so the reading can be fetched again. */
  onChanged?: () => void;
  /** True on the Bills screen itself, where a link to Bills would go nowhere. */
  own?: boolean;
}) {
  const cash = data.cash_ahead;
  if (cash.status === "needs_account")
    return (
      <NotSetUp
        className={className}
        name={FORECAST}
        plain={FORECAST_PLAIN}
        needs="Add your checking or cash account first. This panel then shows whether it covers every bill and card payment before your next paycheck."
        action={
          <button className="btn sm" onClick={() => go("accounts", "add")}>
            Add an account
          </button>
        }
      />
    );
  if (cash.status === "needs_bills")
    return (
      <NotSetUp
        className={className}
        name={FORECAST}
        plain={FORECAST_PLAIN}
        needs={
          <>
            No bills on file yet, so nothing is known to be due. Add them and this shows whether{" "}
            <b className="num">{usd(data.checking.total)}</b> covers everything before your next paycheck.
          </>
        }
        action={
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!own && (
              <button className="btn sm" onClick={() => go("bills", "add")}>
                Add bills
              </button>
            )}
            {!data.setup.has_paycheck && (
              <button className="btn sm" onClick={onPaycheck}>
                Add income
              </button>
            )}
          </span>
        }
      />
    );
  const short = cash.short;
  const payday = cash.next_paycheck;
  const leans = cash.leans_on_estimate ?? null;
  const estimates = cash.events.some((event) => event.kind === "paycheck" && event.estimate);
  // A card paid off after payday can take checking under even with the paycheck in it.
  const late = short !== null && payday !== null && short.date > payday.date;
  const payments = cash.events.filter(isCardPayment);
  const before = payments.filter((event) => !payday || event.date <= payday.date);
  const toCards = before.reduce((sum, event) => sum + cents(event.amount), 0n);
  const paidCards = new Set(before.map((event) => event.account_id));
  const onlyCard = paidCards.size === 1 ? cash.cards.find((card) => paidCards.has(card.account_id))?.name : undefined;
  const waiting = cash.cards.filter((card) => card.plan === null);
  const limit = (card: CashCard) => data.debt.cards.find((row) => row.account_id === card.account_id)?.limit ?? null;
  const notes = cash.cards.flatMap((card) => {
    if (card.plan === "full") {
      const first = cash.events.find((event) => event.kind === "card" && event.account_id === card.account_id);
      // When the payment is simply today's balance, its label on the chart already says everything.
      if (!first || !first.charged_count) return [];
      return [
        <div key={card.account_id} className="hint">
          {card.name} is paid in full on {shortDate(first.date)}:{" "}
          {cents(first.owed_now ?? "0") > 0n && <span className="num">{usd(first.owed_now)} owed today, plus </span>}
          {plural(first.charged_count, "bill")} charged to it before then.
        </div>,
      ];
    }
    if (card.plan === "bill" && (card.charges.count > 0 || card.next_payment?.amount !== card.owed))
      return [
        <div key={card.account_id} className="hint">
          {card.name} owes <span className="num">{usd(card.owed)}</span>. Your {card.paid_by} bill pays it down, so that bill is what is drawn, not a payment in full.
          {card.charges.count > 0 && (
            <>
              {" "}
              {plural(card.charges.count, "bill")} charged to the card {card.charges.count === 1 ? "adds" : "add"} to what it owes.
            </>
          )}
        </div>,
      ];
    return [];
  });
  return (
    <Panel className={className} flag={flag} name={FORECAST} plain={FORECAST_PLAIN} link={own ? undefined : { label: "Bills", onClick: () => go("bills") }}>
      <div className="split" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <div className="lead" style={{ fontWeight: 700, color: short ? "var(--warn)" : undefined }}>
            {short ? (late ? `Short on ${shortDate(short.date)}` : payday ? "Short before payday" : "Short within 30 days") : payday ? "Covered through payday" : "Covered for the next 30 days"}
          </div>
          <div className="sub">
            {short ? (
              <>
                Checking runs out on {shortDate(short.date)}
                {late ? `, even with the ${shortDate(payday.date)} paycheck` : payday ? `, before the ${shortDate(payday.date)} paycheck` : ""}.
              </>
            ) : cash.covered_days !== null ? (
              <>
                {payments.length ? "Bills and card payments" : "Known bills"} are covered for <b className="num">{cash.covered_days >= 60 ? "60+" : cash.covered_days} days</b>, even if no
                paycheck arrives.
              </>
            ) : null}
            {!payday && (
              <>
                {" "}
                <button className="inst-link" onClick={onPaycheck}>
                  Add income you expect →
                </button>
              </>
            )}
          </div>
          {leans && (
            <div className="sub" style={{ color: "var(--caution)" }}>
              This counts on about {usd(leans.income)} of income that varies. Without it, checking runs <b className="num">{usd(leans.amount)}</b> short on {shortDate(leans.date)}.
            </div>
          )}
        </div>
        <div className="kv" style={{ flex: "2 1 330px" }}>
          <div>
            <span>In checking</span>
            <b>{usd(cash.start)}</b>
          </div>
          <div>
            <span>{payday ? "Due before payday" : "Due in 30 days"}</span>
            <b>{usd(cash.due_before_paycheck)}</b>
            {toCards > 0n && (
              <small className="num">
                {usd(fromCents(toCards))} of it to {onlyCard ?? "cards"}
              </small>
            )}
          </div>
          <div>
            <span>{short ? "Shortfall" : "Free after bills"}</span>
            <b style={{ color: short ? "var(--warn)" : undefined }}>{usd(short ? short.amount : cash.low.balance)}</b>
            {!short && cash.low.balance !== cash.start && <small className="num">lowest on {shortDate(cash.low.date)}</small>}
          </div>
        </div>
      </div>
      {waiting.map((card) => (
        <CardDueDay key={card.account_id} card={card} limit={limit(card)} onSaved={onChanged} />
      ))}
      <CashAheadChart data={data} />
      <div className="key">
        <span>
          <i style={{ background: "var(--usd)" }} />
          Dollars in checking
        </span>
        <span>
          <i className="dot ring" />
          Bill paid from checking
        </span>
        {payments.length > 0 && (
          <span>
            <i className="dot" style={{ background: "var(--ink)" }} />
            Card payment
          </span>
        )}
        <span>
          <i style={{ background: "var(--plan)" }} />
          {estimates ? "Expected income, not recorded yet; amounts that vary are estimates" : "Planned paycheck, not recorded yet"}
        </span>
      </div>
      {notes}
      {cash.other_bills > 0 && (
        <div className="hint">
          {plural(cash.other_bills, "bill")} paid from another account, such as savings, {cash.other_bills === 1 ? "is" : "are"} not drawn here.
        </div>
      )}
    </Panel>
  );
}

export function StackPanel({ className, data, flag, go }: { className?: string; flag?: Flag; data: DashboardData; go: Go }) {
  const stack = data.stack;
  if (stack.status === "needs_bitcoin")
    return (
      <NotSetUp
        className={className}
        name="Stack"
        plain="bitcoin held"
        needs="Record what you hold. Bitcoin is your saving; this is where it shows."
        action={
          <button className="btn sm" onClick={() => go("accounts", "add-bitcoin")}>
            Add bitcoin
          </button>
        }
      />
    );
  const rates = stack.rates.filter((point) => point.rate !== null);
  const now = stack.stack_rate,
    earlier = rates.slice(0, -1);
  const last = earlier.length ? Number(earlier[earlier.length - 1].rate) : null;
  const best = earlier.length ? Math.max(...earlier.map((p) => Number(p.rate))) : null;
  const span = coordinate(stack.milestone.next) - coordinate(stack.milestone.previous);
  const progress = span > 0 ? ((coordinate(stack.held) - coordinate(stack.milestone.previous)) / span) * 100 : 0;
  const toGo = (BigInt(stack.milestone.next) - BigInt(stack.held)).toString();
  const up = !stack.gained.startsWith("-");
  return (
    <Panel className={className} flag={flag} name="Stack" plain="bitcoin held" link={{ label: "Stack", onClick: () => go("stack") }}>
      <div className="split">
        <StackTape stack={stack} />
        <div style={{ flex: 1, display: "grid", gap: 6, alignContent: "start", minWidth: 0 }}>
          <div className="num hero btc">{btc(stack.held)}</div>
          <div className="sub">
            <b className="num btc">
              {up ? "▲" : "▼"} {btc(stack.gained.replace("-", ""))}
            </b>{" "}
            this month
          </div>
          <div className="sub num">
            {stack.buys.count ? `${plural(stack.buys.count, "buy")} for ${usd(stack.buys.usd)}` : "No buys yet this month"}
          </div>
          <StackSpark history={stack.history} />
        </div>
      </div>
      <div className="rate">
        <div>
          <span className="lbl">Stack rate</span>
          <b className="num btc">{now !== null ? `${now}%` : "—"}</b>
          <span className="sub">of income stacked</span>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
          <StackRateBars rates={stack.rates} />
          <div className="sub">
            {now === null ? (
              "Shows once this month has income."
            ) : last === null ? (
              "Higher is better."
            ) : (
              <>
                {Number(now) >= last ? "▲" : "▼"} {Math.abs(Number(now) - last).toFixed(1)} pts vs {longMonth(earlier[earlier.length - 1].month)}
                {best !== null && Number(now) > best && (
                  <>
                    {" · "}
                    <span className="btc" style={{ fontWeight: 700 }}>
                      best yet
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div className="split sub" style={{ justifyContent: "space-between" }}>
          <span>
            Next milestone <b className="num btc">{btc(stack.milestone.next)}</b>
          </span>
          <span className="num">{btc(toGo)} to go</span>
        </div>
        <div className="meter" role="img" aria-label={`${Math.round(progress)}% of the way to the next milestone`}>
          <i style={{ width: `${Math.max(0, Math.min(100, progress)).toFixed(1)}%`, background: "var(--btc)" }} />
        </div>
        <div className="sub">
          {stack.streak_months > 0 && <span className="badge">{stack.streak_months}-month streak</span>}{" "}
          {stack.best_month && (
            <>
              Best month <b className="num btc">{btc(stack.best_month.bitcoin)}</b> in {longMonth(stack.best_month.month)}
            </>
          )}
        </div>
      </div>
      {data.price && (
        <div
          className="sub"
          style={{ borderTop: "1px solid var(--hairline)", paddingTop: 8, marginTop: "auto", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
        >
          <span className="num">{btc(data.price.bitcoin_per_usd)} per $1</span>
          <span className="dim">
            {data.price.source} · {shortDate(data.price.day)}
          </span>
        </div>
      )}
    </Panel>
  );
}

export function PacePanel({ className, data, flag, lens, go }: { className?: string; flag?: Flag; data: DashboardData; lens: Lens; go: Go }) {
  const pace = data.pace;
  const format = lens === "USD" ? usd : btc;
  const current = pace.current[lens][pace.day - 1] ?? null;
  const prior = pace.previous ? (pace.previous[lens][Math.min(pace.day, pace.previous[lens].length) - 1] ?? null) : null;
  const priorName = monthName(shift(data.month, -1));
  const nothingYet = !pace.previous && pace.missing_conversions === 0 && pace.current.USD.every((value) => value !== null && cents(value) === 0n);
  if (nothingYet)
    return (
      <NotSetUp
        className={className}
        name="Spend pace"
        plain="this month so far"
        needs="Record your first expense and the line starts here. It compares with last month once there is one."
        action={
          <button className="btn sm" onClick={() => go("activity")}>
            Add an expense
          </button>
        }
      />
    );
  // Exact difference in cents or whole bitcoin; the percentage is a label only.
  let difference: ReactNode = null;
  if (current !== null && prior !== null) {
    const a = lens === "USD" ? cents(current) : BigInt(current),
      b = lens === "USD" ? cents(prior) : BigInt(prior);
    const delta = a - b,
      size = delta < 0n ? -delta : delta;
    const amount = lens === "USD" ? usd(fromCents(size)) : btc(size.toString());
    const percent = b === 0n ? null : (Number(delta) / Number(b)) * 100;
    difference = (
      <span className="sub num">
        <b style={{ color: "var(--ink)" }}>
          {amount} {delta >= 0n ? "more" : "less"}
        </b>{" "}
        than {priorName} 1–{pace.day}
        {percent !== null && ` · ${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`}
      </span>
    );
  }
  return (
    <Panel className={className} flag={flag} name="Spend pace" plain={pace.previous ? "vs last month" : "this month so far"} link={{ label: "Spending", onClick: () => go("spending") }}>
      <div className="split" style={{ alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 12px" }}>
        <span className="num read">{current !== null ? format(current) : "Partial"}</span>
        {difference}
      </div>
      <PaceChart pace={pace} lens={lens} month={data.month} />
      {lens === "BITCOIN" && pace.missing_conversions > 0 && (
        <div className="hint">
          {plural(pace.missing_conversions, "expense")} this month {pace.missing_conversions === 1 ? "has" : "have"} no saved bitcoin price, so the
          bitcoin line stops there. Nothing is guessed.
        </div>
      )}
      {!pace.previous && <div className="hint">Comparison with last month starts once a full month is recorded. Nothing is estimated before then.</div>}
    </Panel>
  );
}

export function BillsPanel({
  className,
  data,
  flag,
  go,
  gone,
  onAct,
  onStack,
}: {
  className?: string;
  flag?: Flag;
  data: DashboardData;
  go: Go;
  gone: { id: number; mode: BillMode } | null;
  onAct: (bill: Bill, mode: BillMode) => void;
  onStack: () => void;
}) {
  const cash = data.cash_ahead,
    bills = data.bills;
  if (!bills.items.length && bills.paid_this_month.count === 0 && bills.destroyed.count === 0)
    return (
      <NotSetUp
        className={className}
        name="Bills"
        plain="what is due"
        needs="Add a bill and it shows up here, set against your dollars in checking."
        action={
          <button className="btn sm" onClick={() => go("bills", "add")}>
            Add a bill
          </button>
        }
      />
    );
  const short = cash.short;
  // Card payments count too: a card is paid from checking like any bill.
  const need = cash.due_before_paycheck,
    inChecking = data.checking.total;
  const payday = cash.next_paycheck;
  const late = short !== null && payday !== null && short.date > payday.date;
  const what = cash.events.some((event) => isCardPayment(event) && (!payday || event.date <= payday.date)) ? "Bills and card payments" : "Bills";
  const used = coordinate(inChecking) > 0 ? Math.min(100, (coordinate(need) / coordinate(inChecking)) * 100) : 100;
  const next = [...bills.items].sort((a, b) => a.days_until - b.days_until).slice(0, 3);
  const until = payday ? `payday on ${shortDate(payday.date)}` : "the end of the next 30 days";
  const spare = !short && cents(cash.low.balance) > 0n;
  return (
    <Panel className={className} flag={flag} name="Bills" plain="pay them, or destroy them for good" link={{ label: `All ${bills.items.length}`, onClick: () => go("bills") }}>
      <div className="split" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: "6px 16px" }}>
        <div className="kv">
          <div>
            <span>Dollars in checking</span>
            <b style={{ fontSize: "var(--t-read)" }}>{usd(inChecking)}</b>
          </div>
        </div>
        <div style={{ flex: "1 1 210px", display: "grid", gap: 5, paddingBottom: 3 }}>
          <div className={`bar cover${short ? " short" : ""}`} role="img" aria-label={`${usd(need)} of ${usd(inChecking)} is needed for ${what.toLowerCase()} before ${until}`}>
            <i style={{ width: `${used.toFixed(1)}%` }} />
          </div>
          <div className="sub">
            {late ? (
              <>
                Checking runs <b style={{ color: "var(--warn)" }}>{usd(short.amount)} short</b> on {shortDate(short.date)}, even with the {shortDate(payday.date)} paycheck.
              </>
            ) : cents(need) > 0n ? (
              <>
                {what} before {until} need <b className="num">{usd(need)}</b>.{" "}
                {short ? (
                  <b style={{ color: "var(--warn)" }}>{usd(short.amount)} short.</b>
                ) : (
                  <b className="ok">Enough in checking.</b>
                )}
              </>
            ) : (
              <>Nothing left to pay before {until}.</>
            )}
          </div>
        </div>
      </div>
      <BillsLane data={data} gone={gone} onPick={(bill) => onAct(bill, "pay")} />
      {next.length ? (
        <ul className="rows">
          {next.map((bill) => (
            <li key={bill.id} style={{ gridTemplateColumns: "minmax(0,1fr) auto auto auto", alignItems: "center" }}>
              <span className="nm">
                {bill.name}{" "}
                <small className={`num ${bill.overdue ? "overdue" : "dim"}`}>
                  · {bill.overdue ? `${plural(-bill.days_until, "day")} overdue` : bill.days_until === 0 ? "due today" : `${shortDate(bill.due_date)}, in ${plural(bill.days_until, "day")}`}
                </small>
              </span>
              <span className="num">{bill.currency === "USD" ? usd(bill.amount) : btc(bill.amount)}</span>
              <button className="btn sm" disabled={!!gone} onClick={() => onAct(bill, "pay")} aria-label={`Pay ${bill.name}, ${usd(bill.amount)}`}>
                Pay
              </button>
              {bill.pays_account_id !== null ? (
                <button className="btn sm ghost" disabled={!!gone} onClick={() => onAct(bill, "payoff")} aria-label={`Pay off ${bill.name} in full and destroy it`}>
                  Pay off
                </button>
              ) : (
                <button className="btn sm ghost" disabled={!!gone} onClick={() => onAct(bill, "destroy")} aria-label={`Destroy ${bill.name} for good`}>
                  Destroy
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="sub ok">{LevelIcon.ok} All clear. Nothing is due in the next 30 days.</div>
      )}
      <div className="sub" style={{ display: "flex", justifyContent: "space-between", gap: "6px 12px", flexWrap: "wrap", borderTop: "1px solid var(--hairline)", paddingTop: 8 }}>
        <span>
          <span className="badge">{bills.paid_this_month.count} paid</span> this month{" "}
          {bills.destroyed.count > 0 && (
            <>
              <span className="badge" style={{ marginLeft: 6 }}>
                {bills.destroyed.count} destroyed
              </span>{" "}
              <span className="num">{usd(bills.destroyed.monthly_freed)}</span> a month freed
            </>
          )}
        </span>
        {spare && (
          <span>
            Spare dollars <b className="num">{usd(cash.low.balance)}</b>{" "}
            <button className="btn sm copper" onClick={onStack}>
              Stack it →
            </button>
          </span>
        )}
      </div>
    </Panel>
  );
}

export function DebtPanel({ className, data, flag, go }: { className?: string; flag?: Flag; data: DashboardData; go: Go }) {
  const { cards, loans } = data.debt;
  if (!cards.length && !loans.length)
    return (
      <Panel className={className} name="Cards & debt" plain="what you owe">
        <div className="sub ok">{LevelIcon.ok} No cards or loans on file.</div>
      </Panel>
    );
  return (
    <Panel className={className} flag={flag} name="Cards & debt" plain="what you owe" link={{ label: "Accounts", onClick: () => go("accounts") }}>
      {cards.map((card) => (
        <div key={card.account_id} style={{ display: "grid", gap: 6 }}>
          <div className="split" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <span>{card.name}</span>
            <span className="num lead">{usd(card.balance)}</span>
          </div>
          {card.limit !== null && card.utilization !== null ? (
            <>
              <div className="bar" role="img" aria-label={`${card.utilization}% of the limit used; caution line at 30%`}>
                <i style={{ width: `${Math.min(Number(card.utilization), 100)}%` }} />
                <u style={{ left: "30%" }} title="Caution line: 30% of limit" />
              </div>
              <div className="sub num" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>
                  {Number(card.utilization).toFixed(0)}% of {usdWhole(card.limit)} limit
                </span>
                {card.next_due && cents(card.balance) > 0n && <span>Payment due {shortDate(card.next_due)}</span>}
              </div>
            </>
          ) : (
            <div className="hint">Add this card's limit and due day in Accounts to see how much of it is used.</div>
          )}
        </div>
      ))}
      {loans.map((loan, index) => (
        <div key={loan.account_id} style={{ display: "grid", gap: 4, borderTop: cards.length || index ? "1px solid var(--hairline)" : undefined, paddingTop: cards.length || index ? 8 : 0 }}>
          <div className="split" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <span>{loan.name}</span>
            <span className="num lead">{usd(loan.balance)}</span>
          </div>
          {loan.change && (
            <div className="sub num">
              {loan.change.amount.startsWith("-") ? "▼" : "▲"} {usd(loan.change.amount.replace("-", ""))} since {shortDate(loan.change.since)}
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

export function BudgetsPanel({ className, data, flag, go }: { className?: string; flag?: Flag; data: DashboardData; go: Go }) {
  const { items, month_elapsed_percent: elapsed } = data.budgets;
  if (!items.length)
    return (
      <NotSetUp
        className={className}
        name="Allowances"
        plain="dollar limits by category"
        needs="Set a monthly allowance for a category and it appears here with how much is used."
        action={
          <button className="btn sm" onClick={() => go("spending")}>
            Set an allowance
          </button>
        }
      />
    );
  return (
    <Panel className={className} flag={flag} name="Allowances" plain="dollar limits by category" link={{ label: "Change", onClick: () => go("spending") }}>
      <div style={{ display: "grid", gap: 9 }}>
        {items.slice(0, 5).map((item) => (
          <div key={item.category_id} style={{ display: "grid", gap: 4 }}>
            <div className="split" style={{ justifyContent: "space-between" }}>
              <span>{item.category}</span>
              <span className="num sub">
                {item.spent_usd !== null ? usd(item.spent_usd) : "Partial"} of {usdWhole(item.planned_usd)}
              </span>
            </div>
            <div className="bar" role="img" aria-label={item.percent !== null ? `${Number(item.percent).toFixed(0)}% of the allowance used` : "Spending total unavailable"}>
              <i style={{ width: `${Math.min(Number(item.percent ?? 0), 100)}%` }} />
              <u style={{ left: `${elapsed}%` }} title={`Today: ${Number(elapsed).toFixed(0)}% of the month has passed`} />
            </div>
          </div>
        ))}
      </div>
      <div className="hint">The mark is today. A bar past the mark is spending faster than the month.</div>
    </Panel>
  );
}

export function SetupPanel({ className, data, demoEnabled, go, onPaycheck, onDemo }: { className?: string; data: DashboardData; demoEnabled: boolean; go: Go; onPaycheck: () => void; onDemo: () => void }) {
  const s = data.setup;
  const steps: { done: boolean; title: string; sub: string; action?: ReactNode }[] = [
    { done: s.has_account, title: "Add your checking or cash account", sub: "Turns on: Checking forecast, Spend pace", action: <button className="btn sm" onClick={() => go("accounts", "add")}>Add account</button> },
    { done: s.has_paycheck, title: "Add the income you expect", sub: "A paycheck, tips, side work. Turns on: payday in Checking forecast", action: s.has_account ? <button className="btn sm" onClick={onPaycheck}>Add income</button> : undefined },
    { done: s.has_bills, title: "Add recurring bills", sub: "Turns on: Checking forecast, Bills", action: <button className="btn sm" onClick={() => go("bills", "add")}>Add bills</button> },
    { done: s.has_bitcoin, title: "Record your bitcoin", sub: "Turns on: Stack", action: <button className="btn sm" onClick={() => go("accounts", "add-bitcoin")}>Add bitcoin</button> },
    { done: s.has_price_source, title: "Choose a price source", sub: "Turns on: bitcoin cost on every expense", action: <button className="btn sm" onClick={() => go("settings")}>Choose</button> },
    { done: s.has_backup, title: "Make an encrypted backup", sub: "Turns on: backup reminders", action: <button className="btn sm" onClick={() => go("settings")}>Back up</button> },
  ];
  const done = steps.filter((step) => step.done).length;
  return (
    <Panel className={className} name="Get set up" plain={`${done} of ${steps.length} done`}>
      <div className="meter" role="img" aria-label={`${done} of ${steps.length} setup steps done`}>
        <i style={{ width: `${(done / steps.length) * 100}%`, background: "var(--ok)" }} />
      </div>
      <ol className="check">
        {steps.map((step) => (
          <li key={step.title} className={step.done ? "done" : ""}>
            <span className="box">{step.done ? LevelIcon.ok : null}</span>
            <span className="t">
              {step.title}
              <small>{step.sub}</small>
            </span>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
      {!s.has_account && demoEnabled && (
        <div>
          <button className="btn sm ghost" onClick={onDemo}>
            Or load the fictional demo
          </button>
        </div>
      )}
    </Panel>
  );
}
