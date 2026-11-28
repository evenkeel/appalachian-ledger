import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { emptyPlan } from "../../lib/planning";
import type { Comparison, ForecastInput, ForecastResult, ProjectionPoint, Scenario, StartingPosition } from "../../lib/planning";
import { Panel } from "../dashboard/panels";
import { TwoStep } from "../dashboard/Sheets";
import { LevelIcon } from "../design/icons";
import { btc, coordinate, longMonth, plural, usd } from "../lib/format";
import type { Route } from "../lib/router";
import { useSession } from "../lib/session";
import { Legend, LineChart } from "./charts";
import type { Line, Marker } from "./charts";
import { monthYear, prepare, today, wholeAge } from "./plan";
import type { Field } from "./plan";
import "./retirement.css";
import { Private } from "../lib/privacy";

type Lens = "USD" | "BITCOIN";
type TextField = Exclude<Field, "as_of" | "current_age" | "retirement_age" | "planning_age" | "spending_model">;

const PRESETS = ["0", "1", "5", "10", "15", "25", "50", "100"];
const FROM_LEDGER = ["bitcoin", "cash_usd", "other_assets_usd", "liabilities_usd", "price_usd"] as const;
/** Comparison lines differ by dashes and a number at the line's end, not by colour alone. */
const COMPARE = [
  { color: "var(--plan)", dash: undefined },
  { color: "var(--usd)", dash: "7 4" },
  { color: "var(--ink-3)", dash: "2 4" },
  { color: "var(--plan)", dash: "12 4 2 4" },
];
const days = (iso: string) => Date.parse(`${iso}T12:00:00`) / 86_400_000;
const yearOf = (dayNumber: number) => String(new Date(dayNumber * 86_400_000).getFullYear());
const inLens = (point: ProjectionPoint, lens: Lens) => (lens === "USD" ? usd(point.portfolio_usd) : btc(point.portfolio_bitcoin));

