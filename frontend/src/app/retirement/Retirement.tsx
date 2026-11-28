import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEMO } from "../../demo/mode";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { btc, coordinate, longMonth, shortDate, usd, usdWhole } from "../lib/format";
import type { Route } from "../lib/router";
import { leverRunway, leverText, percent, readField, runwayText, span } from "./answer";
import type { AfterSeries, Answer, RetirementSettings, RetirementView, Stop } from "./answer";
import { CrossingChart, RunwayChart, YearBars } from "./answerCharts";
import { Legend, LineChart } from "./charts";
import { monthYear } from "./plan";
import { Planner } from "./Planner";
import "./retirement.css";
import { Private, PrivateText } from "../lib/privacy";

type Go = (route: Route, sub?: string) => void;
type TextField = "growth_pct" | "cost_rise_pct" | "tax_pct" | "other_income_usd" | "other_income_age" | "last_age" | "monthly_spending_usd" | "monthly_purchase_usd";
const TEXT: TextField[] = ["growth_pct", "cost_rise_pct", "tax_pct", "other_income_usd", "other_income_age", "last_age", "monthly_spending_usd", "monthly_purchase_usd"];
const CROSS = [
  { name: "Your stack", color: "var(--btc)" },
  { name: "Stack you need", color: "var(--plan)" },
];
const RUNWAY = [
  { name: "Your runway", color: "var(--btc)" },
  { name: "The rest of your life", color: "var(--ink-3)" },
];
const monthOf = (key: string) => `${longMonth(key)} ${key.slice(0, 4)}`;
const typedFrom = (settings: RetirementSettings) =>
  Object.fromEntries(TEXT.map((field) => [field, settings[field] === null ? "" : String(settings[field])])) as Record<TextField, string>;

/** When the owner's bitcoin can pay for their life. It reads the ledger and never writes to it. */
export function Retirement({ go }: { go: Go }) {
  const [planner, setPlanner] = useState(false);
  if (planner) return <Planner go={go} onBack={() => setPlanner(false)} />;
  return <RetirementAge go={go} onPlanner={() => setPlanner(true)} />;
}

