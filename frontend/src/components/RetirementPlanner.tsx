import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useReportingUnit } from "../lib/monetaryLens";
import {
  emptyPlan,
  type ForecastInput,
  type ForecastResult,
  type Scenario,
  type Comparison,
  type StartingPosition,
} from "../lib/planning";
import { today, Field } from "./EntryDialog";
import { Money } from "./Money";
import { Button } from "./ui/button";
import { ProjectionChart } from "./ProjectionChart";

type MoneyKey = Exclude<
  keyof ForecastInput,
  "as_of" | "current_age" | "retirement_age" | "planning_age" | "spending_model"
>;
const colors = [
  "var(--accent)",
  "var(--blue)",
  "var(--amethyst)",
  "var(--chart-slate)",
];
export function RetirementPlanner() {
  const unit = useReportingUnit("USD");
  const [inputs, setInputs] = useState(() => emptyPlan(today()));
  const [position, setPosition] = useState<StartingPosition | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [name, setName] = useState("Custom");
  const [selected, setSelected] = useState<number | null>(null);
  const [compared, setCompared] = useState<number[]>([]);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<{
    key: string;
    result: ForecastResult;
  } | null>(null);
  const [error, setError] = useState("");
  const [projectionError, setProjectionError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [earliest, setEarliest] = useState<{
    key: string;
    age: number | null;
    date: string | null;
  } | null>(null);
  const [solving, setSolving] = useState(false);
  const [compareError, setCompareError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = JSON.stringify(inputs);
  const currentKey = useRef(key);
  currentKey.current = key;
  const result = data?.key === key ? data.result : null;
  useEffect(() => {
    let active = true;
    api<StartingPosition>("/planning/starting-position")
      .then((p) => {
        if (active) setPosition(p);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    api<Scenario[]>("/planning/scenarios")
      .then((rows) => {
        if (active) setScenarios(rows);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setProjectionError("");
    if (!inputs.price_usd) return;
    const timer = window.setTimeout(() => {
      api<ForecastResult>("/planning/project", "POST", inputs)
        .then((result) => {
          if (active) setData({ key, result });
        })
        .catch((e: Error) => {
          if (active) setProjectionError(e.message);
        });
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
      .then((rows) => {
        if (active) setComparisons(rows);
      })
      .catch((e: Error) => {
        if (active) setCompareError(e.message);
      });
    return () => {
      active = false;
    };
  }, [compared, revision]);
  const change = (field: keyof ForecastInput, value: string | number) =>
    setInputs((previous) => ({ ...previous, [field]: value }));
  function money(field: MoneyKey, label: string, hint?: string) {
    return (
      <Field key={field} label={label} hint={hint}>
        <input
          aria-label={label}
          inputMode="decimal"
          value={inputs[field]}
          onChange={(e) => change(field, e.target.value)}
        />
      </Field>
    );
  }
  function usePosition() {
    if (!position) return;
    setInputs((p) => ({
      ...p,
      as_of: position.as_of,
      ...Object.fromEntries(
        (
          [
            "bitcoin",
            "cash_usd",
            "other_assets_usd",
            "liabilities_usd",
            "price_usd",
          ] as const
        )
          .filter((field) => position[field] !== null)
          .map((field) => [field, position[field]]),
      ),
    }));
    setStatus(
      "Copied available ledger values. Missing values were left unchanged; review every input.",
    );
  }
  async function save(copy = false) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const row = await api<Scenario>(
        selected !== null && !copy
          ? `/planning/scenarios/${selected}`
          : "/planning/scenarios",
        selected !== null && !copy ? "PUT" : "POST",
        {
          name: copy ? `${name.slice(0, 74)} copy` : name,
          assumptions: inputs,
        },
      );
      if (!alive.current) return;
      setSelected(row.id);
      setName(row.name);
      setRevision((r) => r + 1);
      setStatus("Scenario saved with its input date and price.");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function remove() {
    if (selected === null || !window.confirm(`Delete “${name}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/planning/scenarios/${selected}`, "DELETE");
      if (alive.current) {
        setCompared((ids) => ids.filter((id) => id !== selected));
        setSelected(null);
        setRevision((r) => r + 1);
        setStatus("Scenario deleted.");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function solve() {
    setSolving(true);
    setError("");
    try {
      const answer = await api<{ age: number | null; date: string | null }>(
        "/planning/earliest-retirement",
        "POST",
        inputs,
      );
      if (alive.current && currentKey.current === key)
        setEarliest({ ...answer, key });
    } catch (e) {
      if (alive.current && currentKey.current === key)
        setError((e as Error).message);
    } finally {
      if (alive.current) setSolving(false);
    }
  }
  return (
    <div className="planning-workspace">
      <p className="hint">
        Hypothetical scenarios. Choose every assumption; no inflation or
        appreciation is imposed. ₿1 is one whole base unit (satoshi).
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {status && (
        <div className="alert success" role="status">
          {status}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Scenario</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(null);
              setName("Custom");
              setInputs(emptyPlan(today()));
              setStatus("");
            }}
          >
            New
          </Button>
        </div>
        <div className="panel-body planning-scenario-bar">
          <Field label="Saved scenario">
            <select
              value={selected ?? ""}
              onChange={(e) => {
                const row = scenarios.find(
                  (s) => s.id === Number(e.target.value),
                );
                if (!row) {
                  // “Unsaved draft” keeps the inputs but detaches them from the saved scenario.
                  setSelected(null);
                  setStatus("");
                } else {
                  setSelected(row.id);
                  setName(row.name);
                  setInputs(row.assumptions);
                  setStatus(
                    "Loaded saved inputs; live prices do not replace this snapshot.",
                  );
                }
              }}
            >
              <option value="">Unsaved draft</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scenario name">
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="button-row">
            <Button
              disabled={busy || !result || !name.trim()}
              onClick={() => void save()}
            >
              Save scenario
            </Button>
            <Button
              variant="outline"
              disabled={busy || !result}
              onClick={() => void save(true)}
            >
              Save copy
            </Button>
            <Button
              variant="ghost"
              disabled={busy || selected === null}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </div>
        </div>
      </section>
      <div className="planning-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>Inputs</h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={!position}
              onClick={usePosition}
            >
              Use ledger balances
            </Button>
          </div>
          <div className="panel-body stack">
            {position && (
              <p className="hint">
                Balances: {position.as_of}. Price:{" "}
                {position.rate_source ?? "unavailable"}
                {position.rate_day ? ` · ${position.rate_day}` : ""}. Manually
                valued assets use their latest recorded values. Archived
                accounts are excluded.
              </p>
            )}
            <div className="planning-fields">
              <Field label="Starting date">
                <input
                  type="date"
                  value={inputs.as_of}
                  onChange={(e) => change("as_of", e.target.value)}
                />
              </Field>
              {(
                [
                  ["current_age", "Current age"],
                  ["retirement_age", "Retirement age"],
                  ["planning_age", "Plan through age"],
                ] as const
              ).map(([field, label]) => (
                <Field key={field} label={label}>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={inputs[field]}
                    onChange={(e) => change(field, Number(e.target.value))}
                  />
                </Field>
              ))}
              {money("bitcoin", "Bitcoin holdings · ₿")}
              {money("price_usd", "Starting price · USD per legacy BTC")}
              {money(
                "other_assets_usd",
                "Other financial assets · USD",
                "Include only assets available for retirement; review property and vehicle valuations copied from the ledger.",
              )}
              {money("cash_usd", "Cash · USD")}
              {money("liabilities_usd", "Liabilities to settle · USD")}
              {money(
                "monthly_savings_usd",
                "Monthly other-asset contributions · USD",
              )}
              {money(
                "monthly_purchase_usd",
                "Additional monthly bitcoin buys · USD",
              )}
            </div>
            <h3>Annual assumptions</h3>
            {money("appreciation_pct", "Bitcoin appreciation against USD · %")}
            <div
              className="button-row planning-presets"
              aria-label="Appreciation presets"
            >
              {[0, 1, 5, 10, 15, 25, 50, 100].map((rate) => (
                <Button
                  key={rate}
                  size="sm"
                  variant={
                    inputs.appreciation_pct === String(rate)
                      ? "default"
                      : "ghost"
                  }
                  onClick={() => change("appreciation_pct", String(rate))}
                >
                  {rate}%
                </Button>
              ))}
            </div>
            <p className="hint">
              Custom negative rates are supported. Presets are labels for
              exploration, not predictions.
            </p>
            {money(
              "other_return_pct",
              "Other-asset annual return · %",
              "Cash earns 0%; this return applies only to other assets.",
            )}
            <h3>Retirement spending</h3>
            <Field label="Spending model">
              <select
                value={inputs.spending_model}
                onChange={(e) => change("spending_model", e.target.value)}
              >
                <option value="USD">
                  USD expenses → projected bitcoin price
                </option>
                <option value="BITCOIN">Direct bitcoin lifestyle cost</option>
              </select>
            </Field>
            {inputs.spending_model === "USD" ? (
              <>
                {money(
                  "monthly_spending_usd",
                  "Monthly lifestyle cost today · USD",
                )}
                {money(
                  "usd_spending_change_pct",
                  "Annual USD spending change · %",
                )}
              </>
            ) : (
              <>
                {money(
                  "monthly_spending_bitcoin",
                  "Monthly lifestyle cost today · ₿",
                )}
                {money(
                  "bitcoin_cost_change_pct",
                  "Annual bitcoin lifestyle-cost change · %",
                  "Negative means fewer bitcoin units buy the same lifestyle. Independent of the BTC/USD price assumption.",
                )}
              </>
            )}
            {position &&
              position.previous_month_entries > 0 &&
              inputs.spending_model === "USD" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={position.previous_month_spending_usd === null}
                  onClick={() => {
                    change(
                      "monthly_spending_usd",
                      position.previous_month_spending_usd!,
                    );
                    setStatus(
                      `Copied recorded ${position.previous_month} expenses. A recorded month may not represent a complete or typical month.`,
                    );
                  }}
                >
                  Use {position.previous_month} recorded expenses
                </Button>
              )}
            <p className="hint">
              The selected cost changes from the starting date. Only the
              selected spending model applies; appreciation is never applied a
              second time to bitcoin lifestyle costs.
            </p>
            {money(
              "monthly_retirement_income_usd",
              "Monthly retirement income · USD",
              "Constant USD income after retirement; excess income accumulates as cash.",
            )}
            {money("end_balance_usd", "Desired remaining portfolio · USD")}
          </div>
        </section>
        <div className="planning-results">
          <section className="panel" aria-label="Retirement readiness">
            <div className="panel-heading">
              <h2>Retirement outlook</h2>
              <span className="tag">HYPOTHETICAL</span>
            </div>
            <div className="panel-body stack">
              {projectionError && (
                <div className="alert error" role="alert">
                  {projectionError}
                </div>
              )}
              {!result ? (
                <p className="hint" role="status">
                  {!inputs.price_usd
                    ? "Enter a starting price, or copy available ledger balances, to calculate."
                    : projectionError
                      ? "Adjust the inputs to calculate this scenario."
                      : "Calculating scenario…"}
                </p>
              ) : (
                <>
                  <h3>
                    Target retirement: {result.retirement.date.slice(0, 4)} ·
                    age {inputs.retirement_age}
                  </h3>
                  <strong>
                    {result.sustainable
                      ? "Spending and end-balance target funded through planning age"
                      : "Scenario needs more funding"}
                  </strong>
                  <dl className="planning-readings">
                    <div>
                      <dt>Bitcoin at retirement</dt>
                      <dd>
                        <Money
                          value={result.retirement.bitcoin}
                          unit="BITCOIN"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Annual spending at retirement</dt>
                      <dd>
                        <Money
                          value={
                            unit === "USD"
                              ? result.retirement.annual_spending_usd
                              : result.retirement.annual_spending_bitcoin
                          }
                          unit={unit}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>First unmet obligation</dt>
                      <dd>
                        {result.depletion_date
                          ? `${result.depletion_date} · age ${result.depletion_age}`
                          : "None within this plan"}
                      </dd>
                    </div>
                    <div>
                      <dt>Unfunded obligations over plan</dt>
                      <dd>
                        <Money value={result.shortfall_usd} unit="USD" />
                      </dd>
                    </div>
                    <div>
                      <dt>Portfolio at age {inputs.planning_age}</dt>
                      <dd>
                        <Money
                          value={
                            unit === "USD"
                              ? result.end.portfolio_usd
                              : result.end.portfolio_bitcoin
                          }
                          unit={unit}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Bitcoin held at age {inputs.planning_age}</dt>
                      <dd>
                        <Money value={result.end.bitcoin} unit="BITCOIN" />
                      </dd>
                    </div>
                    <div>
                      <dt>End target surplus / shortfall</dt>
                      <dd>
                        <Money value={result.target_surplus_usd} unit="USD" />
                      </dd>
                    </div>
                  </dl>
                  <Button
                    variant="outline"
                    disabled={solving}
                    onClick={() => void solve()}
                  >
                    {solving
                      ? "Checking retirement ages…"
                      : "Find earliest funded retirement age"}
                  </Button>
                  {earliest?.key === key && (
                    <p role="status">
                      {earliest.age === null
                        ? "No funded retirement age before the planning age under these assumptions."
                        : `Earliest funded annual-age candidate: ${earliest.age} · ${earliest.date}.`}
                    </p>
                  )}
                  <p className="hint">
                    This is a constant-return scenario, not a prediction. Taxes,
                    fees, volatility and investment liquidity restrictions are
                    not modeled.
                  </p>
                </>
              )}
            </div>
          </section>
          {result && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    Projected portfolio ·{" "}
                    {unit === "USD" ? "USD" : "bitcoin equivalent"}
                  </h2>
                </div>
                <ProjectionChart
                  title="Projected portfolio"
                  unit={unit}
                  points={result.history.map((row) => ({
                    label: row.age,
                    values: {
                      portfolio:
                        unit === "USD"
                          ? row.portfolio_usd
                          : row.portfolio_bitcoin,
                    },
                  }))}
                  series={[
                    { key: "portfolio", label: "Portfolio", color: colors[0] },
                  ]}
                />
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Bitcoin holdings · whole units</h2>
                </div>
                <ProjectionChart
                  title="Projected bitcoin holdings"
                  unit="BITCOIN"
                  points={result.history.map((row) => ({
                    label: row.age,
                    values: { bitcoin: row.bitcoin },
                  }))}
                  series={[
                    { key: "bitcoin", label: "Bitcoin held", color: colors[1] },
                  ]}
                />
              </section>
              <details className="panel">
                <summary>Price and annual spending</summary>
                <ProjectionChart
                  title="Projected USD price per legacy BTC"
                  unit="USD"
                  points={result.history.map((row) => ({
                    label: row.age,
                    values: { price: row.price_usd },
                  }))}
                  series={[
                    {
                      key: "price",
                      label: "USD per legacy BTC",
                      color: colors[1],
                    },
                  ]}
                />
                <ProjectionChart
                  title="Annual spending in bitcoin"
                  unit="BITCOIN"
                  points={result.history.map((row) => ({
                    label: row.age,
                    values: { spending: row.annual_spending_bitcoin },
                  }))}
                  series={[
                    {
                      key: "spending",
                      label: "Annual lifestyle cost",
                      color: colors[0],
                    },
                  ]}
                />
              </details>
              <details className="panel">
                <summary>Yearly figures and calculation method</summary>
                <p className="panel-body hint">
                  Annual rates compound monthly. Growth occurs first, then
                  month-end contributions through retirement, then retirement
                  expenses in subsequent months. Opening liabilities are settled
                  immediately. Cash, other assets, then bitcoin fund
                  obligations. Bitcoin buys round down to affordable whole
                  units, with unused purchase funds retained as cash;
                  withdrawals round up, with excess proceeds retained as cash.
                  Unmet spending is recorded as a shortfall without borrowing.
                  Ages assume birthdays on the starting date.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Age</th>
                        <th>Bitcoin held</th>
                        <th>Other assets · USD</th>
                        <th>Cash · USD</th>
                        <th>Portfolio · USD</th>
                        <th>Cumulative withdrawals · USD</th>
                        <th>Unfunded · USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.history.map((row) => (
                        <tr key={row.month}>
                          <td>{row.age}</td>
                          <td>
                            <Money value={row.bitcoin} unit="BITCOIN" />
                          </td>
                          <td>
                            <Money value={row.other_assets_usd} unit="USD" />
                          </td>
                          <td>
                            <Money value={row.cash_usd} unit="USD" />
                          </td>
                          <td>
                            <Money value={row.portfolio_usd} unit="USD" />
                          </td>
                          <td>
                            <Money value={row.withdrawals_usd} unit="USD" />
                          </td>
                          <td>
                            <Money value={row.shortfall_usd} unit="USD" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Compare saved scenarios</h2>
          <span className="hint">Up to four · saved inputs</span>
        </div>
        <div className="panel-body stack">
          {!scenarios.length && (
            <p className="hint">
              Save a scenario, change an assumption, then save a copy to
              compare.
            </p>
          )}
          <div className="button-row">
            {scenarios.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={compared.includes(s.id)}
                  disabled={!compared.includes(s.id) && compared.length >= 4}
                  onChange={(e) =>
                    setCompared((ids) =>
                      e.target.checked
                        ? [...ids, s.id]
                        : ids.filter((id) => id !== s.id),
                    )
                  }
                />{" "}
                {s.name}
              </label>
            ))}
          </div>
          {compareError && (
            <div className="alert error" role="alert">
              {compareError}
            </div>
          )}
          {!!comparisons.length && (
            <>
              <ProjectionChart
                title="Scenario portfolio comparison"
                unit={unit}
                connectNulls
                points={Array.from(
                  new Set(
                    comparisons.flatMap((c) =>
                      c.result.history.map((r) => r.date),
                    ),
                  ),
                )
                  .sort()
                  .map((date) => ({
                    label: date,
                    values: Object.fromEntries(
                      comparisons.map((c) => {
                        const row = c.result.history.find(
                          (r) => r.date === date,
                        );
                        return [
                          String(c.id),
                          (unit === "USD"
                            ? row?.portfolio_usd
                            : row?.portfolio_bitcoin) ?? null,
                        ];
                      }),
                    ),
                  }))}
                series={comparisons.map((c, i) => ({
                  key: String(c.id),
                  label: c.name,
                  color: colors[i],
                }))}
              />
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Starting date</th>
                      <th>Appreciation</th>
                      <th>Retirement</th>
                      <th>Bitcoin at retirement</th>
                      <th>Annual spending · USD</th>
                      <th>Total withdrawals · USD</th>
                      <th>Unfunded obligations · USD</th>
                      <th>First unmet obligation</th>
                      <th>Remaining portfolio · USD</th>
                      <th>End target surplus / shortfall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisons.map(({ id, name, result: r }) => (
                      <tr key={id}>
                        <td>{name}</td>
                        <td>{r.assumptions.as_of}</td>
                        <td>{r.assumptions.appreciation_pct}%</td>
                        <td>{r.retirement.date}</td>
                        <td>
                          <Money value={r.retirement.bitcoin} unit="BITCOIN" />
                        </td>
                        <td>
                          <Money
                            value={r.retirement.annual_spending_usd}
                            unit="USD"
                          />
                        </td>
                        <td>
                          <Money value={r.end.withdrawals_usd} unit="USD" />
                        </td>
                        <td>
                          <Money value={r.shortfall_usd} unit="USD" />
                        </td>
                        <td>{r.depletion_date ?? "None within plan"}</td>
                        <td>
                          <Money value={r.end.portfolio_usd} unit="USD" />
                        </td>
                        <td>
                          <Money value={r.target_surplus_usd} unit="USD" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">
                Each line uses its saved starting date, price, assumptions and
                planning horizon. Bitcoin equivalents include other assets
                converted at each scenario’s projected price.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