/** A what-if for retirement, built from assumptions the owner chooses. It reads the ledger and never writes to it. */
export function Planner({ go, onBack }: { go: (route: Route, sub?: string) => void; onBack: () => void }) {
  const { lens } = useSession();
  const [inputs, setInputs] = useState<ForecastInput>(() => emptyPlan(today()));
  // Becomes true the moment the owner changes anything, so the ledger's figures never overwrite their own.
  const touched = useRef(false);
  const [position, setPosition] = useState<StartingPosition | null>(null);
  // null = not known yet; the planner still works if this cannot be read.
  const [accounts, setAccounts] = useState<number | null>(null);
  const [byHand, setByHand] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("My plan");
  const [selected, setSelected] = useState<number | null>(null);
  const [compared, setCompared] = useState<number[]>([]);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [compareError, setCompareError] = useState("");
  const [data, setData] = useState<{ key: string; result: ForecastResult } | null>(null);
  const [projectionError, setProjectionError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [earliest, setEarliest] = useState<{ key: string; age: number | null; date: string | null } | null>(null);
  const [solving, setSolving] = useState(false);
  const [table, setTable] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const { payload, errors } = useMemo(() => prepare(inputs), [inputs]);
  const invalid = Object.keys(errors).length > 0;
  const key = payload && !invalid ? JSON.stringify(payload) : "";
  const currentKey = useRef(key);
  currentKey.current = key;
  // The last good projection stays on screen, marked as updating, only while a new one is on its way.
  const fresh = data !== null && data.key === key;
  const result = data && key && !projectionError ? data.result : null;

  useEffect(() => {
    let active = true;
    api<StartingPosition>("/planning/starting-position")
      .then((next) => {
        if (!active) return;
        setPosition(next);
        // A new plan starts from what the ledger holds today; every figure can still be changed.
        if (!touched.current) {
          setInputs((before) => fromLedger(before, next));
          setStatus("Started from your ledger balances. Check every figure before relying on it.");
        }
      })
      .catch((e: Error) => active && setError(e.message));
    api<unknown[]>("/accounts")
      .then((rows) => active && setAccounts(rows.length))
      .catch(() => active && setAccounts(null));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    api<Scenario[]>("/planning/scenarios")
      .then((rows) => active && setScenarios(rows))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setProjectionError("");
    if (!key) return;
    const timer = window.setTimeout(() => {
      api<ForecastResult>("/planning/project", "POST", JSON.parse(key))
        .then((next) => active && setData({ key, result: next }))
        .catch((e: Error) => active && setProjectionError(e.message));
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [key]);
  useEffect(() => {
    let active = true;
    setComparisons([]);
    setCompareError("");
    if (!compared.length) return;
    api<Comparison[]>("/planning/compare", "POST", { ids: compared })
      .then((rows) => active && setComparisons(rows))
      .catch((e: Error) => active && setCompareError(e.message));
    return () => {
      active = false;
    };
  }, [compared, revision]);

  const change = (field: Field, value: string | number) => {
    touched.current = true;
    setInputs((before) => ({ ...before, [field]: value }));
  };
  function useLedger() {
    if (!position) return;
    touched.current = true;
    setInputs((before) => fromLedger(before, position));
    setStatus("Copied what the ledger has. Anything it could not value was left as it was; check every figure.");
  }
  function startNew() {
    touched.current = true;
    setSelected(null);
    setName("My plan");
    setInputs(position ? fromLedger(emptyPlan(today()), position) : emptyPlan(today()));
    setStatus("New plan started.");
  }
  function open(id: string) {
    const row = scenarios.find((scenario) => scenario.id === Number(id));
    touched.current = true;
    if (!row) {
      // "Unsaved draft" keeps the figures and only detaches them from the saved plan.
      setSelected(null);
      setStatus("");
      return;
    }
    setSelected(row.id);
    setName(row.name);
    setInputs(row.assumptions);
    setStatus(`Opened ${row.name} with its saved date and price. Today's price does not replace them.`);
  }
  async function save(copy = false) {
    if (!payload) return;
    setBusy(true);
    setError("");
    setStatus("");
    const update = selected !== null && !copy;
    try {
      const row = await api<Scenario>(update ? `/planning/scenarios/${selected}` : "/planning/scenarios", update ? "PUT" : "POST", {
        name: copy ? `${name.trim().slice(0, 74)} copy` : name.trim(),
        assumptions: payload,
      });
      if (!alive.current) return;
      setSelected(row.id);
      setName(row.name);
      setRevision((n) => n + 1);
      setStatus(`Saved ${row.name} with its starting date and price.`);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function remove() {
    if (selected === null) return;
    setBusy(true);
    setError("");
    try {
      await api(`/planning/scenarios/${selected}`, "DELETE");
      if (!alive.current) return;
      setCompared((ids) => ids.filter((id) => id !== selected));
      setSelected(null);
      setRevision((n) => n + 1);
      setStatus(`Deleted ${name}. The figures are still here as an unsaved draft.`);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function solve() {
    if (!payload || !key) return;
    const asked = key;
    setSolving(true);
    setError("");
    try {
      const answer = await api<{ age: number | null; date: string | null }>("/planning/earliest-retirement", "POST", payload);
      if (alive.current && currentKey.current === asked) setEarliest({ ...answer, key: asked });
    } catch (e) {
      if (alive.current && currentKey.current === asked) setError((e as Error).message);
    } finally {
      if (alive.current) setSolving(false);
    }
  }

  const notices = (
    <>
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      <p className={status ? "ret-status" : "sr"} role="status">
        {status}
      </p>
    </>
  );

  if (accounts === 0 && !byHand && scenarios.length === 0)
    return (
      <div className="page ret-page">
        <h1>Detailed planner</h1>
        <div>
          <button className="inst-link" onClick={onBack}>
            ← Back to your retirement age
          </button>
        </div>
        {notices}
        <Panel className="ret-narrow" name="Nothing to plan from yet" plain="add an account first" inop>
          <div className="lead">A plan starts from what you hold today.</div>
          <div className="sub">
            Add your accounts and this screen fills in your bitcoin, cash, other assets and debts for you. Then you choose the assumptions and see how long the money lasts. It is a
            what-if, not a prediction, and it never changes your ledger.
          </div>
          <div className="ret-row">
            <button className="btn primary" onClick={() => go("accounts", "add")}>
              Add an account
            </button>
            <button className="inst-link" onClick={() => setByHand(true)}>
              Enter figures by hand instead →
            </button>
          </div>
        </Panel>
      </div>
    );

  const text = (field: TextField, label: string, options: { hint?: ReactNode; wide?: boolean; placeholder?: string } = {}) => (
    <label key={field} className={`field${options.wide ? " ret-wide" : ""}`}>
      <span>{label}</span>
      <input
        className="num"
        inputMode="decimal"
        value={inputs[field]}
        placeholder={options.placeholder}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={errors[field] ? `ret-${field}-error` : undefined}
        onChange={(event) => change(field, event.target.value)}
      />
      {errors[field] && (
        <small id={`ret-${field}-error`} className="ret-error">
          {errors[field]}
        </small>
      )}
      {options.hint && <small className="hint">{options.hint}</small>}
    </label>
  );
  const age = (field: "current_age" | "retirement_age" | "planning_age", label: string) => (
    <label key={field} className="field">
      <span>{label}</span>
      <input
        className="num"
        type="number"
        min={0}
        max={120}
        step={1}
        value={Number.isNaN(inputs[field]) ? "" : inputs[field]}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={errors[field] ? `ret-${field}-error` : undefined}
        onChange={(event) => change(field, event.target.value === "" ? Number.NaN : Number(event.target.value))}
      />
      {errors[field] && (
        <small id={`ret-${field}-error`} className="ret-error">
          {errors[field]}
        </small>
      )}
    </label>
  );
  const canSave = !busy && fresh && result !== null && name.trim() !== "";

  return (
    <div className="page ret-page">
      <h1>Detailed planner</h1>
      <div>
        <button className="inst-link" onClick={onBack}>
          ← Back to your retirement age
        </button>
      </div>
      <p className="intro">
        A what-if, built from assumptions you choose. It is not a prediction, and nothing here changes your ledger.{" "}
        <button className="inst-link" onClick={() => go("learn", "bitcoin-is-saving")}>
          How this ledger thinks about saving →
        </button>
      </p>
      {notices}
      <div className="grid2">
        <Panel className="c12" name="Plan" plain={selected === null ? "unsaved draft" : "saved on this ledger"}>
          <div className="ret-plan">
            <label className="field">
              <span>Saved plans</span>
              <select value={selected ?? ""} onChange={(event) => open(event.target.value)}>
                <option value="">Unsaved draft</option>
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Plan name</span>
              <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="ret-row">
              <button className="btn primary" disabled={!canSave} onClick={() => void save()}>
                {selected === null ? "Save plan" : "Save changes"}
              </button>
              <button className="btn" disabled={!canSave} onClick={() => void save(true)}>
                Save a copy
              </button>
              <button className="btn ghost" onClick={startNew}>
                New
              </button>
              {selected !== null && <TwoStep key={selected} ask="Delete" confirm="Yes, delete it" disabled={busy} onConfirm={() => void remove()} />}
            </div>
          </div>
          <div className="hint">A saved plan keeps its own starting date and bitcoin price, so it reads the same next year. Save a copy, change one assumption, and compare the two below.</div>
        </Panel>

        <Panel className="c5" name="Assumptions" plain="every one is yours to set">
          <div className="ret-sub ret-first">You</div>
          <div className="ret-fields">
            <label className="field">
              <span>Starting date</span>
              <input
                type="date"
                value={inputs.as_of}
                aria-invalid={errors.as_of ? true : undefined}
                aria-describedby={errors.as_of ? "ret-as_of-error" : undefined}
                onChange={(event) => change("as_of", event.target.value)}
              />
              {errors.as_of && (
                <small id="ret-as_of-error" className="ret-error">
                  {errors.as_of}
                </small>
              )}
            </label>
            {age("current_age", "Your age now")}
            {age("retirement_age", "Retire at age")}
            {age("planning_age", "Plan through age")}
          </div>

          <div className="ret-sub">
            What you start with
            <button className="inst-link" disabled={!position} onClick={useLedger}>
              Use ledger balances →
            </button>
          </div>
          {position && (
            <div className="hint">
              Ledger balances as of {position.as_of}. Bitcoin price: {position.price_usd === null ? "none saved, so enter one" : `${position.rate_source ?? "saved price"}${position.rate_day ? `, ${position.rate_day}` : ""}`}
              . Closed accounts are left out.
            </div>
          )}
          <div className="ret-fields">
            {text("bitcoin", "Bitcoin you hold (₿)")}
            {text("price_usd", "Bitcoin price ($ per BTC)", { placeholder: "Needed to calculate" })}
            {text("cash_usd", "Cash ($)")}
            {text("liabilities_usd", "Debts to settle ($)")}
            {text("other_assets_usd", "Other assets ($)", {
              wide: true,
              hint: "Count only what you could spend in retirement. A home or vehicle value copied from the ledger may not belong here.",
            })}
          </div>

          <div className="ret-sub">Each month until you retire</div>
          <div className="ret-fields">
            {text("monthly_purchase_usd", "Bitcoin bought ($)")}
            {text("monthly_savings_usd", "Put into other assets ($)")}
          </div>

          <div className="ret-sub">Yearly assumptions</div>
          <div className="ret-fields">
            {text("appreciation_pct", "Bitcoin price change (%)")}
            {text("other_return_pct", "Other assets return (%)")}
          </div>
          <div className="ret-presets" role="group" aria-label="Presets for the bitcoin price change">
            {PRESETS.map((rate) => (
              <button key={rate} className="btn sm ghost" aria-pressed={inputs.appreciation_pct === rate} onClick={() => change("appreciation_pct", rate)}>
                {rate}%
              </button>
            ))}
          </div>
          <div className="hint">
            The presets are for trying things out. They are not predictions, and nothing is assumed unless you set it. A negative rate works too. Cash earns nothing here.
          </div>

          <div className="ret-sub">Cost of living in retirement</div>
          <div className="seg" role="group" aria-label="Cost of living is set in">
            <button aria-pressed={inputs.spending_model === "USD"} onClick={() => change("spending_model", "USD")}>
              In dollars
            </button>
            <button aria-pressed={inputs.spending_model === "BITCOIN"} onClick={() => change("spending_model", "BITCOIN")}>
              In bitcoin
            </button>
          </div>
          <div className="ret-fields">
            {inputs.spending_model === "USD" ? (
              <>
                {text("monthly_spending_usd", "A month, today ($)")}
                {text("usd_spending_change_pct", "Change a year (%)")}
              </>
            ) : (
              <>
                {text("monthly_spending_bitcoin", "A month, today (₿)")}
                {text("bitcoin_cost_change_pct", "Change a year (%)")}
              </>
            )}
          </div>
          {inputs.spending_model === "USD" && position && position.previous_month_entries > 0 && position.previous_month_spending_usd !== null && (
            <div>
              <button
                className="btn sm"
                onClick={() => {
                  change("monthly_spending_usd", position.previous_month_spending_usd!);
                  setStatus(`Copied what you recorded in ${longMonth(position.previous_month)}. One month may not be a complete or typical one.`);
                }}
              >
                Use {longMonth(position.previous_month)}'s recorded spending, {usd(position.previous_month_spending_usd)}
              </button>
            </div>
          )}
          <div className="hint">
            {inputs.spending_model === "USD"
              ? "The dollar cost changes each year from the starting date, and is paid at the projected bitcoin price."
              : "A negative change means the same life takes less bitcoin each year. It is separate from the price assumption, which is not applied to it a second time."}
          </div>
          <div className="ret-fields">
            {text("monthly_retirement_income_usd", "Income a month ($)", { hint: "A fixed dollar income after you retire. Any extra builds up as cash." })}
            {text("end_balance_usd", "To have left at the end ($)")}
          </div>
        </Panel>

        <div className="c7 ret-col">
          <Outlook
            result={result}
            fresh={fresh}
            lens={lens}
            needsPrice={payload === null}
            invalid={invalid}
            problem={projectionError}
            solving={solving}
            earliest={earliest && earliest.key === key ? earliest : null}
            onSolve={() => void solve()}
          />
          {result && (
            <>
              <PortfolioPanel result={result} lens={lens} />
              <HeldPanel result={result} />
              <DetailPanel result={result} />
              <Panel name="Year by year" plain="the figures behind the charts">
                <div className="ret-row">
                  <button className="btn sm" aria-expanded={table} onClick={() => setTable(!table)}>
                    {table ? "Hide the table" : "Show the table"}
                  </button>
                  <span className="sub">
                    {plural(result.history.length, "row")}, one for each year from age {result.assumptions.current_age} to {result.assumptions.planning_age}.
                  </span>
                </div>
                {table && <YearTable result={result} />}
                <div className="hint">
                  How it is worked out: yearly rates compound monthly. Each month growth comes first, then what you add until you retire, then spending once you have retired. Debts are
                  settled at the start. Spending is paid from cash, then other assets, then bitcoin. Bitcoin buys round down to whole units and the change stays as cash; bitcoin sold rounds
                  up and the extra stays as cash. What cannot be paid is counted as unfunded; the plan never borrows. Ages assume your birthday is the starting date.
                </div>
              </Panel>
            </>
          )}
        </div>

        <Panel className="c12" name="Compare saved plans" plain="up to four, each with its own saved figures">
          {scenarios.length ? (
            <div className="ret-pick" role="group" aria-label="Plans to compare">
              {scenarios.map((scenario) => (
                <label key={scenario.id} className="check-line">
                  <input
                    type="checkbox"
                    checked={compared.includes(scenario.id)}
                    disabled={!compared.includes(scenario.id) && compared.length >= 4}
                    onChange={(event) => setCompared((ids) => (event.target.checked ? [...ids, scenario.id] : ids.filter((id) => id !== scenario.id)))}
                  />
                  {scenario.name}
                </label>
              ))}
            </div>
          ) : (
            <div className="sub">Nothing saved yet. Save a plan, change one assumption, save a copy, then tick both here.</div>
          )}
          {compareError && (
            <p className="gate-error" role="alert">
              {compareError}
            </p>
          )}
          {comparisons.length > 0 && <Compare rows={comparisons} lens={lens} />}
        </Panel>
      </div>
    </div>
  );
}

/** A draft filled with what the ledger can value today. Anything it cannot value is left alone. */
function fromLedger(inputs: ForecastInput, position: StartingPosition): ForecastInput {
  const next = { ...inputs, as_of: position.as_of };
  for (const field of FROM_LEDGER) if (position[field] !== null) next[field] = position[field]!;
  return next;
}

function Outlook({
  result,
  fresh,
  lens,
  needsPrice,
  invalid,
  problem,
  solving,
  earliest,
  onSolve,
}: {
  result: ForecastResult | null;
  fresh: boolean;
  lens: Lens;
  needsPrice: boolean;
  invalid: boolean;
  problem: string;
  solving: boolean;
  earliest: { age: number | null; date: string | null } | null;
  onSolve: () => void;
}) {
  if (!result)
    return (
      <Panel name="Outlook" plain="hypothetical" inop>
        {problem && (
          <p className="gate-error" role="alert">
            {problem}
          </p>
        )}
        <div className="sub" role="status">
          {invalid
            ? "Fix the marked assumptions and the outlook is worked out again. Nothing is shown from the earlier figures."
            : needsPrice
              ? "Enter a bitcoin price, or use your ledger balances, and the outlook is worked out here. Nothing is drawn until then."
              : problem
                ? "Change the assumptions to work this plan out. Nothing is shown from the earlier figures."
                : "Working it out…"}
        </div>
      </Panel>
    );
  const plan = result.assumptions;
  const spending = lens === "USD" ? usd(result.retirement.annual_spending_usd) : btc(result.retirement.annual_spending_bitcoin);
  const gap = result.target_surplus_usd.startsWith("-");
  return (
    <Panel name="Outlook" plain={`hypothetical · retire in ${result.retirement.date.slice(0, 4)} at age ${plan.retirement_age}`}>
      <div className={fresh ? undefined : "ret-stale"} aria-busy={!fresh}>
        <div className="lead ret-verdict">
          {result.sustainable ? (
            <>
              <span className="ok">{LevelIcon.ok}</span> Funded through age {plan.planning_age} under these assumptions.
            </>
          ) : result.depletion_date ? (
            <>
              Runs short from age {wholeAge(result.depletion_age!)}, in {monthYear(result.depletion_date)}, under these assumptions.
            </>
          ) : (
            <>Pays for every year, but ends below the amount you want left.</>
          )}
          {!fresh && <span className="tag">Updating</span>}
        </div>
        <div className="kv ret-kv">
          <div>
            <span>Bitcoin at retirement</span>
            <b className="btc"><Private>{btc(result.retirement.bitcoin)}</Private></b>
          </div>
          <div>
            <span>Cost of living a year, at retirement</span>
            <b className={lens === "BITCOIN" ? "btc" : undefined}><Private when={lens === "BITCOIN"}>{spending}</Private></b>
          </div>
          <div>
            <span>Portfolio at age {plan.planning_age}</span>
            <b className="ret-plan-ink"><Private>{inLens(result.end, lens)}</Private></b>
          </div>
          <div>
            <span>Bitcoin held at age {plan.planning_age}</span>
            <b className="btc"><Private>{btc(result.end.bitcoin)}</Private></b>
          </div>
          <div>
            <span>Unfunded over the plan</span>
            <b>{usd(result.shortfall_usd)}</b>
          </div>
          <div>
            <span>{gap ? "Below your end amount by" : "Above your end amount by"}</span>
            <b>{usd(result.target_surplus_usd.replace(/^-/, ""))}</b>
          </div>
        </div>
      </div>
      <div className="ret-row">
        <button className="btn sm" disabled={solving || !fresh} onClick={onSolve}>
          {solving ? "Checking each age…" : "Find the earliest funded retirement age"}
        </button>
        {earliest && (
          <span className="sub" role="status">
            {earliest.age === null
              ? `No retirement age before ${plan.planning_age} is funded under these assumptions.`
              : `Earliest funded age: ${earliest.age}, in ${monthYear(earliest.date!)}.`}
          </span>
        )}
      </div>
      <div className="hint">
        Every rate here is constant and chosen by you. Real prices swing, and taxes, fees and limits on selling investments are not modelled. Treat this as a way to compare assumptions, not
        as advice or a forecast of what will happen.
      </div>
    </Panel>
  );
}

function markers(result: ForecastResult): Marker[] {
  const plan = result.assumptions;
  const list: Marker[] = [{ x: plan.retirement_age, label: `Retire at ${plan.retirement_age}`, color: "var(--ink-2)" }];
  if (result.depletion_age) list.push({ x: coordinate(result.depletion_age), label: `Runs short at ${wholeAge(result.depletion_age)}`, color: "var(--warn)" });
  return list;
}
const ageTick = (value: number) => String(Math.round(value));

function PortfolioPanel({ result, lens }: { result: ForecastResult; lens: Lens }) {
  const plan = result.assumptions;
  const line: Line = {
    name: "Projected portfolio",
    color: "var(--plan)",
    fill: "var(--plan-soft)",
    points: result.history.map((row) => ({ x: coordinate(row.age), y: coordinate(lens === "USD" ? row.portfolio_usd : row.portfolio_bitcoin), title: `Age ${wholeAge(row.age)}: ${inLens(row, lens)}` })),
  };
  return (
    <Panel name="Projected portfolio" plain={lens === "USD" ? "everything, in dollars" : "everything, valued in bitcoin at the projected price"}>
      <LineChart
        label={`Projected portfolio by age, from ${inLens(result.history[0], lens)} at age ${plan.current_age} to ${inLens(result.end, lens)} at age ${plan.planning_age}. Retirement at age ${plan.retirement_age}.${
          result.depletion_age ? ` Runs short at age ${wholeAge(result.depletion_age)}.` : ""
        }`}
        lines={[line]}
        unit={lens}
        private
        markers={markers(result)}
        tick={ageTick}
      />
      <Legend lines={[line, { name: "Retirement", color: "var(--ink-2)", dash: "3 3" }, ...(result.depletion_age ? [{ name: "Runs short", color: "var(--warn)", dash: "3 3" }] : [])]} />
    </Panel>
  );
}

function HeldPanel({ result }: { result: ForecastResult }) {
  const plan = result.assumptions;
  const line: Line = {
    name: "Projected bitcoin held",
    color: "var(--btc)",
    dash: "6 3",
    fill: "var(--btc-soft)",
    points: result.history.map((row) => ({ x: coordinate(row.age), y: coordinate(row.bitcoin), title: `Age ${wholeAge(row.age)}: ${btc(row.bitcoin)}` })),
  };
  return (
    <Panel name="Bitcoin held" plain="projected, in whole bitcoin">
      <LineChart
        label={`Projected bitcoin held by age, from ${btc(result.history[0].bitcoin)} at age ${plan.current_age} to ${btc(result.end.bitcoin)} at age ${plan.planning_age}.`}
        lines={[line]}
        unit="BITCOIN"
        markers={markers(result)}
        tick={ageTick}
        height={160}
      />
      <Legend lines={[line, { name: "Retirement", color: "var(--ink-2)", dash: "3 3" }]} />
    </Panel>
  );
}

function DetailPanel({ result }: { result: ForecastResult }) {
  const plan = result.assumptions;
  const price: Line = {
    name: "Assumed price, $ per BTC",
    color: "var(--plan)",
    dash: "2 4",
    points: result.history.map((row) => ({ x: coordinate(row.age), y: coordinate(row.price_usd), title: `Age ${wholeAge(row.age)}: ${usd(row.price_usd)} per BTC, assumed` })),
  };
  // Spending starts after retirement; earlier rows carry no figure worth drawing.
  const spent = result.history.filter((row) => coordinate(row.age) >= plan.retirement_age);
  const cost: Line = {
    name: "Cost of living a year, in bitcoin",
    color: "var(--btc)",
    dash: "6 3",
    points: spent.map((row) => ({ x: coordinate(row.age), y: coordinate(row.annual_spending_bitcoin), title: `Age ${wholeAge(row.age)}: ${btc(row.annual_spending_bitcoin)} a year` })),
  };
  return (
    <Panel name="Price and cost of living" plain="what the assumptions imply">
      <div className="ret-pair">
        <div>
          <LineChart
            label={`Assumed bitcoin price by age, from ${usd(result.history[0].price_usd)} to ${usd(result.end.price_usd)} per BTC. This is your assumption, not a forecast.`}
            lines={[price]}
            unit="USD"
            tick={ageTick}
            height={140}
          />
          <Legend lines={[price]} />
        </div>
        <div>
          {cost.points.length > 1 ? (
            <>
              <LineChart
                label={`Yearly cost of living in bitcoin after retirement, from ${btc(spent[0].annual_spending_bitcoin)} at age ${wholeAge(spent[0].age)} to ${btc(result.end.annual_spending_bitcoin)} at age ${plan.planning_age}.`}
                lines={[cost]}
                unit="BITCOIN"
                tick={ageTick}
                height={140}
              />
              <Legend lines={[cost]} />
            </>
          ) : (
            <div className="sub">The yearly cost of living in bitcoin is charted once the plan covers more than one year of retirement.</div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function YearTable({ result }: { result: ForecastResult }) {
  return (
    <div className="ret-scroll">
      <table className="log">
        <thead>
          <tr>
            <th>Age</th>
            <th className="r">Bitcoin held</th>
            <th className="r">Other assets</th>
            <th className="r">Cash</th>
            <th className="r">Portfolio</th>
            <th className="r">Withdrawn so far</th>
            <th className="r">Unfunded</th>
          </tr>
        </thead>
        <tbody>
          {result.history.map((row) => (
            <tr key={row.month}>
              <td className="num">{wholeAge(row.age)}</td>
              <td className="num r btc"><Private>{btc(row.bitcoin)}</Private></td>
              <td className="num r">{usd(row.other_assets_usd)}</td>
              <td className="num r">{usd(row.cash_usd)}</td>
              <td className="num r"><Private>{usd(row.portfolio_usd)}</Private></td>
              <td className="num r">{usd(row.withdrawals_usd)}</td>
              <td className="num r">{usd(row.shortfall_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Compare({ rows, lens }: { rows: Comparison[]; lens: Lens }) {
  const lines: Line[] = rows.map((row, index) => ({
    name: `${index + 1}. ${row.name}`,
    ...COMPARE[index % COMPARE.length],
    points: row.result.history.map((point) => ({
      x: days(point.date),
      y: coordinate(lens === "USD" ? point.portfolio_usd : point.portfolio_bitcoin),
      title: `${row.name}, ${monthYear(point.date)}: ${inLens(point, lens)}`,
    })),
  }));
  return (
    <>
      <LineChart
        label={`Projected portfolio for ${rows.map((row) => `${row.name}, ending at ${inLens(row.result.end, lens)}`).join("; ")}.`}
        lines={lines}
        unit={lens}
        private
        tick={yearOf}
        numbered
        height={220}
      />
      <Legend lines={lines} />
      <div className="ret-scroll">
        <table className="log">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Starts</th>
              <th className="r">Price change a year</th>
              <th>Retires</th>
              <th className="r">Bitcoin at retirement</th>
              <th className="r">Cost of living a year</th>
              <th className="r">Withdrawn in all</th>
              <th className="r">Unfunded</th>
              <th>First runs short</th>
              <th className="r">Left at the end</th>
              <th className="r">Against end amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, name, result }, index) => (
              <tr key={id}>
                <td>
                  {index + 1}. {name}
                </td>
                <td className="num">{result.assumptions.as_of}</td>
                <td className="num r">{result.assumptions.appreciation_pct}%</td>
                <td className="num">{monthYear(result.retirement.date)}</td>
                <td className="num r btc"><Private>{btc(result.retirement.bitcoin)}</Private></td>
                <td className="num r">{usd(result.retirement.annual_spending_usd)}</td>
                <td className="num r">{usd(result.end.withdrawals_usd)}</td>
                <td className="num r">{usd(result.shortfall_usd)}</td>
                <td className="num">{result.depletion_date ? monthYear(result.depletion_date) : "Never, in this plan"}</td>
                <td className="num r"><Private>{usd(result.end.portfolio_usd)}</Private></td>
                <td className="num r">{usd(result.target_surplus_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint">
        Each line uses its own saved starting date, price, assumptions and length. The table is in dollars; in the chart, bitcoin values include cash and other assets converted at that plan's
        projected price.
      </div>
    </>
  );
}
