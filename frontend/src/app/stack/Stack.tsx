import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Account, Transaction } from "../../lib/types";
import { StackTape } from "../dashboard/charts";
import { CostOfLivingPanel, useSpendingData } from "../dashboard/history";
import { Panel } from "../dashboard/panels";
import type { DashboardData } from "../dashboard/types";
import { btc, coordinate, fromCents, longMonth, plural, shortDate, usd } from "../lib/format";
import type { Route } from "../lib/router";
import { HeldChart, RateChart } from "./charts";
import { buysFrom, totals } from "./price";
import type { Buy } from "./price";
import "./stack.css";

type Go = (route: Route) => void;
type Stack = DashboardData["stack"];

/** GET /api/prices/status. Only the fields this screen reads. */
interface PriceStatus {
  source: string;
  automatic: boolean;
  quote: { usd_per_btc: string; observed_at: string; stale: boolean } | null;
  history: { status: string; days_saved: number; days_missing: number; error: string | null; quote_error: string | null } | null;
}

/** How many buys the list shows before "Show all". */
const FIRST = 24;

/** Your bitcoin: what you hold, every buy at the price paid, and the stack rate. */
export function Stack({ go }: { go: (route: Route) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [transfers, setTransfers] = useState<Transaction[] | null>(null);
  const [status, setStatus] = useState<PriceStatus | null>(null);
  const [error, setError] = useState("");
  // Parts that failed on their own; the rest of the screen still shows.
  const [gaps, setGaps] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    const part = <T,>(name: string, path: string, set: (value: T) => void) =>
      api<T>(path)
        .then((value) => {
          set(value);
          setGaps((before) => {
            const rest = { ...before };
            delete rest[name];
            return rest;
          });
        })
        .catch((e) => setGaps((before) => ({ ...before, [name]: (e as Error).message })));
    api<DashboardData>("/dashboard")
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
    void part<Account[]>("Wallets", "/accounts", setAccounts);
    void part<Transaction[]>("Buys", "/transactions?kind=transfer", setTransfers);
    void part<PriceStatus>("Price status", "/prices/status", setStatus);
  }, []);
  useEffect(load, [load]);
  const spending = useSpendingData(data);
  const buys = useMemo(() => (transfers ? buysFrom(transfers) : null), [transfers]);

  if (!data)
    return (
      <div className="page">
        <h1>Stack</h1>
        {error ? (
          <p className="gate-error" role="alert">
            {error}{" "}
            <button className="inst-link" onClick={load}>
              Retry →
            </button>
          </p>
        ) : (
          <div className="meter" style={{ width: "40%" }} aria-busy="true">
            <i style={{ width: "100%", opacity: 0.25 }} />
          </div>
        )}
      </div>
    );

  const wallets = accounts?.filter((account) => account.kind === "bitcoin_wallet" && account.currency === "BITCOIN" && !account.archived) ?? null;
  const trouble = Object.entries(gaps);
  const price = <PricePanel className="c5" data={data} status={status} go={go} />;

  if (data.stack.status === "needs_bitcoin")
    return (
      <div className="page">
        <h1>Stack</h1>
        <div className="grid2">
          <Panel className="c7" name="No bitcoin recorded yet" plain="nothing to show" inop>
            <div className="lead">Bitcoin is your saving. This is where it shows.</div>
            <div className="sub">
              Add a bitcoin wallet with what you hold today. From then on this screen lists every buy at the price you actually paid, your stack rate (the share of income you turn into
              bitcoin) and your next milestone.
            </div>
            <div>
              <button className="btn primary" onClick={() => go("accounts")}>
                Add a bitcoin wallet
              </button>
            </div>
          </Panel>
          {price}
        </div>
      </div>
    );

  return (
    <div className="page">
      <h1>Stack</h1>
      <p className="intro">
        Bitcoin is your saving. Everything you hold, every buy at the price you actually paid, and your stack rate: the share of income you turned into bitcoin. Higher is better.
      </p>
      {trouble.length > 0 && (
        <p className="gate-error" role="alert">
          {trouble.map(([name, message]) => `${name} could not load: ${message}`).join(" ")}{" "}
          <button className="inst-link" onClick={load}>
            Retry →
          </button>
        </p>
      )}
      <div className="grid2">
        <HeldPanel className="c5" data={data} />
        <RatePanel className="c7" stack={data.stack} month={data.month} />
        <WalletsPanel className="c5" wallets={wallets} failed={"Wallets" in gaps} held={data.stack.held} go={go} />
        <BuysPanel className="c7" buys={buys} failed={"Buys" in gaps} data={data} go={go} />
        <CostOfLivingPanel className="c7" data={data} periods={spending.periods} onWhy={() => go("learn")} />
        {price}
      </div>
    </div>
  );
}

