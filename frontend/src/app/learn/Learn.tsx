import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { CostOfLivingPanel, useSpendingData } from "../dashboard/history";
import type { DashboardData } from "../dashboard/types";
import { LevelIcon } from "../design/icons";
import { cents, fromCents, longMonth, plural, usd } from "../lib/format";
import type { Route } from "../lib/router";
import "./learn.css";
import { SUPPLY, parseBtc, parseWhole, wholeText, wholeToBtc } from "./units";

/** Every topic has a stable id, so any screen can link to `#/learn/<id>`. */
export const LEARN_TOPICS = [
  { id: "cost-of-living", title: "The same life, priced two ways" },
  { id: "bitcoin-is-saving", title: "Dollars are for spending. Bitcoin is for saving." },
  { id: "units", title: "₿125,000, not 0.00125 BTC" },
  { id: "stack-rate", title: "Stack rate: the score" },
  { id: "bills", title: "What to do with a bill" },
  { id: "prices", title: "How things get a bitcoin price" },
  { id: "alert-lights", title: "What the alert lights mean" },
  { id: "private", title: "Yours, on your machine" },
] as const;
export type LearnTopic = (typeof LEARN_TOPICS)[number]["id"];
/** The link to one topic, for `href` or `window.location.hash`. */
export const learnHash = (id: LearnTopic) => `#/learn/${id}`;