function RetirementAge({ go, onPlanner }: { go: Go; onPlanner: () => void }) {
  const [view, setView] = useState<RetirementView | null>(null);
  const [settings, setSettings] = useState<RetirementSettings | null>(null);
  const [typed, setTyped] = useState<Record<TextField, string> | null>(null);
  const [errors, setErrors] = useState<Partial<Record<TextField, string>>>({});
  const [trying, setTrying] = useState<string[]>([]);
  const [saved, setSaved] = useState("");
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // The question the figures on screen answer; a newer question marks them as out of date.
  const [answered, setAnswered] = useState("");

  function adopt(next: RetirementView) {
    setView(next);
    setSettings(next.settings);
    setTyped(typedFrom(next.settings));
    setSaved(JSON.stringify(next.settings));
    setErrors({});
    setTrying([]);
    setAnswered(JSON.stringify([next.settings, []]));
  }
  useEffect(() => {
    let active = true;
    api<RetirementView>("/planning/retirement")
      .then((next) => active && adopt(next))
      .catch((e: Error) => active && setProblem(e.message));
    return () => {
      active = false;
    };
  }, []);

  const invalid = Object.values(errors).some(Boolean);
  const question = settings ? JSON.stringify([settings, trying]) : "";
  const latest = useRef("");
  latest.current = question;
  useEffect(() => {
    if (!settings || invalid) return;
    // A message about a choice that could not be worked out goes when the choice does.
    setProblem("");
    if (question === answered) return;
    const timer = window.setTimeout(() => {
      api<RetirementView>("/planning/retirement/draft", "POST", { settings, trying })
        .then((next) => {
          if (latest.current !== question) return;
          setView(next);
          setAnswered(question);
          setProblem("");
        })
        .catch((e: Error) => latest.current === question && setProblem(e.message));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [question, answered, invalid]);

  if (!view || !settings || !typed)
    return (
      <div className="page ret-page" aria-busy={!problem}>
        <h1>Retirement</h1>
        {problem ? (
          <p className="gate-error" role="alert">
            {problem}
          </p>
        ) : (
          <p className="sub">Reading your ledger…</p>
        )}
      </div>
    );

  const change = (part: Partial<RetirementSettings>) => {
    setStatus("");
    setSettings((before) => ({ ...before!, ...part }));
  };
  const type = (field: TextField, value: string) => {
    setTyped((before) => ({ ...before!, [field]: value }));
    const read = readField(field, value);
    setErrors((before) => ({ ...before, [field]: "error" in read ? read.error : undefined }));
    if (!("error" in read)) change({ [field]: read.value } as Partial<RetirementSettings>);
  };
  const undo = () => {
    const before = JSON.parse(saved) as RetirementSettings;
    setSettings(before);
    setTyped(typedFrom(before));
    setErrors({});
    setTrying([]);
    setStatus("");
    setProblem("");
  };
  async function save() {
    setBusy(true);
    setProblem("");
    try {
      adopt(await api<RetirementView>("/planning/retirement", "PUT", settings));
      setStatus("Saved. Your ledger was not changed.");
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const changed = JSON.stringify(settings) !== saved;
  const stale = question !== answered || invalid;
  const facts = view.ledger,
    answer = view.answer;

  const field = (name: TextField, label: string, hint?: ReactNode) => (
    <label key={name} className="field">
      <span>{label}</span>
      <input
        className="num"
        inputMode="decimal"
        value={typed[name]}
        placeholder={name === "monthly_spending_usd" ? facts.recorded_spending_usd : name === "monthly_purchase_usd" ? facts.recorded_purchase_usd : undefined}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `age-${name}-error` : undefined}
        onChange={(event) => type(name, event.target.value)}
      />
      {errors[name] && (
        <small id={`age-${name}-error`} className="ret-error">
          {errors[name]}
        </small>
      )}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );

  const birthDate = (
    <label className="field ret-wide">
      <span>Birth date</span>
      <input type="date" value={settings.birth_date ?? ""} max={view.as_of} onChange={(event) => change({ birth_date: event.target.value || null })} />
    </label>
  );
  return (
    <div className="page ret-page ret-age">
      <h1>Retirement</h1>
      <p className="intro">
        How long your bitcoin can pay for your life, and when that becomes the rest of it. Your ledger supplies the stack, the spending and the bitcoin you buy.{" "}
        <button className="inst-link" onClick={() => go("learn", "bitcoin-is-saving")}>
          How this ledger thinks about saving →
        </button>
      </p>
      {problem && (
        <p className="gate-error" role="alert">
          {problem}
        </p>
      )}
      <div className="ret-row ret-savebar">
        {(changed || trying.length > 0 || invalid) && (
          <>
            {changed && (
              <button className="btn primary" disabled={busy || invalid} onClick={() => void save()}>
                Save my choices
              </button>
            )}
            <button className="btn ghost" onClick={undo}>
              Undo
            </button>
          </>
        )}
        <span className="sub" role="status">
          {status || (stale && !invalid && !problem ? "Working it out…" : "")}
        </span>
      </div>

      <div className="grid2">
        <Panel className="c5" name="Runway" plain="if you stopped today">
          <AnswerBlock view={view} stale={stale} birth={settings.birth_date === null ? birthDate : null} />
          <div className="ret-rate">
            <label htmlFor="ret-growth">Bitcoin grows each year by</label>
            <span>
              <input
                id="ret-growth"
                className="num"
                inputMode="decimal"
                autoComplete="off"
                value={typed.growth_pct}
                aria-invalid={errors.growth_pct ? true : undefined}
                aria-describedby="ret-growth-hint"
                onChange={(event) => type("growth_pct", event.target.value)}
              />
              %
            </span>
            <small id="ret-growth-hint" className={errors.growth_pct ? "ret-error" : "hint"}>
              {errors.growth_pct ??
                (answer?.price_in.length
                  ? `At that rate ${btc("100000000")} is worth ${answer.price_in.map((row, i) => `${i ? (i === answer.price_in.length - 1 ? " and " : ", ") : ""}${usdWhole(row.usd)} in ${row.years} years`).join("")}, in today's dollars. It is ${usdWhole(facts.price_usd)} now.`
                  : "Your call. Nobody knows this number, so try a few.")}
            </small>
          </div>
        </Panel>

        <Panel className="c7" name="Runway by age" plain="if you keep buying until you stop">
          {answer && view.runway?.points ? (
            <div className={stale ? "ret-stale" : undefined}>
              <Legend lines={RUNWAY} />
              <RunwayChart points={view.runway.points} answer={answer} lastAge={view.settings.last_age} />
            </div>
          ) : (
            <div className="sub">{WAITING[view.status]}</div>
          )}
        </Panel>


        <Panel className="c4" name="Where you stand today" plain="with no forecast">
          <TodayBlock view={view} />
        </Panel>
        <Panel className="c4" name="Make it sooner" plain="tick to try it">
          {answer ? (
            <>
              <div>
                {answer.levers.map((lever) => (
                  <label key={lever.id} className="ret-lever">
                    <input
                      type="checkbox"
                      checked={trying.includes(lever.id)}
                      onChange={(event) => setTrying((ids) => (event.target.checked ? [...ids, lever.id] : ids.filter((id) => id !== lever.id)))}
                    />
                    <span>{lever.label}</span>
                    <b className={(lever.months_sooner ?? 0) > 0 || lever.reaches_age !== null ? "ok" : undefined}>{leverText(lever)}</b>
                    {leverRunway(lever) && <small>{leverRunway(lever)}</small>}
                  </label>
                ))}
              </div>
              <label className="check-line">
                <input type="checkbox" checked={settings.freed_to_bitcoin} onChange={(event) => change({ freed_to_bitcoin: event.target.checked })} />
                Put money freed from spending into bitcoin
              </label>
              <div className="hint">Trying one changes nothing in your ledger. {answer.state === "not_yet" ? "“Sooner” is how much earlier your runway reaches the rest of your life." : "Your runway already covers the rest of your life."}</div>
            </>
          ) : (
            <div className="sub">{WAITING[view.status]}</div>
          )}
        </Panel>
        <Panel className="c4" name="Milestones" plain="when you get there">
          <MilestoneBlock view={view} />
        </Panel>

        <Panel className="c4" name="You" plain="filled in from your ledger">
          <div className="ret-fields">
            {settings.birth_date !== null && birthDate}
            {field("last_age", "Money lasts to age")}
            {field("tax_pct", "Tax on each sale (%)")}
            {field("monthly_spending_usd", "Spending a month ($)")}
            {field("monthly_purchase_usd", "Bitcoin bought a month ($)")}
            {field("other_income_usd", "Other income a month ($)")}
            {field("other_income_age", "Other income from age")}
          </div>
          <div className="hint">
            {spendingNote(view)} Leave either blank to use your record.
            {facts.purchase_months > 0 && ` Bitcoin bought is the average of ${span(facts.purchase_months)}.`} Other income is in today's dollars.
          </div>
          {facts.debts.length > 0 && (
            <div className="hint">
              Debts count too:{" "}
              {facts.debts
                .map((debt) => `${debt.name} ${usd(debt.owed_usd)}, ${coordinate(debt.monthly_usd) > 0 ? `paid at ${usd(debt.monthly_usd)} a month` : "paid off the day you stop"}`)
                .join("; ")}
              .
            </div>
          )}
        </Panel>

        <Panel className="c8" name="Your costs" plain="your own record, then a standard rise">
          <CostsBlock view={view} settings={settings} change={change} rise={field("cost_rise_pct", "Standard rise a year (%)")} setRise={(value) => type("cost_rise_pct", value)} />
        </Panel>

        <Panel className="c5" name="Bitcoin's price" plain="at the rate you entered">
          {answer ? (
            <LineChart
              label={`${btc("100000000")} in today's dollars, by age`}
              unit="USD"
              height={170}
              tick={(age) => String(Math.round(age))}
              lines={[
                {
                  name: "Price",
                  color: "var(--plan)",
                  points: answer.price_path
                    .filter((_, i) => i <= 30)
                    .map((row) => ({ x: coordinate(row.age), y: coordinate(row.usd), title: `Age ${Math.floor(coordinate(row.age))}: ${usd(row.usd)}` })),
                },
              ]}
            />
          ) : (
            <div className="sub">{WAITING[view.status]}</div>
          )}
          <div className="sub">
            The next 30 years of {btc("100000000")} in today's dollars, by your age. A stock investor plans with the S&amp;P 500's long-run average. This does the same with bitcoin, at the rate
            you choose.
          </div>
          <table className="log">
            <thead>
              <tr>
                <th>Bitcoin's record to {monthOf(view.bitcoin_record.through)}</th>
                <th>A year</th>
              </tr>
            </thead>
            <tbody>
              {view.bitcoin_record.rows.map((row) => (
                <tr key={row.years}>
                  <td>Past {row.years} years</td>
                  <td>{percent(row.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel className="c7" name="After you stop" plain="bitcoin left, by age">
          {answer?.after && answer.first ? <AfterBlock after={answer.after} stop={answer.first} /> : <div className="sub">Nothing to draw until there is a retirement age.</div>}
        </Panel>

        <Panel className="c7" name="When your stack covers your life" plain="the same answer, in bitcoin">
          {answer ? (
            <div className={stale ? "ret-stale" : undefined}>
              <Legend lines={CROSS} />
              <CrossingChart answer={answer} lastAge={view.settings.last_age} />
            </div>
          ) : (
            <div className="sub">{WAITING[view.status]}</div>
          )}
        </Panel>
        <Panel className="c5" name="If bitcoin crashes after you stop" plain="an extra check">
          {answer?.first ? <CrashBlock answer={answer} last={view.settings.last_age} /> : <div className="sub">Nothing to check until there is a retirement age.</div>}
        </Panel>

        <Panel className="c12" name="Adjust the details" plain="what counts, and how it is worked out">
          <Details view={view} settings={settings} change={change} />
          {/* The planner works out each plan on the app's own server, so the website demo leaves it out. */}
          {!DEMO && (
            <div className="ret-row">
              <button className="btn sm" onClick={onPlanner}>
                Open the detailed planner
              </button>
              <span className="sub">Set every assumption yourself, save plans and compare them side by side.</span>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

const WAITING: Record<RetirementView["status"], string> = {
  ready: "",
  needs_price: "Choose a bitcoin price source in Settings, or save a price, and this fills in.",
  needs_spending: "Enter what you spend a month under You, or record a full month of expenses, and this fills in.",
  needs_birth_date: "Enter your birth date and this fills in.",
  needs_growth: "Enter how much you think bitcoin grows each year and this fills in.",
};
const STATE = { not_yet: "Not yet", funded: "Funded today" };

function AnswerBlock({ view, stale, birth }: { view: RetirementView; stale: boolean; birth: ReactNode }) {
  const { answer, runway } = view,
    last = view.settings.last_age;
  if (!runway)
    return (
      <>
        <div className="ret-big">–</div>
        <div className="sub">{WAITING[view.status]}</div>
        {birth}
      </>
    );
  const name = (stop: Stop) => (stop.month === 0 ? "Now" : String(stop.age));
  const taxed = coordinate(view.settings.tax_pct) > 0;
  const owes = view.ledger.debts.length > 0;
  const counted = [taxed ? `${percent(view.settings.tax_pct)} tax on each sale` : "", owes ? "paying off what you owe" : ""].filter(Boolean).join(" and ");
  return (
    <div className={stale ? "ret-stale" : undefined} aria-busy={stale}>
      {answer && <span className={`tag ret-state ${answer.state}`}>{STATE[answer.state]}</span>}
      <div className="ret-big ret-runway" aria-live="polite">
        {runwayText(runway.months)}
      </div>
      <div className="sub">
        {runway.months === null ? "If you stopped today, your stack would pay for the rest of your life" : "How long your stack would pay for your life if you stopped today"}, growing{" "}
        {percent(view.settings.growth_pct!)} a year less your expenses{counted && `, ${counted}`}.
        {runway.before && ` A year ago it was ${runwayText(runway.before.months).toLowerCase()}, with ${btc("100000000")} at ${usdWhole(runway.before.price_usd)}.`}
      </div>
      {birth}
      {birth && <div className="hint">With your birth date this also shows the age you can retire.</div>}
      {answer && (
        <div className="ret-ages">
          <b>{answer.first ? name(answer.first) : "–"}</b>
          <span className="sub">
            {answer.first
              ? `You can retire ${answer.first.month > 0 ? `in ${monthYear(answer.first.date)}, ${span(answer.first.month)} from now` : "now"}: your runway lasts the rest of your life, to ${last}.${
                  answer.first.first_year_pct ? ` The first year takes ${percent(answer.first.first_year_pct)} of your stack.` : ""
                }`
              : `Your runway does not reach the rest of your life before ${last}. Try something under Make it sooner, or a different rate.`}
          </span>
        </div>
      )}
    </div>
  );
}

function MilestoneBlock({ view }: { view: RetirementView }) {
  const { answer, runway } = view;
  if (!answer || !runway?.milestones) return <div className="sub">{WAITING[view.status]}</div>;
  const age = (stop: { month: number; age: number } | null) => (!stop ? "–" : stop.month === 0 ? "Now" : `At ${stop.age}`);
  return (
    <>
      <div className="ret-scroll">
        <table className="log">
          <thead>
            <tr>
              <th>Runway</th>
              <th>You get there</th>
            </tr>
          </thead>
          <tbody>
            {runway.milestones.map((row) => (
              <tr key={row.months}>
                <td>{span(row.months)}</td>
                <td>{age(row.stop)}</td>
              </tr>
            ))}
            <tr>
              <td>For life</td>
              <td>{age(answer.first)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="hint">If you keep buying as you do now until the day you stop. Each age is when that much runway is in hand, so you could stop and live on it for that long.</div>
    </>
  );
}

function TodayBlock({ view }: { view: RetirementView }) {
  const today = view.today;
  if (!today) return <div className="sub">{WAITING[view.status]}</div>;
  return (
    <>
      <div>
        <div className="read">{runwayText(view.runway ? view.runway.flat_months : today.covered_months)}</div>
        <div className="sub">of runway if bitcoin's price and your costs never moved.</div>
      </div>
      <div className="kv">
        <div>
          <span>A year of your life</span>
          <b className="btc"><Private>{btc(today.year_bitcoin)}</Private></b>
          <small>{usd(today.year_usd)}</small>
        </div>
        <div>
          <span>Your stack</span>
          <b className="btc"><Private>{btc(view.ledger.bitcoin)}</Private></b>
          <small><Private>{usd(today.worth_usd)}</Private></small>
        </div>
      </div>
      {today.year_share_pct && (
        <div className="sub">
          A year of your life costs <b>{percent(today.year_share_pct)}</b> of your stack.
          {coordinate(today.year_share_pct) < 100 && " If its cost in bitcoin falls faster than that every year, your stack never runs out."}
        </div>
      )}
      {today.funded_pct && (
        <div>
          <div className="sub ret-between">
            <span>Of the stack needed to stop today</span>
            <b>{percent(today.funded_pct)}</b>
          </div>
          <div className="meter" role="img" aria-label={`${percent(today.funded_pct)} of the stack needed to stop today`}>
            <i style={{ width: `${Math.min(100, coordinate(today.funded_pct))}%`, background: "var(--btc)" }} />
          </div>
        </div>
      )}
      {view.answer && (
        <div className="sub">
          {today.hurdle_pct
            ? `To stop today and last to ${view.settings.last_age}, bitcoin would have to grow ${percent(today.hurdle_pct)} every year.`
            : "Stopping today is out of reach for now."}
        </div>
      )}
    </>
  );
}

function spendingNote(view: RetirementView) {
  const { spending_basis: basis, spending_months: months, spending_missing: missing } = view.ledger;
  const gap = missing ? ` ${missing} without a dollar price ${missing === 1 ? "is" : "are"} left out.` : "";
  if (basis === "record") return `Spending is your last 12 full months.${gap}`;
  if (basis === "early") return `Early estimate: spending is ${span(months)} of records, plus bills that have not come round yet.${gap}`;
  if (basis === "bills") return "Early estimate: no full month is recorded yet, so spending is your bills.";
  if (basis === "entered") return `Your record says ${usd(view.ledger.recorded_spending_usd)} a month.`;
  return "No full month of spending is recorded yet.";
}

function CostsBlock({
  view,
  settings,
  change,
  rise,
  setRise,
}: {
  view: RetirementView;
  settings: RetirementSettings;
  change: (part: Partial<RetirementSettings>) => void;
  rise: ReactNode;
  setRise: (value: string) => void;
}) {
  const { trend, years } = view.ledger;
  const standard = percent(view.settings.cost_rise_pct);
  const recorded = years.filter((row) => row.usd !== null);
  const priced = years.filter((row) => row.bitcoin !== null);
  const projected = view.answer?.projected_years ?? [];
  const last = years.length ? years[years.length - 1].year : 0;
  const moved = trend ? coordinate(trend.pct) : 0;
  const bitcoinNow = priced[priced.length - 1],
    bitcoinThen = priced[0];
  return (
    <>
      <div className="sub">
        {!trend ? (
          `Two full years of records are needed before your own trend counts. Until then your costs rise ${standard} a year.`
        ) : (
          <>
            Your costs {moved === 0 ? "held steady" : `${moved > 0 ? "rose" : "fell"} `}
            {moved !== 0 && <b>{percent(trend.pct.replace("-", ""))}</b>}
            {moved !== 0 && " a year"} from {trend.from} over {trend.years} years of records.{" "}
            {view.settings.use_record ? `Using that for the next ${trend.years}, through ${last + trend.years}, then ${standard}.` : `Not used: costs rise ${standard} a year from today.`}
            {view.settings.use_record && moved > coordinate(view.settings.cost_rise_pct) + 1 && <span className="ret-error"> Rising faster than the standard rate pushes your age back.</span>}
          </>
        )}
      </div>
      <div className="ret-controls">
        <div className="seg" role="group" aria-label="Project my costs with">
          <button aria-pressed={settings.use_record && !!trend} disabled={!trend} onClick={() => change({ use_record: true })}>
            My own record
          </button>
          <button aria-pressed={!settings.use_record || !trend} onClick={() => change({ use_record: false })}>
            The standard rise
          </button>
        </div>
        {years.length > 1 && (
          <label className="field">
            <span>Measure my costs from</span>
            <select value={settings.measure_from ?? ""} onChange={(event) => change({ measure_from: event.target.value ? Number(event.target.value) : null })}>
              <option value="">All my records</option>
              {years.slice(0, -1).map((row) => (
                <option key={row.year} value={row.year}>
                  {row.year}
                </option>
              ))}
            </select>
          </label>
        )}
        {rise}
        <div className="ret-presets">
          <button className="btn sm ghost" aria-pressed={settings.cost_rise_pct === "3"} onClick={() => setRise("3")}>
            3%
          </button>
          <button
            className="btn sm ghost"
            title="How fast US dollars (M2) grew, a year, October 2016 to October 2026. Source: Federal Reserve, FRED M2SL."
            aria-pressed={settings.cost_rise_pct === view.money_supply_pct}
            onClick={() => setRise(view.money_supply_pct)}
          >
            As fast as new dollars, {percent(view.money_supply_pct)}
          </button>
        </div>
      </div>
      <div className="ret-pair">
        <div>
          <div className="hint">In dollars: solid recorded, dashed projected</div>
          {recorded.length + projected.length > 0 && (
            <YearBars
              label="Cost of a year in dollars"
              unit="USD"
              exact={usd}
              rows={[...recorded.map((row) => ({ year: row.year, value: row.usd! })), ...projected.map((row) => ({ year: row.year, value: row.usd, planned: true }))]}
            />
          )}
        </div>
        <div>
          <div className="hint">In bitcoin, at each purchase's own price</div>
          {priced.length ? (
            <YearBars label="Cost of a year in bitcoin" unit="BITCOIN" exact={btc} rows={priced.map((row) => ({ year: row.year, value: row.bitcoin! }))} />
          ) : (
            <div className="sub">Your first full year draws this chart. It shows your life getting cheaper or dearer in bitcoin.</div>
          )}
        </div>
      </div>
      {recorded.length > 0 && (
        <div className="hint">
          Each year runs 12 months to {longMonth(years[years.length - 1].end.slice(0, 7))}.
          {priced.length > 1 && <PrivateText text={` A year of your life cost ${btc(bitcoinThen.bitcoin)} in ${bitcoinThen.year} and ${btc(bitcoinNow.bitcoin)} in ${bitcoinNow.year}.`} />}
        </div>
      )}
    </>
  );
}

function AfterBlock({ after, stop }: { after: AfterSeries; stop: Stop }) {
  const name = stop.month === 0 ? "If you stop now" : `If you stop at ${stop.age}`;
  return (
    <>
      <LineChart
        label={`Bitcoin left, by age. ${name}.`}
        unit="BITCOIN"
        lines={[{ name, color: "var(--btc)", points: after.points.map((p) => ({ x: coordinate(p.age), y: coordinate(p.bitcoin), title: `Age ${p.age}: ${btc(p.bitcoin)}` })) }]}
        height={300}
        tick={(age) => String(Math.round(age))}
      />
      <div className="sub">
        {name} you have <Private>{btc(stop.bitcoin)}</Private>. The first month of life takes <Private>{btc(stop.first_month_bitcoin)}</Private>, tax included.
      </div>
    </>
  );
}

function CrashBlock({ answer, last }: { answer: Answer; last: number }) {
  const { first, safe } = answer;
  const when = first!.month === 0 ? "now" : `at ${first!.age}`;
  return (
    <>
      <div className="sub">
        If you stopped {when} and bitcoin crashed right after, you would sell more bitcoin to pay the same bills, so the stack would not last as long.
      </div>
      <div className="ret-scroll">
        <table className="log">
          <thead>
            <tr>
              <th>If bitcoin</th>
              <th>Your stack lasts</th>
            </tr>
          </thead>
          <tbody>
            {answer.crashes.map((row) => (
              <tr key={row.month ?? "half"}>
                <td>{row.month ? `repeats what it did after ${monthOf(row.month)}` : "falls by half and never makes it up"}</td>
                <td>{row.runway_months === null ? `for life, to ${last}` : `${runwayText(row.runway_months).toLowerCase()}, to ${row.out_age}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint">{safe ? (safe.month === first!.month ? "It lasts for life through every one of these." : `Working until ${safe.age} instead would carry you through all of these.`) : `No age before ${last} carries you through all of these.`}</div>
    </>
  );
}

function Details({ view, settings, change }: { view: RetirementView; settings: RetirementSettings; change: (part: Partial<RetirementSettings>) => void }) {
  const { categories, one_offs: oneOffs } = view.ledger;
  const entered = settings.monthly_spending_usd !== null;
  const path = view.answer?.price_path;
  const far = path?.[path.length - 1];
  // Rounded on purpose: 21 million BTC at the far-off price, against about $100 trillion of money in the world.
  const times = far ? (coordinate(far.usd) * 21e6) / 100e12 : 0;
  const share = (id: number, value: string) => {
    const number = Number(value);
    if (value === "" || !Number.isInteger(number) || number < 0 || number > 300) return;
    const next = { ...settings.category_shares };
    if (number === 100) delete next[id];
    else next[id] = number;
    change({ category_shares: next });
  };
  return (
    <>
      {entered && <div className="sub">You entered your own monthly spending, so the record below is not used for your age. Clear that field to use it.</div>}
      <div className="ret-pair">
        <div>
          <b>What continues in retirement</b>
          <div className="hint">100% means the same as today. Set 0 for something that ends, or more for something that grows, like health care.</div>
          {categories.length ? (
            <div className="ret-shares">
              {categories.map((row) => (
                <label key={row.id}>
                  <span>
                    {row.name} <small className="hint">{usd(row.monthly_usd)} a month</small>
                  </span>
                  <span>
                    <input className="num" type="number" min={0} max={300} step={5} key={settings.category_shares[row.id] ?? 100} defaultValue={settings.category_shares[row.id] ?? 100} aria-label={`${row.name}, percent that continues`} onBlur={(event) => share(row.id, event.target.value)} />%
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="sub">Your spending categories appear here once a full month is recorded.</div>
          )}
        </div>
        <div>
          <b>Leave out one-off costs</b>
          <div className="hint">Tick anything that will not happen again. It stays in your ledger. Bills and regular purchases are not listed.</div>
          {oneOffs.length ? (
            <div className="ret-shares">
              {oneOffs.map((row) => (
                <label key={row.id}>
                  <span>
                    <input
                      type="checkbox"
                      checked={settings.left_out_entries.includes(row.id)}
                      onChange={(event) =>
                        change({ left_out_entries: event.target.checked ? [...settings.left_out_entries, row.id] : settings.left_out_entries.filter((id) => id !== row.id) })
                      }
                    />{" "}
                    {row.description} <small className="hint">{shortDate(row.date)}, {row.date.slice(0, 4)}</small>
                  </span>
                  <span className="num">{usd(row.usd)}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="sub">Nothing unusual in the last 12 months.</div>
          )}
        </div>
      </div>
      <details className="ret-how">
        <summary>How it is worked out</summary>
        <ul>
          <li>Each future month: your cost of living, less other income, plus tax, divided by that month's bitcoin price. Added up from an age to the end, that is the stack needed at that age.</li>
          <li>Runway is worked out month by month: the price and your costs rise, then enough bitcoin is sold to pay that month. It ends the first month the stack cannot pay in full. Your retirement age is the first month your runway reaches the rest of your life.</li>
          <li>The crash check has the price fall by half that day and stay at half its path for good, or repeat what it really did after four past highs, before your own rate takes over. The future can still be worse.</li>
          <li>Your dollar cost trend is used for as many years ahead as it has behind it, then the standard rise takes over. A bill you have cancelled already lowers today's spending, so it is not projected as more cuts to come.</li>
          <li>Bitcoin you buy each month, and other income, rise with the standard rise. Dollars in checking, homes and other assets are not counted.</li>
          <li>Debts with a bill are paid month by month until they are gone. Debts with none are paid off from the stack the day you stop. Interest is not added.</li>
          <li>
            Bitcoin grows at the one rate you enter, every year.
            {far &&
              ` By your age ${Math.floor(coordinate(far.age))} that makes ${btc("100000000")} worth ${usdWhole(far.usd)} in today's dollars, with all bitcoin worth about ${times >= 10 ? Math.round(times) : times.toFixed(1)} times the world's money today (taken as about $100 trillion; published estimates run from $98 trillion to $150 trillion). The far-off years count for less in your age than the near ones.`}
          </li>
          <li>Tax is one flat share of every sale. Real tax depends on what you paid and where you live.</li>
          <li>Prices for the crash check are Coinbase daily closes nearest the 15th of each month, August 2015 to {monthOf(view.bitcoin_record.through)}, kept with the app.</li>
          <li>This compares assumptions. It is not a prediction or advice, and nothing here changes your ledger.</li>
        </ul>
      </details>
    </>
  );
}