function HeldPanel({ className, data }: { className: string; data: DashboardData }) {
  const stack = data.stack;
  const up = !stack.gained.startsWith("-");
  const span = coordinate(stack.milestone.next) - coordinate(stack.milestone.previous);
  const progress = span > 0 ? ((coordinate(stack.held) - coordinate(stack.milestone.previous)) / span) * 100 : 0;
  const toGo = (BigInt(stack.milestone.next) - BigInt(stack.held)).toString();
  return (
    <Panel className={className} name="Held" plain="all your bitcoin">
      <div className="split">
        <StackTape stack={stack} />
        <div className="stk-held">
          <div className="num hero btc">{btc(stack.held)}</div>
          <div className="sub">
            <b className="num btc">
              {up ? "▲" : "▼"} {btc(stack.gained.replace("-", ""))}
            </b>{" "}
            in {longMonth(data.month)}
          </div>
          <div className="sub num">{stack.buys.count ? `${plural(stack.buys.count, "buy")} for ${usd(stack.buys.usd)} this month` : "No buys yet this month"}</div>
          <div className="sub">
            {stack.streak_months > 0 && (
              <>
                <span className="badge">{stack.streak_months}-month streak</span>{" "}
              </>
            )}
            {stack.best_month && (
              <>
                Best month <b className="num btc">{btc(stack.best_month.bitcoin)}</b> in {longMonth(stack.best_month.month)}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="stk-milestone">
        <div className="split sub" style={{ justifyContent: "space-between" }}>
          <span>
            Next milestone <b className="num btc">{btc(stack.milestone.next)}</b>
          </span>
          <span className="num">{btc(toGo)} to go</span>
        </div>
        <div className="meter" role="img" aria-label={`${Math.round(progress)}% of the way from ${btc(stack.milestone.previous)} to ${btc(stack.milestone.next)}`}>
          <i style={{ width: `${Math.max(0, Math.min(100, progress)).toFixed(1)}%`, background: "var(--btc)" }} />
        </div>
      </div>
      {stack.history.length >= 2 ? (
        <HeldChart history={stack.history} />
      ) : (
        <div className="hint">The month-by-month line starts once a second month is on record.</div>
      )}
    </Panel>
  );
}

function RatePanel({ className, stack, month }: { className: string; stack: Stack; month: string }) {
  const known = stack.rates.filter((point) => point.rate !== null);
  const earlier = known.filter((point) => point.month !== month);
  const now = stack.stack_rate;
  const last = earlier.length ? earlier[earlier.length - 1] : null;
  const best = earlier.length ? Math.max(...earlier.map((point) => Number(point.rate))) : null;
  const average = known.length ? known.reduce((sum, point) => sum + Number(point.rate), 0) / known.length : null;
  return (
    <Panel className={className} name="Stack rate" plain="your score · share of income stacked · higher is better">
      <div className="stk-rate">
        <div>
          <b className="num hero btc">{now !== null ? `${now}%` : "—"}</b>
          <span className="sub">{now !== null ? `of ${longMonth(month)}'s income stacked so far` : `No income recorded in ${longMonth(month)} yet, so no rate`}</span>
        </div>
        <dl className="kv stk-kv">
          {last && now !== null && (
            <div>
              <span>vs {longMonth(last.month)}</span>
              <b>
                {Number(now) >= Number(last.rate) ? "▲" : "▼"} {Math.abs(Number(now) - Number(last.rate)).toFixed(1)} pts
              </b>
            </div>
          )}
          {average !== null && known.length > 1 && (
            <div>
              <span>{known.length}-month average</span>
              <b>{average.toFixed(1)}%</b>
            </div>
          )}
          {best !== null && (
            <div>
              <span>Best earlier month</span>
              <b>{best.toFixed(1)}%</b>
            </div>
          )}
        </dl>
      </div>
      {known.length ? (
        <RateChart rates={stack.rates} />
      ) : (
        <div className="hint">The chart starts with the first month that has income. Record a paycheck and a bitcoin buy and the first bar appears.</div>
      )}
      <div className="sub">
        {best !== null && now !== null && Number(now) > best ? (
          <>
            <span className="btc" style={{ fontWeight: 700 }}>
              Best yet.
            </span>{" "}
          </>
        ) : null}
        Stack rate is the bitcoin you bought, as a share of the income recorded in the same month. The dashed line is the average of the months shown.
      </div>
    </Panel>
  );
}

function WalletsPanel({ className, wallets, failed, held, go }: { className: string; wallets: Account[] | null; failed: boolean; held: string; go: Go }) {
  const total = coordinate(held);
  return (
    <Panel className={className} name="Wallets" plain="where it is held" link={{ label: "Accounts", onClick: () => go("accounts") }}>
      {wallets === null ? (
        <div className="sub">{failed ? "Wallets could not be loaded." : "Loading wallets…"}</div>
      ) : wallets.length === 0 ? (
        <div className="sub">No active bitcoin wallet. Add one on the Accounts screen.</div>
      ) : (
        <ul className="stk-wallets">
          {wallets.map((wallet) => {
            const share = total > 0 ? (coordinate(wallet.balance) / total) * 100 : 0;
            return (
              <li key={wallet.id}>
                <span className="stk-name">{wallet.name}</span>
                <b className="num btc">{btc(wallet.balance)}</b>
                <span className="num sub">
                  {wallet.usd !== null ? (
                    <span title={wallet.rate_source && wallet.rate_day ? `At ${wallet.rate_source}, ${shortDate(wallet.rate_day)}` : undefined}>{usd(wallet.usd)} today</span>
                  ) : (
                    <span className="tag miss">no price</span>
                  )}
                </span>
                {wallets.length > 1 && (
                  <div className="meter" role="img" aria-label={`${Math.round(share)}% of your bitcoin`}>
                    <i style={{ width: `${Math.max(0, Math.min(100, share)).toFixed(1)}%`, background: "var(--btc)" }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="hint">Dollar values use today's price and are shown as missing when there is none. The bitcoin amounts are what the ledger records.</div>
    </Panel>
  );
}

function BuysPanel({ className, buys, failed, data, go }: { className: string; buys: Buy[] | null; failed: boolean; data: DashboardData; go: Go }) {
  const [all, setAll] = useState(false);
  if (buys === null)
    return (
      <Panel className={className} name="Buys" plain="every buy at the price paid">
        <div className="sub">{failed ? "Buys could not be loaded." : "Loading buys…"}</div>
      </Panel>
    );
  if (!buys.length)
    return (
      <Panel className={className} name="Buys" plain="every buy at the price paid" inop>
        <div className="sub" style={{ flex: 1 }}>
          No buys recorded yet. The bitcoin you hold so far came from opening balances or other entries. Record a buy and it is listed here with the price you actually paid.
        </div>
        <div>
          <button className="btn sm" onClick={() => go("activity")}>
            Record a bitcoin buy
          </button>
        </div>
      </Panel>
    );
  const sum = totals(buys);
  const shown = all ? buys : buys.slice(0, FIRST);
  const year = data.today.slice(0, 4);
  return (
    <Panel className={className} name="Buys" plain={`every buy at the price paid · ${plural(buys.length, "buy")}`} link={{ label: "Add a buy", onClick: () => go("activity") }}>
      <dl className="kv stk-kv">
        <div>
          <span>Dollars spent</span>
          <b>{usd(fromCents(sum.spent))}</b>
        </div>
        <div>
          <span>Bitcoin bought</span>
          <b className="btc">{btc(sum.bitcoin.toString())}</b>
        </div>
        <div>
          <span>Average price paid</span>
          <b>
            {sum.average ? usd(sum.average) : "—"} <small className="stk-unit">per BTC</small>
          </b>
        </div>
        <div>
          <span>Price today</span>
          <b>
            {data.price ? (
              <>
                {usd(data.price.usd_per_btc)} <small className="stk-unit">per BTC</small>
              </>
            ) : (
              <span className="tag miss">no price</span>
            )}
          </b>
        </div>
      </dl>
      <div className="stk-scroll">
        <table className="log">
          <thead>
            <tr>
              <th>Date</th>
              <th className="hide-s">Paid from → wallet</th>
              <th className="r">Dollars</th>
              <th className="r">Bitcoin</th>
              <th className="r">Paid per BTC</th>
              <th className="r hide-s">Per $1</th>
              <th className="r hide-s">Total so far</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((buy) => (
              <tr key={buy.id}>
                <td className="num dim">
                  {shortDate(buy.date)}
                  {buy.date.slice(0, 4) !== year ? `, ${buy.date.slice(0, 4)}` : ""}
                </td>
                <td className="dim hide-s w" title={buy.description}>
                  {buy.from} → {buy.wallet}
                </td>
                <td className="num r">{usd(fromCents(buy.spent))}</td>
                <td className="num r btc">+{btc(buy.bitcoin.toString())}</td>
                <td className="num r">{buy.price ? usd(buy.price) : <span className="tag miss">no price</span>}</td>
                <td className="num r dim hide-s">{buy.perDollar ? btc(buy.perDollar) : "—"}</td>
                <td className="num r dim hide-s">{btc(buy.soFar.toString())}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {buys.length > FIRST && (
        <div>
          <button className="btn sm" onClick={() => setAll(!all)}>
            {all ? `Show the newest ${FIRST}` : `Show all ${buys.length} buys`}
          </button>
        </div>
      )}
      <div className="hint">
        The price paid is the dollars you spent divided by the bitcoin you received, fees included, exact to the cent. "Total so far" adds up buys only; opening balances are not in it.
      </div>
    </Panel>
  );
}

function PricePanel({ className, data, status, go }: { className: string; data: DashboardData; status: PriceStatus | null; go: Go }) {
  const price = data.price;
  if (!price)
    return (
      <Panel className={className} name="Price" plain="no source chosen" inop>
        <div className="sub" style={{ flex: 1 }}>
          No bitcoin price is on file. Dollar values for your bitcoin, and the bitcoin cost of each expense, are shown as missing until you choose a price source or enter a price by hand.
          Nothing is guessed.
        </div>
        <div>
          <button className="btn sm" onClick={() => go("settings")}>
            Choose a price source
          </button>
        </div>
      </Panel>
    );
  const manual = status?.source === "manual";
  const fault = status?.history?.quote_error || status?.history?.error || null;
  return (
    <Panel className={className} name="Price" plain="what the dollar figures use" link={{ label: "Price settings", onClick: () => go("settings") }}>
      <div className="stk-price">
        <b className="num read btc">{btc(price.bitcoin_per_usd)}</b>
        <span className="sub">per $1</span>
        {price.stale && <span className="tag miss">stale</span>}
      </div>
      <dl className="kv stk-kv">
        <div>
          <span>Per BTC</span>
          <b>{usd(price.usd_per_btc)}</b>
        </div>
        <div>
          <span>Price day</span>
          <b>{shortDate(price.day)}</b>
        </div>
        <div>
          <span>Updates</span>
          <b>{status ? (manual ? "By hand" : status.automatic ? "Automatic" : "On request") : "—"}</b>
        </div>
        {status?.history && (
          <div>
            <span>Daily history</span>
            <b>{plural(status.history.days_saved, "day")}</b>
          </div>
        )}
      </dl>
      <div className="sub">Source: {price.source}</div>
      {price.stale && <div className="sub">This is the last price saved, and it is older than expected. Dollar values use it until a newer one arrives.</div>}
      {status?.history && status.history.days_missing > 0 && (
        <div className="sub">
          <span className="tag miss">{plural(status.history.days_missing, "day")} missing</span> in the saved daily history. Expenses on those days show no bitcoin cost.
        </div>
      )}
      {fault && (
        <div className="sub" role="status">
          Last update failed: {fault}
        </div>
      )}
    </Panel>
  );
}