/** The topic named after the screen in the address, if it is one of ours. */
export function topicFromHash(hash: string): LearnTopic | null {
  const [screen, part] = hash.replace(/^#\/?/, "").split(/[/?]/);
  return screen === "learn" && LEARN_TOPICS.some((topic) => topic.id === part) ? (part as LearnTopic) : null;
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function jumpTo(id: LearnTopic, smooth: boolean) {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView?.({ behavior: smooth && !reducedMotion() ? "smooth" : "auto", block: "start" });
  section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

/** The one place that explains. Working screens carry the numbers; this carries the reasons. */
export function Learn({ go }: { go: (route: Route) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<LearnTopic>(() => topicFromHash(window.location.hash) ?? LEARN_TOPICS[0].id);
  const spending = useSpendingData(data);

  useEffect(() => {
    let alive = true;
    api<DashboardData>("/dashboard")
      .then((next) => alive && setData(next))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // A link to one topic lands on it, and its heading takes focus so a screen reader starts there.
  useEffect(() => {
    const follow = (smooth: boolean) => {
      const topic = topicFromHash(window.location.hash);
      if (!topic) return;
      setActive(topic);
      jumpTo(topic, smooth);
    };
    follow(false);
    const onChange = () => follow(true);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // The reader's own figures arrive after the page; hold the linked topic in place when they do.
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || (!data && !failed)) return;
    settled.current = true;
    const topic = topicFromHash(window.location.hash);
    if (topic && topic !== LEARN_TOPICS[0].id) jumpTo(topic, false);
  }, [data, failed]);

  // The contents list follows the section being read, where the browser can tell us.
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id as LearnTopic);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const topic of LEARN_TOPICS) {
      const section = document.getElementById(topic.id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  const title = (id: LearnTopic) => LEARN_TOPICS.find((topic) => topic.id === id)!.title;
  const section = (id: LearnTopic, children: ReactNode) => (
    <section id={id} className="lrn-section" aria-labelledby={`${id}-title`}>
      <p className="lrn-count">
        {LEARN_TOPICS.findIndex((topic) => topic.id === id) + 1} of {LEARN_TOPICS.length}
      </p>
      <h2 id={`${id}-title`} tabIndex={-1}>
        {title(id)}
      </h2>
      {children}
    </section>
  );
  const next = (label: string, route: Route) => (
    <p className="lrn-next">
      <button className="btn" onClick={() => go(route)}>
        {label} <span aria-hidden="true">→</span>
      </button>
    </p>
  );

  const stack = data?.stack;
  const destroyed = data?.bills.destroyed;

  return (
    <div className="page lrn">
      <header className="lrn-head">
        <h1 className="lrn-title">Learn</h1>
        <p className="lrn-lede">
          How this ledger thinks about money, and why it shows what it shows. Eight short pieces. Read them in any order.
        </p>
      </header>
      <div className="lrn-layout">
        <nav className="lrn-toc" aria-label="Topics">
          <ol>
            {LEARN_TOPICS.map((topic) => (
              <li key={topic.id}>
                <a href={learnHash(topic.id)} aria-current={active === topic.id ? "true" : undefined}>
                  {topic.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="lrn-article">
          {section(
            "cost-of-living",
            <>
              <p>
                Your life costs something every month: rent, food, power, the phone. This ledger adds that up twice. Once in dollars, the way your bank
                shows it. Once in bitcoin, using the price on the day you paid for each thing.
              </p>
              <p>
                Then it compares every month with the first full month you recorded. If the same kind of month takes more dollars than it did back then,
                the dollar line rises. If it takes less bitcoin, the bitcoin line falls.
              </p>
              <div className="lrn-figure">
                {data ? (
                  <CostOfLivingPanel data={data} periods={spending.periods} onWhy={() => (window.location.hash = learnHash("bitcoin-is-saving").slice(1))} />
                ) : (
                  <div className="inst inop lrn-wait" aria-busy={!failed}>
                    <span className="inst-name">Cost of living</span>
                    <span className="sub">{failed ? "Your own numbers could not be loaded just now. The rest of this page does not need them." : "Loading your own numbers…"}</span>
                  </div>
                )}
              </div>
              <p>
                Nothing in that panel is a forecast. It is your own spending, priced at what bitcoin actually cost on each day. The price of bitcoin moves
                both ways, and in some months the bitcoin line will rise.
              </p>
              {next("See this month's spending", "spending")}
            </>,
          )}

          {section(
            "bitcoin-is-saving",
            <>
              <p>
                A dollar is good at one job: paying for what you need this month. Everyone takes it, and what it buys barely changes from one week to
                the next.
              </p>
              <p>
                It is poor at a second job: holding value for years. Over long stretches, prices in dollars rise, so a dollar kept for ten years buys
                less at the end than it did at the start. That loss is quiet, and it never shows up on a bank statement.
              </p>
              <p>
                Bitcoin is built the other way round. There will never be more than 21 million BTC, and the rules of the network let nobody make more. Its price in dollars
                swings hard, sometimes for years, which makes it a poor place for next month's rent. Held for the long run, it is the money this ledger
                treats as saving.
              </p>
              <p>
                So there are no dollar savings in this app. Dollars are counted as what you can spend. What you keep, you keep in bitcoin. Doing that
                month after month is called stacking, and winning is that simple to describe: keep stacking.
              </p>
              <h3>Three kinds of weapon</h3>
              <p>Money is what you carry into a future nobody can see. Each kind does a different job.</p>
              <ul className="lrn-three">
                <li className="inst">
                  <span className="inst-name">
                    <i className="lrn-dot" style={{ background: "var(--usd)" }} />
                    Dollars
                  </span>
                  <dl>
                    <dt>Good for</dt>
                    <dd>This month's bills.</dd>
                    <dt>Weak at</dt>
                    <dd>Lasting. They buy less the longer you hold them.</dd>
                    <dt>In this app</dt>
                    <dd>Dollars in checking.</dd>
                  </dl>
                </li>
                <li className="inst">
                  <span className="inst-name btc">
                    <i className="lrn-dot" style={{ background: "var(--btc)" }} />
                    Bitcoin
                  </span>
                  <dl>
                    <dt>Good for</dt>
                    <dd>Keeping what you earned, for years.</dd>
                    <dt>Weak at</dt>
                    <dd>The short run. Its dollar price is volatile.</dd>
                    <dt>In this app</dt>
                    <dd>Your stack.</dd>
                  </dl>
                </li>
                <li className="inst">
                  <span className="inst-name">
                    <i className="lrn-dot" style={{ background: "var(--ink-3)" }} />
                    Stocks
                  </span>
                  <dl>
                    <dt>Good for</dt>
                    <dd>Growth that depends on businesses doing well.</dd>
                    <dt>Weak at</dt>
                    <dd>Being money. A share is a claim on a company, priced in dollars.</dd>
                    <dt>In this app</dt>
                    <dd>Under Accounts, valued in dollars.</dd>
                  </dl>
                </li>
              </ul>
              <p className="lrn-aside">
                This is how the ledger is organised, not advice about your situation. Bitcoin can lose value, and money you will need soon belongs in
                dollars.
              </p>
              {next("See your stack", "stack")}
            </>,
          )}

          {section(
            "units",
            <>
              <p>
                Bitcoin is counted here in whole units, written with the <b className="btc">₿</b> sign. <span className="num">₿1</span> is the smallest
                amount of bitcoin there is. It cannot be divided.
              </p>
              <p>
                The older way of writing amounts uses a unit one hundred million times larger, labelled BTC. <span className="num">1 BTC</span> is{" "}
                <span className="num">₿100,000,000</span>. Both describe the same bitcoin.
              </p>
              <p>
                This app uses whole units because that is how the bitcoin network itself counts, and because a whole number is easier to read and compare
                than a row of zeros after a decimal point. A coffee at <span className="num">₿4,200</span> is easier to hold in your head than{" "}
                <span className="num">0.000042 BTC</span>.
              </p>
              <Converter />
              <table className="lrn-table">
                <caption className="sr">The same amounts written both ways</caption>
                <thead>
                  <tr>
                    <th scope="col">Whole bitcoin</th>
                    <th scope="col">Written as BTC</th>
                    <th scope="col">What it is</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      [1n, "The smallest unit"],
                      [125_000n, "A typical small buy"],
                      [100_000_000n, "One BTC"],
                      [SUPPLY, "All there will ever be"],
                    ] as const
                  ).map(([units, note]) => (
                    <tr key={note}>
                      <td className="num btc">₿{wholeText(units)}</td>
                      <td className="num">{wholeToBtc(units)} BTC</td>
                      <td>{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                You will still see BTC in one place: prices. Dollars per BTC is how the price is usually quoted, so price screens show it, always
                labelled <span className="num">BTC</span>. The top bar shows the same price the other way round, as bitcoin per dollar.
              </p>
              {next("Add or check a wallet", "accounts")}
            </>,
          )}

          {section(
            "stack-rate",
            <>
              <p>Stack rate is the share of your income that you turned into bitcoin in a month.</p>
              <div className="lrn-formula" role="img" aria-label="Stack rate equals the dollars you spent buying bitcoin this month, divided by the income recorded this month.">
                <span>Stack rate</span>
                <span aria-hidden="true">=</span>
                <span className="lrn-fraction">
                  <span>dollars spent buying bitcoin this month</span>
                  <span>income recorded this month</span>
                </span>
              </div>
              <p>
                If <span className="num">$5,000</span> of income landed and you bought <span className="num">$600</span> of bitcoin, your stack rate is{" "}
                <span className="num">12%</span>.
              </p>
              {stack && stack.status === "ready" && data && (
                <p className="lrn-yours">
                  {stack.stack_rate !== null ? (
                    <>
                      Your stack rate so far in {longMonth(data.month)} is <b className="num btc">{stack.stack_rate}%</b>, from{" "}
                      {plural(stack.buys.count, "buy")} for <span className="num">{usd(stack.buys.usd)}</span>.
                    </>
                  ) : (
                    <>No income is recorded for {longMonth(data.month)} yet, so there is no stack rate for it. Record a paycheck and it appears.</>
                  )}
                </p>
              )}
              <p>
                Higher is better. It works like a savings rate, except that what you save is bitcoin. It counts only what you bought. Bitcoin you already
                held does not move it, and neither does the price going up or down. That keeps it a measure of what you did, not of what the market did.
              </p>
              <p>A month with income and no buys scores 0%. A month with no income recorded has no score at all.</p>
              {next("See your stack rate by month", "stack")}
            </>,
          )}

          {section(
            "bills",
            <>
              <p>
                Bills are paid with the dollars in your checking account. Before each paycheck lands, the Bills screen shows whether checking covers
                everything that is due.
              </p>
              <p>There are three things you can do with a bill.</p>
              <dl className="lrn-terms">
                <dt>Pay</dt>
                <dd>Records this payment. The bill comes back the next time it is due.</dd>
                <dt>Destroy</dt>
                <dd>
                  For a bill you have cancelled for good, like a subscription. It stops coming back, and the app shows what that frees every month and
                  every year.
                </dd>
                <dt>Pay off</dt>
                <dd>For a debt. It pays the whole balance from checking and destroys the bill with it.</dd>
              </dl>
              <p>
                Each one asks you to confirm first. Destroying a bill here does not cancel it with the company. Do that too, or you will still be
                charged.
              </p>
              <p>
                A bill you charge to a card still counts. Nothing leaves checking that day, but the card has to be paid from checking later. The checking
                forecast pays each card off in full on its due day, as one more step down on the same line, so the dollars it will take never look free. Set
                a card's due day on Accounts, or right on the forecast when it asks. A card you are paying down with a bill of its own keeps that bill as its
                plan.
              </p>
              <p>
                A destroyed bill is the best kind of win, because it repeats. <span className="num">$30</span> a month you no longer owe is{" "}
                <span className="num">$360</span> a year you can stack instead, every year.
              </p>
              {destroyed && destroyed.count > 0 && destroyed.monthly_freed !== null && (
                <p className="lrn-yours">
                  You have destroyed {plural(destroyed.count, "bill")} so far. That frees <b className="num">{usd(destroyed.monthly_freed)}</b> a month,{" "}
                  <span className="num">{usd(fromCents(cents(destroyed.monthly_freed) * 12n))}</span> a year.
                </p>
              )}
              {next("Go to your bills", "bills")}
            </>,
          )}

          {section(
            "prices",
            <>
              <p>
                When you record an expense, the ledger saves what it cost in bitcoin on the day you paid, using the bitcoin price for that day. That
                record is never recalculated. Next year's price does not change what last March's groceries cost.
              </p>
              <p>
                If there is no price for a day, the bitcoin amount is shown as missing. The app never guesses one, and never quietly borrows the price
                from a nearby day. You can fill in a missing day in Settings, by hand or from a price source you choose.
              </p>
              <p>
                The price in the top bar is the latest one the ledger has. It is marked <i>stale</i> when it is older than it should be. A stale price
                is still used for today's dollar values, and the mark is there so you know.
              </p>
              <p>Where prices come from is your choice. Set to Manual, the app never asks the internet for one. You enter each price yourself.</p>
              {next("Choose a price source", "settings")}
            </>,
          )}

          {section(
            "alert-lights",
            <>
              <p>
                The row of lights at the top of the dashboard always stays in the same order, so you learn where each one is. A dark light is in range.
                A lit one has one of three levels, shown by its shape as well as its colour.
              </p>
              <ul className="lrn-levels">
                <li>
                  <span className="lrn-level" style={{ color: "var(--adv)" }}>
                    {LevelIcon.advisory}
                  </span>
                  <div>
                    <b>Advisory</b> <span className="lrn-shape">blue circle</span>
                    <p>Worth knowing. Nothing is wrong yet.</p>
                  </div>
                </li>
                <li>
                  <span className="lrn-level" style={{ color: "var(--caution)" }}>
                    {LevelIcon.caution}
                  </span>
                  <div>
                    <b>Caution</b> <span className="lrn-shape">amber triangle</span>
                    <p>Needs your attention soon, like a bill that is a day late.</p>
                  </div>
                </li>
                <li>
                  <span className="lrn-level" style={{ color: "var(--warn)" }}>
                    {LevelIcon.warning}
                  </span>
                  <div>
                    <b>Warning</b> <span className="lrn-shape">red octagon</span>
                    <p>Needs your attention now, like checking about to run short before payday.</p>
                  </div>
                </li>
              </ul>
              <p>Select a light to see why it is on, the figures behind it, and what would clear it.</p>
              <p>
                Acknowledging a light says you have seen it. It stays lit, hollow, until the cause is fixed, and it returns in full if things get worse.
                Nothing is hidden by acknowledging it.
              </p>
              <p>The limits are yours. Every light can be adjusted or switched off in Settings.</p>
              {next("Adjust the alert lights", "settings")}
            </>,
          )}

          {section(
            "private",
            <>
              <p>
                This ledger runs on your own computer. There is no cloud account, no telemetry and no analytics. It contacts the internet only for
                prices: a bitcoin price source if you switch one on, and quotes for investment holdings if you enter any. It talks to your own
                Bitcoin node only if you connect one.
              </p>
              <p>
                The journal is append-only. An entry is never edited and never deleted. A correction adds a reversal and a replacement, so the history
                always shows what was recorded and when.
              </p>
              <p>
                Because the only copy is yours, the backups are yours to make. Make an encrypted backup regularly and keep it somewhere other than this
                machine. The passphrase is not stored anywhere. Without it, the backup cannot be opened.
              </p>
              {next("Make an encrypted backup", "settings")}
            </>,
          )}
        </article>
      </div>
    </div>
  );
}

/** Type an amount either way and read it the other way. Exact: the arithmetic is whole numbers only. */
function Converter() {
  const [whole, setWhole] = useState("125,000");
  const [legacy, setLegacy] = useState("0.00125");
  const [units, setUnits] = useState<bigint | null>(125_000n);
  const [bad, setBad] = useState<"whole" | "legacy" | null>(null);

  const onWhole = useCallback((text: string) => {
    setWhole(text);
    const parsed = text.trim() === "" ? null : parseWhole(text);
    setUnits(parsed);
    setBad(parsed === null && text.trim() !== "" ? "whole" : null);
    setLegacy(parsed === null ? "" : wholeToBtc(parsed));
  }, []);
  const onLegacy = useCallback((text: string) => {
    setLegacy(text);
    const parsed = text.trim() === "" ? null : parseBtc(text);
    setUnits(parsed);
    setBad(parsed === null && text.trim() !== "" ? "legacy" : null);
    setWhole(parsed === null ? "" : wholeText(parsed));
  }, []);

  return (
    <div className="inst lrn-convert" role="group" aria-label="Convert between whole bitcoin and BTC">
      <label className="field">
        <span>Whole bitcoin (₿)</span>
        <input className="num" inputMode="numeric" value={whole} onChange={(event) => onWhole(event.target.value)} aria-invalid={bad === "whole"} />
      </label>
      <span className="lrn-equals" aria-hidden="true">
        =
      </span>
      <label className="field">
        <span>BTC</span>
        <input className="num" inputMode="decimal" value={legacy} onChange={(event) => onLegacy(event.target.value)} aria-invalid={bad === "legacy"} />
      </label>
      <p className="hint" role="status">
        {bad === "whole"
          ? "Whole bitcoin has no decimal places. Enter a whole number, like 125,000."
          : bad === "legacy"
            ? "BTC has at most eight decimal places, because ₿1 cannot be divided."
            : units === null
              ? "Type an amount in either box."
              : units > SUPPLY
                ? `₿${wholeText(units)} is ${wholeToBtc(units)} BTC. That is more than all the bitcoin there will ever be.`
                : `₿${wholeText(units)} is ${wholeToBtc(units)} BTC.`}
      </p>
    </div>
  );
}
