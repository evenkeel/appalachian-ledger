/* Clickable prototype of the dashboard. Static: no server, no storage, fictional data. */
(function () {
  const S = { screen: "cockpit", data: "six", cond: "calm", theme: "night", lens: "USD", acks: {}, drawer: null, drill: null, sel: 0, paid: [], gone: [], paidOff: [], boom: null, confirm: null };
  const P = PROTO, D = P.six;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  /* ---------- Icons ---------- */
  const I = {
    advisory: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 7.2v4M8 4.7v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`,
    caution: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.9 14.7 13.6H1.3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 6.3v3.4M8 11.6v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`,
    warning: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.3 1.4h5.4l3.9 3.9v5.4l-3.9 3.9H5.3l-3.9-3.9V5.3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 4.6v4.2M8 11.1v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`,
    ok: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const NAV = [
    ["cockpit", "Dashboard", ic(`<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/><path d="M4 17h16"/>`)],
    ["log", "Activity", ic(`<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>`)],
    ["spending", "Spending", ic(`<path d="M3 17l5-6 4 3 5-8 4 5"/><path d="M3 21h18"/>`)],
    ["bills", "Bills", ic(`<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>`)],
    ["stack", "Stack", ic(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".5"/>`)],
    ["accounts", "Accounts", ic(`<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>`)],
    ["horizon", "Retirement", ic(`<path d="M2 16h20"/><path d="M6 16a6 6 0 0 1 12 0"/><path d="M12 5v2M5 8l1.4 1.4M19 8l-1.4 1.4M5 20h14"/>`)],
    ["learn", "Learn", ic(`<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>`)],
    ["system", "System", ic(`<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>`)],
  ];
  const CRUMB = { cockpit: "Dashboard", log: "Transactions", spending: "Spending", bills: "Bills", stack: "Stack · your bitcoin", accounts: "Accounts", horizon: "Retirement", learn: "Learn", system: "Design system · prototype" };

  /* ---------- Logo ---------- */
  // Three gentle rolling hills, layered like rows of Appalachian ridges:
  // light blue furthest back, orange (bitcoin) in the middle, dark blue in front.
  const spline = (p) => {
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2, f = (n) => +n.toFixed(2);
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
    }
    return d;
  };
  // Free-standing mark, 160 x 40: each ridge tapers to the baseline.
  const RIDGES = [
    ["var(--mark-back)", [[0, 40], [26, 27], [56, 8], [92, 19], [124, 30], [150, 40]]],
    ["var(--mark-mid)", [[30, 40], [74, 31], [108, 13], [140, 26], [160, 40]]],
    ["var(--mark-front)", [[0, 40], [20, 33], [50, 25], [84, 33], [116, 38], [160, 40]]],
  ];
  // App icon, 150 x 44: the same three ridges running edge to edge.
  const BLEED = [
    ["#a9c1cf", [[0, 22], [45, 7], [98, 22], [150, 15]]],
    ["#db8046", [[0, 31], [50, 29], [108, 15], [150, 25]]],
    ["#304e5d", [[0, 33], [42, 27], [98, 38], [150, 34]]],
  ];
  const ridges = () => RIDGES.map(([c, p]) => `<path fill="${c}" d="${spline(p)}Z"/>`).join("");
  const mark = (w) => `<svg viewBox="0 0 160 40" width="${w}" height="${w / 4}" aria-hidden="true">${ridges()}</svg>`;
  let tileN = 0;
  const tile = (size) => {
    const id = "tile" + ++tileN;
    return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="${id}"><rect width="48" height="48" rx="11"/></clipPath></defs>
      <g clip-path="url(#${id})"><rect width="48" height="48" fill="#f8f7f3"/><g transform="translate(-3 18.5) scale(.36)">${BLEED.map(([c, p]) => `<path fill="${c}" d="${spline(p)}V90H0Z"/>`).join("")}</g></g></svg>`;
  };
  const stacked = (w, serif) => `<svg viewBox="0 0 200 78" width="${w}" height="${(w * 78) / 200}" role="img" aria-label="Appalachian Bitcoin">
      <g transform="scale(1.25)">${ridges()}</g>
      <text x="0" y="72" textLength="200" lengthAdjust="spacing" fill="currentColor" style="font-family:${serif ? "Georgia,'Times New Roman',serif" : "var(--font-ui)"};font-size:${serif ? 21 : 13.5}px;${serif ? "font-weight:700" : "letter-spacing:.2em"}">${serif ? "Appalachian Bitcoin" : `APPALACHIAN <tspan font-weight="700">BITCOIN</tspan>`}</text></svg>`;

  /* ---------- Model ---------- */
  function model() {
    const lens = S.lens, t = S.cond === "trouble";
    const fmt = (v) => (lens === "USD" ? F.usd(v) : F.btc(v));
    if (S.data === "day3") {
      const ex = P.day3.expenses;
      let run = 0;
      return {
        day3: true, lens: "USD", fmt: F.usd, checking: P.day3.checking, expenses: ex, log: ex.slice().reverse(),
        pace: { cur: [0].concat(ex.map((e) => (run += e.cents))), prev: null, from: 16 }, spent: sum(ex.map((e) => e.cents)),
        cats: ex.map((e) => [e.cat, e.cents]), alerts: [],
      };
    }
    const extra = t ? [{ day: 8, name: "Tires", cat: "Auto", acct: "Visa", cents: 45420, kind: "expense" }] : [];
    const ex = D.expenses.concat(extra).sort((a, b) => a.day - b.day);
    const missing = t ? new Set(["Hardware store", "Transit pass"]) : new Set();
    const rate = (day) => 850 - day * 0.42;
    const bitcoinAt = (e) => (missing.has(e.name) ? null : Math.round((e.cents / 100) * rate(e.day)));
    const conv = (cents, mo) => (lens === "USD" ? cents : Math.round((cents / 100) * P.RATE[mo]));
    const val = (e) => (lens === "USD" ? e.cents : bitcoinAt(e) ?? Math.round((e.cents / 100) * rate(e.day)));

    // Runway
    const paid = new Set(S.paid), off = new Set(S.paidOff), gone = new Set(S.gone.concat(S.paidOff));
    const allBills = (t ? [D.overdue] : []).concat(D.bills);
    // A debt is destroyed by paying off its whole balance.
    const payoffOf = (b) => (b.card ? D.card.balance[S.cond] : b.debt ? D.mortgage.balance : null);
    const paidCents = sum(allBills.filter((b) => paid.has(b.name)).map((b) => b.cents)) + sum(allBills.filter((b) => off.has(b.name)).map(payoffOf));
    const goneCents = sum(allBills.filter((b) => gone.has(b.name)).map((b) => b.cents));
    const checking = D.checking[S.cond] - paidCents;
    const bills = allBills.filter((b) => !paid.has(b.name) && !gone.has(b.name)).map((b) => ({ ...b }));
    const events = bills.map((b) => ({ ...b, origDay: b.day, overdue: b.day < 0, day: Math.max(0, b.day), pay: false }))
      .concat(D.paydays.map((p) => ({ ...p, pay: true })))
      .sort((a, b) => a.day - b.day || a.pay - b.pay); // same day: bills first (conservative)
    let bal = checking, low = checking, lowDay = 0, dueBefore = 0, shortDay = null;
    const firstPay = D.paydays[0].day;
    const steps = events.map((e) => {
      bal += e.pay ? e.cents : -e.cents;
      if (!e.pay && e.day <= firstPay) dueBefore += e.cents;
      if (bal < low && e.day <= firstPay) (low = bal), (lowDay = e.day);
      if (bal < 0 && shortDay === null && e.day <= firstPay) shortDay = e.day;
      return { ...e, after: bal };
    });
    let b2 = checking, covered = 60;
    for (const e of bills.concat(D.bills.filter((b) => !gone.has(b.name)).map((b) => ({ ...b, day: b.day + 30 }))).sort((a, b) => a.day - b.day)) {
      b2 -= e.cents;
      if (b2 < 0) { covered = Math.max(0, e.day) - 1; break; }
    }
    const runway = { start: checking, steps, low, lowDay, shortDay, dueBefore, covered, firstPay, maxBill: Math.max(1, ...bills.map((b) => b.cents)) };

    // Spending
    const catNames = [...new Set(ex.map((e) => e.cat))];
    const catNow = Object.fromEntries(catNames.map((c) => [c, sum(ex.filter((e) => e.cat === c).map(val))]));
    const spentUsd = sum(ex.map((e) => e.cents)), spent = sum(ex.map(val));
    const daily = Array.from({ length: 19 }, (_, i) => sum(ex.filter((e) => e.day === i + 1).map(val)));
    let c1 = 0, c2 = 0;
    const cur = daily.map((v) => (c1 += v)), prev = D.octDaily.map((v) => (c2 += conv(v, "oct")));
    const prior = prev[18];
    const steps2 = catNames.map((c) => ({ name: c, was: conv(D.octCats[c] || 0, "oct"), now: catNow[c] }))
      .map((s) => ({ ...s, change: s.now - s.was })).filter((s) => s.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const priorCats = sum(catNames.map((c) => conv(D.octCats[c] || 0, "oct")));
    let run = priorCats;
    for (const s of steps2) { s.start = run; run += s.change; s.end = run; }
    const bridge = { prior: priorCats, current: run, steps: steps2 };

    // Month flow
    const stackUsd = sum(D.other.filter((o) => o.kind === "stack").map((o) => o.cents));
    const stackBtc = sum(D.other.filter((o) => o.kind === "stack").map((o) => o.bitcoin));
    const incomeUsd = sum(D.income.map((i) => i[1])), movesUsd = sum(D.moves.map((i) => i[1]));
    const restUsd = incomeUsd - spentUsd - stackUsd - movesUsd;
    const cv = (c) => conv(c, "nov");
    const flow = {
      sources: D.income.map(([name, v]) => ({ name, v: cv(v) })),
      dests: [{ name: "Bitcoin stacked", v: lens === "USD" ? stackUsd : stackBtc, kind: "stack", label: lens === "USD" ? `${F.btc(stackBtc)} · ${F.usd(stackUsd)}` : F.btc(stackBtc), note: "2 buys · actual amounts received" }]
        .concat(catNames.map((c) => ({ name: c, v: catNow[c], kind: "spend", drill: true })).sort((a, b) => b.v - a.v))
        .concat(D.moves.map(([name, v]) => ({ name: "To " + name.toLowerCase(), v: cv(v), kind: "move" })))
        .concat([{ name: "Still in checking", v: 0, kind: "rest", note: "Not assigned yet. Dollars waiting, not savings." }]),
    };
    const assigned = sum(flow.dests.map((d) => d.v));
    flow.dests[flow.dests.length - 1].v = Math.max(0, sum(flow.sources.map((s) => s.v)) - assigned);

    const card = { ...D.card, balance: allBills.some((b) => b.card && off.has(b.name)) ? 0 : D.card.balance[S.cond] };
    card.util = (card.balance / card.limit) * 100;
    const m = {
      lens, fmt, t, checking, bills, runway, payoffOf, boom: S.boom, paidStats: { n: 6 + paid.size, cents: 121450 + paidCents }, goneStats: { n: 2 + gone.size, cents: 3198 + goneCents }, expenses: ex, bitcoinAt, missing, rate,
      pace: { cur, prev, from: 1 }, spent, spentUsd, prior: priorCats, bridge, flow, catNow, catNames,
      stack: { ...D.stack, buys: D.other.filter((o) => o.kind === "stack"), stackUsd, stackBtc, rate: (stackUsd / incomeUsd) * 100, rates: D.stack.rates.concat([["Nov", Math.round((stackUsd / incomeUsd) * 1000) / 10]]) },
      incomeUsd, movesUsd, restUsd, two: D.twoSystems, card, mortgage: D.mortgage,
      log: ex.concat(D.other).sort((a, b) => b.day - a.day),
    };
    m.alerts = alerts(m);
    return m;
  }

  /* ---------- Annunciator ---------- */
  const LAMPS = [["overdue", "Bill overdue"], ["cash", "Cash short"], ["card", "Card due"], ["pace", "Spend pace"], ["util", "Credit use"], ["allow", "Allowance"], ["price", "Price feed"], ["conv", "Missing price"], ["backup", "Backup"], ["stack", "No stack yet"]];
  const RANK = { warning: 3, caution: 2, advisory: 1 };
  function alerts(m) {
    if (!m.t) return [];
    const r = m.runway, diff = m.spentUsd - 179255, pct = (diff / 179255) * 100;
    const late = m.bills.filter((b) => b.day < 0), c = m.card;
    const kv = (rows) => `<div class="kv">${rows.map(([k, v, cls]) => `<div><span>${k}</span><b class="${cls || ""}">${v}</b></div>`).join("")}</div>`;
    const li = (left, sub, right, btn = "") => `<li style="grid-template-columns:minmax(0,1fr) auto auto;align-items:center"><span class="nm">${left}${sub ? ` <small class="num dim">· ${sub}</small>` : ""}</span><span class="num">${right}</span>${btn}</li>`;
    const before = m.bills.filter((b) => b.day <= r.firstPay);
    const underBy = c.balance - Math.floor(c.limit * 0.3);
    const lost = m.expenses.filter((e) => m.missing.has(e.name));
    return [
      late.length && { id: "overdue", level: "warning", sev: 3, inst: "bills", title: `${late[0].name} was due ${F.date(late[0].day)}`,
        why: `${-late[0].day} days past due. Late fees start small and grow, and a lapse is harder to undo than a payment.`,
        detail: `<ul class="rows">${late.map((b) => li(esc(b.name), `${-b.day} days late`, F.usd(b.cents))).join("")}</ul>`,
        acts: `<button class="btn primary" data-pay="${esc(late[0].name)}">Pay it now</button>` },
      r.low < 0 && { id: "cash", level: "warning", sev: -r.low, inst: "runway", title: `Checking runs short on ${F.date(r.shortDay)}`,
        why: `The bills due before your ${F.date(r.firstPay)} paycheck add up to more than checking holds.`,
        detail: kv([["In checking", F.usd(m.checking)], ["Bills before payday", F.usd(r.dueBefore)], ["Short by", F.usd(-r.low), "warnc"]]) +
          `<ul class="rows">${before.map((b) => li(esc(b.name), b.day < 0 ? "overdue" : F.date(b.day), F.usd(b.cents))).join("")}</ul>
          <p>To clear this: get at least <b class="num">${F.usd(-r.low)}</b> more into checking before ${F.date(r.shortDay)}.</p>`,
        acts: `<button class="btn primary" data-go="accounts">Move money in →</button>` },
      { id: "pace", level: "caution", sev: pct, inst: "pace", title: `Spending is ${F.usd(diff)} ahead of October`,
        why: `That is ${pct.toFixed(0)}% more than you had spent by October 19.`,
        detail: kv([["Nov 1–19", F.usd(m.spentUsd)], ["Oct 1–19", F.usd(179255)], ["Difference", "+" + F.usd(diff)]]) +
          `<div class="hint" style="margin-top:2px">Biggest increases</div><ul class="rows">${m.bridge.steps.filter((s) => s.change > 0).slice(0, 3).map((s) => li(esc(s.name), "", "+" + m.fmt(s.change))).join("")}</ul>
          <p class="hint">This light comes on at 20% and $150 ahead of last month, from day 5.</p>`,
        acts: `<button class="btn primary" data-go="spending">Open the spending bridge →</button>` },
      { id: "util", level: "caution", sev: c.util, inst: "debt", title: `${c.name} is at ${c.util.toFixed(0)}% of its limit`,
        why: "A balance this high costs interest and leaves little room for an emergency.",
        detail: kv([["Balance", F.usd(c.balance)], ["Limit", F.usd0(c.limit)], ["Used", c.util.toFixed(0) + "%"]]) +
          `<div class="bar" style="margin:4px 0"><i style="width:${Math.min(c.util, 100)}%"></i><u style="left:30%"></u></div>
          <p>Pay <b class="num">${F.usd(underBy)}</b> to get back under your 30% line.</p>`,
        acts: `<button class="btn primary" data-go="accounts">Plan a payment →</button>` },
      { id: "backup", level: "caution", sev: 34, title: "Last encrypted backup was 34 days ago",
        why: "This ledger lives only on this machine. A backup is the only copy that survives a failed disk.",
        detail: kv([["Last backup", "Oct 16"], ["Days ago", "34"], ["Entries since", "61"]]),
        acts: `<button class="btn primary" data-go="system">Back up now →</button>` },
      { id: "conv", level: "advisory", sev: lost.length, inst: "log", title: `${lost.length} expenses have no purchase-date bitcoin price`,
        why: "Their bitcoin cost is shown as missing, never guessed. Totals that include them are marked partial until a dated price is saved.",
        detail: `<ul class="rows">${lost.map((e) => li(esc(e.name), `Nov ${e.day}`, F.usd(e.cents))).join("")}</ul>`,
        acts: `<button class="btn primary" data-go="log">Review missing prices →</button>` },
    ].filter(Boolean);
  }
  const isAcked = (a) => S.acks[a.id] && S.acks[a.id].level === a.level && a.sev <= S.acks[a.id].sev;
  const flag = (m, inst) => {
    const a = m.alerts.filter((x) => x.inst === inst).sort((x, y) => RANK[y.level] - RANK[x.level])[0];
    return a ? { cls: ` flag-${a.level}`, chip: `<button class="flagchip ${a.level}" data-open="${a.id}">${I[a.level]}${a.level}</button>` } : { cls: "", chip: "" };
  };

  function annunciator(m) {
    const lit = Object.fromEntries(m.alerts.map((a) => [a.id, a]));
    const n = m.alerts.length;
    const state = n
      ? `<span class="annun-state">${n} active</span>`
      : `<span class="annun-state ok">${I.ok} All normal</span>`;
    return `<section class="annun" aria-label="Alerts">${state}<div class="lamps" role="list">${LAMPS.map(([id, label]) => {
      const a = lit[id];
      return a
        ? `<button role="listitem" class="lamp on l-${a.level}${isAcked(a) ? " acked" : ""}" data-open="${id}" aria-label="${a.level}: ${label}. ${esc(a.title)}${isAcked(a) ? " (acknowledged)" : ""}">${I[a.level]}<span>${label}</span></button>`
        : `<span role="listitem" class="lamp" aria-label="${label}: normal">${label}</span>`;
    }).join("")}</div></section>`;
  }
  function master(m) {
    const open = m.alerts.filter((a) => a.level !== "advisory");
    const un = open.filter((a) => !isAcked(a));
    const top = un.some((a) => a.level === "warning") ? "warn" : un.length ? "caution" : "";
    const cls = top ? ` is-${top}` : open.length ? " is-acked" : "";
    const txt = top ? (top === "warn" ? "Warnings" : "Cautions") : open.length ? `${open.length} acknowledged` : "No alerts";
    return `<button class="master${cls}" data-master aria-label="${txt}. ${un.length} unacknowledged.">${top === "warn" ? I.warning : I.caution}<span class="txt">${txt}</span>${un.length ? `<span class="num">${un.length}</span>` : ""}</button>`;
  }
  function drawer(m) {
    if (S.drawer === null) return "";
    const list = m.alerts.slice().sort((a, b) => RANK[b.level] - RANK[a.level]);
    const name = (a) => LAMPS.find((l) => l[0] === a.id)[1];
    const one = list.find((a) => a.id === S.drawer);
    const close = `<button class="btn sm ghost" data-close aria-label="Close">Close <kbd>Esc</kbd></button>`;
    if (one) {
      const others = list.filter((a) => a !== one);
      return `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-label="${name(one)}" aria-modal="true">
        <header><h2>${name(one)}</h2>${close}</header>
        <div class="body"><article class="alert ${one.level}">
          <span class="flagchip ${one.level}">${I[one.level]}${one.level}${isAcked(one) ? " · acknowledged" : ""}</span>
          <h3>${esc(one.title)}</h3><p>${esc(one.why)}</p>${one.detail}
          <div class="acts">${one.acts}${isAcked(one) ? "" : `<button class="btn ghost" data-ack="${one.id}">Acknowledge</button>`}</div>
          ${isAcked(one) ? `<p class="hint">Stays lit until fixed. Comes back to your attention if it gets worse.</p>` : ""}</article>
          ${others.length ? `<div class="hint" style="margin-top:6px">Other alerts</div><div class="others">${others.map((a) => `<button class="lamp on l-${a.level}${isAcked(a) ? " acked" : ""}" data-open="${a.id}">${I[a.level]}<span>${name(a)}</span></button>`).join("")}</div>` : ""}
        </div></aside>`;
    }
    return `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-label="All alerts" aria-modal="true">
      <header><h2>All alerts · ${list.length} active</h2>${list.some((a) => !isAcked(a)) ? `<button class="btn sm" data-ackall>Acknowledge all</button>` : ""}${close}</header>
      <div class="body">${list.length ? list.map((a) => `<button class="alert ${a.level} alert-row" data-open="${a.id}">
        <span class="flagchip ${a.level}">${I[a.level]}${name(a)}${isAcked(a) ? " · acknowledged" : ""}</span><span class="t">${esc(a.title)}</span><span class="dim">Details →</span></button>`).join("")
        : `<p class="sub">${I.ok} All normal. Nothing needs you.</p>`}
        <p class="hint">Thresholds are adjustable in Settings → Alerts.</p></div></aside>`;
  }

  function confirmSheet(m) {
    const b = S.confirm && (m.bills || []).find((x) => x.name === S.confirm.name);
    if (!b) return "";
    const fixed = b.debt || b.card;
    if (S.confirm.mode === "payoff") {
      const amt = m.payoffOf(b), enough = amt <= m.checking, label = esc(b.name.replace(" payment", ""));
      return `<div class="scrim" data-cancel></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Pay off ${label}">
        <h2>Pay off ${label} and destroy it?</h2>
        <p class="sub">This pays the whole balance, <b class="num">${F.usd(amt)}</b>, from checking. The bill is destroyed and stops coming back, which frees <b class="num">${F.usd(b.cents)}</b> a month.</p>
        ${enough ? `<div class="sub num">Ammo after this: <b>${F.usd(m.checking - amt)}</b></div>${b.card ? `<p class="hint">A card bill comes back if you use the card again.</p>` : ""}` : `<p class="sub"><b class="warnc">Not enough ammo.</b> Checking holds <span class="num">${F.usd(m.checking)}</span>; you need <b class="num">${F.usd(amt - m.checking)}</b> more.</p>`}
        <div class="acts"><button class="btn primary" data-fire id="fire"${enough ? "" : " disabled"}>Pay off <kbd>⏎</kbd></button><button class="btn ghost" data-cancel>Cancel <kbd>Esc</kbd></button></div></div>`;
    }
    if (S.confirm.mode === "destroy")
      return `<div class="scrim" data-cancel></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Destroy ${esc(b.name)}">
        <h2>Destroy ${esc(b.name)} for good?</h2>
        <p class="sub">It stops coming back. That frees <b class="num">${F.usd(b.cents)}</b> a month, <b class="num">${F.usd(b.cents * 12)}</b> a year you could stack instead.</p>
        <p class="hint">This removes the bill here only. Cancel it with the provider too, or it will still be charged.</p>
        <div class="acts"><button class="btn primary" data-fire id="fire">Destroy <kbd>⏎</kbd></button><button class="btn ghost" data-cancel>Keep it <kbd>Esc</kbd></button></div></div>`;
    return `<div class="scrim" data-cancel></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Pay ${esc(b.name)}">
      <h2>Pay ${esc(b.name)}</h2>
      <p class="sub">This records the payment in your ledger. Change the date or amount if the real payment was different.</p>
      <div class="sheet-fields">
        <label class="field"><span>Paid on</span><input value="${F.date(0)}" aria-label="Paid on"></label>
        <label class="field"><span>Amount</span><input class="num" value="${F.usd(b.cents)}" aria-label="Amount"></label>
        <label class="field" style="grid-column:1/-1"><span>From</span><input value="Everyday checking" aria-label="From account"></label>
      </div>
      <div class="sub num">Ammo after this: <b>${F.usd(m.checking - b.cents)}</b>${fixed ? "" : " · it comes back next month"}</div>
      <div class="acts"><button class="btn primary" data-fire id="fire">Pay <kbd>⏎</kbd></button><button class="btn ghost" data-cancel>Cancel <kbd>Esc</kbd></button>${fixed ? `<button class="btn ghost" style="margin-left:auto" data-payoff="${esc(b.name)}">Pay it off instead</button>` : `<button class="btn ghost" style="margin-left:auto" data-destroy="${esc(b.name)}">Destroy it for good instead</button>`}</div></div>`;
  }

  /* ---------- Instruments ---------- */
  const inst = (cls, name, plain, body, opts = {}) =>
    `<section class="inst ${cls}${opts.flag ? opts.flag.cls : ""}" aria-label="${name}: ${plain}"><div class="inst-h"><span class="inst-name">${name}</span><span class="inst-plain">${plain}</span>${opts.flag ? opts.flag.chip : ""}${opts.link && !(opts.flag && opts.flag.chip) ? `<button class="inst-link" data-go="${opts.link[0]}">${opts.link[1]} →</button>` : ""}</div>${body}</section>`;

  function iRunway(m, cls) {
    const r = m.runway, f = flag(m, "runway"), short = r.low < 0;
    return inst(cls, "Cash ahead", "checking after known bills", `
      <div class="split" style="align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1 1 240px"><div class="lead" style="font-weight:700;${short ? "color:var(--warn)" : ""}">${short ? `Short before payday` : `Covered through payday`}</div>
        <div class="sub">${short ? `Checking runs out on ${F.date(r.shortDay)}, ${r.firstPay - r.shortDay} days before the ${F.date(r.firstPay)} paycheck.` : `Known bills are covered for <b class="num">${r.covered} days</b>, even if no paycheck arrives.`}</div></div>
        <div class="kv" style="flex:2 1 330px">
          <div><span>In checking</span><b>${F.usd(m.checking)}</b></div>
          <div><span>Due before payday</span><b>${F.usd(r.dueBefore)}</b></div>
          <div><span>${short ? "Shortfall" : "Free after bills"}</span><b style="${short ? "color:var(--warn)" : ""}">${F.usd(Math.abs(r.low))}</b></div>
        </div>
      </div>
      <div class="chart" data-chart="runway" style="height:150px"></div>
      <div class="key"><span><i style="background:var(--usd)"></i>Balance after known bills</span><span><i style="background:var(--plan)"></i>Planned paycheck, not recorded yet</span><span class="dim">Circle size = bill amount</span></div>`,
      { flag: f, link: ["bills", "Bills"] });
  }

  function iStack(m, cls) {
    const s = m.stack, gain = s.held - s.monthStart, n = s.rates.length, now = s.rates[n - 1][1], last = s.rates[n - 2][1];
    const best = Math.max(...s.rates.slice(0, -1).map((r) => r[1])), avg = sum(s.rates.map((r) => r[1])) / n;
    return inst(cls, "Stack", "bitcoin held", `
      <div class="split">
        <div class="chart" data-chart="tape" style="width:74px;height:132px;flex:none"></div>
        <div style="flex:1;display:grid;gap:6px;align-content:start">
          <div class="num hero btc">${F.btc(s.held)}</div>
          <div class="sub"><b class="num btc">▲ ${F.btc(gain)}</b> this month</div>
          <div class="sub num">${s.buys.length} buys for ${F.usd(s.stackUsd)}</div>
          <div class="chart" data-chart="spark" style="height:42px"></div>
        </div>
      </div>
      <div class="rate">
        <div><span class="lbl">Stack rate</span><b class="num btc">${now.toFixed(1)}%</b><span class="sub">of income stacked</span></div>
        <div style="flex:1;min-width:0;display:grid;gap:3px"><div class="chart" data-chart="rate" style="height:50px"></div>
          <div class="sub">${now >= last ? "▲" : "▼"} ${Math.abs(now - last).toFixed(1)} pts vs Oct${now > best ? ` · <span class="btc" style="font-weight:700">best yet</span>` : ` · avg ${avg.toFixed(1)}%`}</div></div>
      </div>
      <div style="display:grid;gap:4px"><div class="split sub" style="justify-content:space-between"><span>Next milestone <b class="num btc">${F.btc(22000000)}</b></span><span class="num">${F.btc(22000000 - s.held)} to go</span></div>
        <div class="meter" role="img" aria-label="Progress to the next million"><i style="width:${((s.held - 21000000) / 10000).toFixed(1)}%;background:var(--btc)"></i></div>
        <div class="sub"><span class="badge">6-month streak</span> Best month <b class="num btc">${F.btc(700000)}</b> in Sep</div></div>
      <div class="sub" style="border-top:1px solid var(--hairline);padding-top:8px;margin-top:auto;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="num">${F.btc(D.price.perDollar)} per $1</span><span class="dim">${D.price.source} · ${D.price.when}</span></div>`,
      { link: ["stack", "Stack"] });
  }

  function iTwo(m, cls) {
    const t = m.two, n = t.months.length, du = (t.usd[n - 1] / t.usd[0] - 1) * 100, db = (t.bitcoin[n - 1] / t.bitcoin[0] - 1) * 100;
    return inst(cls, "Two systems", "the same life, priced two ways", `
      <div class="lead">Since ${t.months[0]}, a month of your life costs <b class="num">${F.pct(du)}</b> in dollars and <b class="num btc">${F.pct(db)}</b> in bitcoin.</div>
      <div class="chart" data-chart="dual" style="flex:1;min-height:132px"></div>
      <div class="kv"><div><span>${t.months[n - 1]} in dollars</span><b>${F.usd(t.usd[n - 1])}</b></div><div><span>${t.months[n - 1]} in bitcoin</span><b class="btc">${F.btc(t.bitcoin[n - 1])}</b></div></div>
      <div class="hint">Full months only. Each expense is priced in bitcoin on the day it was paid. It can go the other way; this shows what happened.</div>`,
      { link: ["learn", "Why"] });
  }

  function iPace(m, cls, h = 118) {
    const f = flag(m, "pace"), has = !!m.pace.prev, d = has ? m.spent - m.prior : 0, pct = has ? (d / m.prior) * 100 : 0;
    return inst(cls, "Spend pace", has ? "vs last month" : "this month so far", `
      <div class="split" style="align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px">
        <span class="num read">${m.fmt(m.spent)}</span>
        ${has ? `<span class="sub num"><b style="color:var(--ink)">${m.fmt(Math.abs(d))} ${d >= 0 ? "more" : "less"}</b> than Oct 1–19 · ${F.pct(pct)}</span>` : `<span class="sub">Tracking since Nov 17</span>`}
      </div>
      <div class="chart" data-chart="pace" style="flex:1;min-height:${h}px"></div>
      ${has ? (m.missing.size && m.lens !== "USD" ? `<div class="hint">Partial: ${m.missing.size} expenses have no saved bitcoin price and use the day's reference here.</div>` : "") : `<div class="hint">Comparison with last month starts December 1. Nothing is estimated before then.</div>`}`,
      { flag: f, link: ["spending", "Spending"] });
  }

  function iBills(m, cls) {
    const f = flag(m, "bills"), r = m.runway, short = r.low < 0;
    const late = m.bills.filter((b) => b.day < 0), up = m.bills.filter((b) => b.day >= 0);
    const need = r.dueBefore, pct = Math.min(100, (need / Math.max(m.checking, 1)) * 100);
    const next = late.concat(up).slice(0, 3), off = m.boom ? " disabled" : "";
    return inst(cls, "Bills", "pay them, or destroy them for good", `
      <div class="split" style="align-items:flex-end;flex-wrap:wrap;gap:6px 16px">
        <div class="kv"><div><span>Ammo · in checking</span><b style="font-size:var(--t-read)">${F.usd(m.checking)}</b></div></div>
        <div style="flex:1 1 210px;display:grid;gap:5px;padding-bottom:3px">
          <div class="bar ammo${short ? " short" : ""}" role="img" aria-label="${F.usd(need)} of ${F.usd(m.checking)} is needed for bills before payday"><i style="width:${pct.toFixed(1)}%"></i></div>
          <div class="sub">${need ? `Bills before the ${F.date(r.firstPay)} reload need <b class="num">${F.usd(need)}</b>. ${short ? `<b style="color:var(--warn)">${F.usd(-r.low)} short.</b>` : `<b class="ok">Enough ammo.</b>`}` : `Nothing left to pay before the ${F.date(r.firstPay)} reload.`}</div>
        </div>
      </div>
      <div class="chart" data-chart="lane" style="height:104px"></div>
      ${next.length ? `<ul class="rows">${next.map((b) => `<li style="grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center"><span class="nm">${esc(b.name)} <small class="num ${b.day < 0 ? "overdue" : "dim"}">· ${b.day < 0 ? `${-b.day} days overdue` : b.day === 0 ? "due today" : `${F.date(b.day)}, in ${b.day} days`}</small></span><span class="num">${F.usd(b.cents)}</span><button class="btn sm" data-pay="${esc(b.name)}" aria-label="Pay ${esc(b.name)}, ${F.usd(b.cents)}"${off}>Pay</button>${b.debt || b.card ? `<button class="btn sm ghost" data-payoff="${esc(b.name)}" aria-label="Pay off ${esc(b.name)} in full and destroy it"${off}>Pay off</button>` : `<button class="btn sm ghost" data-destroy="${esc(b.name)}" aria-label="Destroy ${esc(b.name)} for good"${off}>Destroy</button>`}</li>`).join("")}</ul>` : `<div class="sub ok">${I.ok} All clear. Every bill in the next 30 days is paid.</div>`}
      <div class="sub" style="display:flex;justify-content:space-between;gap:6px 12px;flex-wrap:wrap;border-top:1px solid var(--hairline);padding-top:8px">
        <span><span class="badge">${m.paidStats.n} paid</span> this month <span class="badge" style="margin-left:6px">${m.goneStats.n} destroyed</span> <span class="num">${F.usd(m.goneStats.cents)}</span> a month freed</span>
        ${!short && r.low > 0 ? `<span>Spare ammo <b class="num">${F.usd(r.low)}</b> <button class="btn sm copper" data-go="stack">Stack it →</button></span>` : ""}</div>`,
      { flag: f, link: ["bills", `All ${m.bills.length}`] });
  }

  function iDebt(m, cls) {
    const f = flag(m, "debt"), c = m.card, mg = m.mortgage;
    return inst(cls, "Cards & debt", "what you owe", `
      <div style="display:grid;gap:6px">
        <div class="split" style="justify-content:space-between;align-items:baseline"><span>${c.name}</span><span class="num lead">${F.usd(c.balance)}</span></div>
        <div class="bar" role="img" aria-label="${c.util.toFixed(0)}% of limit used; caution threshold 30%"><i style="width:${Math.min(c.util, 100)}%"></i><u style="left:30%" data-tip="Your caution threshold: 30% of limit"></u></div>
        <div class="sub num" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${c.util.toFixed(0)}% of ${F.usd0(c.limit)} limit</span><span>Payment ${F.usd(c.statement)} due ${F.date(c.dueDay)}</span></div>
      </div>
      <div style="display:grid;gap:4px;border-top:1px solid var(--hairline);padding-top:8px">
        <div class="split" style="justify-content:space-between;align-items:baseline"><span>${mg.name}</span><span class="num lead">${F.usd(mg.balance)}</span></div>
        <div class="sub num" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>▼ ${F.usd(mg.history[0] - mg.balance)} since Jun</span><span class="plan">At this pace: paid off 2052</span></div>
      </div>`, { flag: f, link: ["accounts", "Accounts"] });
  }

  function iBridge(m, cls) {
    return inst(cls, "Spending bridge", "what changed since October", `
      <div class="chart" data-chart="bridge"></div>
      <div class="key"><span><i style="background:${m.lens === "USD" ? "var(--usd)" : "var(--btc)"}"></i>Spent more</span><span><i style="border:1.4px dashed ${m.lens === "USD" ? "var(--usd)" : "var(--btc)"}"></i>Spent less</span><span class="dim">Same days of each month</span></div>`,
      { link: ["spending", "Explore"] });
  }
  function iWatershed(m, cls, h = 270) {
    return inst(cls, "Money flow", "November's income and where it went · month so far", `<div class="chart" data-chart="watershed" style="height:${h}px"></div>`, { link: ["spending", "Explore"] });
  }
  function iAllow(m, cls) {
    const rows = D.allowances.map(([c, cap]) => {
      const used = sum(m.expenses.filter((e) => e.cat === c).map((e) => e.cents)), pct = (used / cap) * 100;
      return `<div style="display:grid;gap:4px"><div class="split" style="justify-content:space-between"><span>${c}</span><span class="num sub">${F.usd(used)} of ${F.usd0(cap)}</span></div>
        <div class="bar" role="img" aria-label="${pct.toFixed(0)}% of allowance used"><i style="width:${Math.min(pct, 100)}%"></i><u style="left:63%" data-tip="Today: 63% of the month has passed"></u></div></div>`;
    }).join("");
    return inst(cls, "Budgets", "dollar allowances", `<div style="display:grid;gap:9px">${rows}</div><div class="hint">The mark is today. A bar past the mark is spending faster than the month.</div>`, { link: ["spending", "Budgets"] });
  }
  function iHorizon(m, cls) {
    const h = D.horizon;
    return inst(cls, "Retirement", "hypothetical plan", `
      <div class="lead"><b>${h.name}:</b> <span class="plan">funded to age ${h.fundedTo}</span>, retiring at ${h.retireAge}.</div>
      <div class="chart" data-chart="course" style="height:70px"></div>
      <div class="kv"><div><span>Life / month</span><b>${F.usd(h.monthlyUsd)}</b></div><div><span>Same, in bitcoin</span><b class="btc">${F.btc(h.monthlyBitcoin)}</b></div></div>
      <div class="hint">A projection from your saved assumptions. It never touches the ledger.</div>`, { link: ["horizon", "Scenarios"] });
  }
  function logRows(m, list, sel, slim) {
    return list.map((e, i) => {
      const sign = e.kind === "income" ? "+" : e.kind === "expense" ? "−" : "";
      const b = e.kind === "stack" ? `<span class="btc">+${F.btc(e.bitcoin)}</span>` : m.day3 ? `<span class="tag miss">no price source</span>` : e.kind === "expense" ? (m.bitcoinAt(e) === null ? `<span class="tag miss">no price saved</span>` : F.btc(m.bitcoinAt(e))) : `<span class="dim">${F.btc(Math.round((e.cents / 100) * m.rate(e.day)))}</span>`;
      return `<tr class="${sel === i ? "sel" : ""}"><td class="num dim">Nov ${e.day}</td><td class="w">${esc(e.name)}</td><td class="hide-s"><span class="tag">${e.cat}</span></td>${slim ? "" : `<td class="dim hide-s">${e.acct}</td>`}<td class="num r">${sign}${F.usd(e.cents)}</td><td class="num r">${b}</td></tr>`;
    }).join("");
  }
  function iLog(m, cls, n = 6) {
    const f = flag(m, "log");
    return inst(cls, "Transactions", "latest entries", `<div style="overflow:hidden"><table class="log"><thead><tr><th>Date</th><th>Entry</th><th class="hide-s">Category</th><th class="r">Dollars</th><th class="r">Bitcoin that day</th></tr></thead><tbody>${logRows(m, m.log.slice(0, n), -1, true)}</tbody></table></div>`,
      { flag: f, link: ["log", "All activity"] });
  }

  /* ---------- Day-one instruments ---------- */
  function iPreflight(cls) {
    const steps = [
      [true, "Add your checking account", "On: Checking, Spend pace, Transactions"],
      [false, "Set your next paycheck", "Turns on: Cash ahead", "Set payday"],
      [false, "Add recurring bills", "Turns on: Cash ahead, Bills", "Add bills"],
      [false, "Record your bitcoin", "Turns on: Stack", "Add bitcoin"],
      [false, "Choose a price source", "Turns on: bitcoin cost on every expense", "Choose"],
      [false, "Make an encrypted backup", "Turns on: backup reminders", "Back up"],
    ];
    return inst(cls, "Get set up", "1 of 6 done", `<div class="meter"><i style="width:16.7%;background:var(--ok)"></i></div>
      <ol class="check">${steps.map(([done, t, sub, act]) => `<li class="${done ? "done" : ""}"><span class="box">${done ? I.ok : ""}</span><span class="t">${t}<small>${sub}</small></span>${act ? `<button class="btn sm">${act}</button>` : ""}</li>`).join("")}</ol>`);
  }
  const iInop = (cls, name, plain, needs, act) =>
    `<section class="inst inop ${cls}" aria-label="${name}: not set up"><div class="inst-h"><span class="inst-name" style="color:var(--ink-3)">${name}</span><span class="inst-plain">${plain}</span></div><div class="sub" style="flex:1">${needs}</div><div><button class="btn sm">${act}</button></div></section>`;
  const iWait = (cls, name, plain, have, need, unit, note) =>
    `<section class="inst inop ${cls}" aria-label="${name}: collecting data"><div class="inst-h"><span class="inst-name" style="color:var(--ink-3)">${name}</span><span class="inst-plain">${plain}</span></div>
      <div class="wait"><div class="sub">Collecting data — <b class="num">${have} of ${need}</b> ${unit}</div><div class="meter"><i style="width:${(have / need) * 100}%"></i></div><div class="hint">${note}</div></div></section>`;

  function cockpit(m) {
    if (m.day3) {
      return `<div class="panel">
        ${inst("c4", "Checking", "Everyday checking", `<div class="num hero">${F.usd(m.checking)}</div><div class="sub num">Opened with $2,140.00 on Nov 17 · ${F.usd(m.spent)} spent since</div>
          <ul class="rows">${m.cats.map(([c, v]) => `<li style="grid-template-columns:1fr auto"><span>${c}</span><span class="num">${F.usd(v)}</span></li>`).join("")}</ul>`, { link: ["accounts", "Accounts"] })}
        ${iPace(m, "c4", 124)}
        ${iPreflight("c4")}
        ${iLog(m, "c8", 3)}
        ${iInop("c4", "Cash ahead", "checking after known bills", `No bills or payday on file yet, so nothing is known to be due. Add them and this shows whether <b class="num">${F.usd(m.checking)}</b> covers everything before your next paycheck.`, "Add bills and payday")}
        <div class="band">Turns on as you add data</div>
        ${iInop("c3", "Stack", "bitcoin held", "Record what you hold. Bitcoin is your saving; this is where it shows.", "Add bitcoin")}
        ${iInop("c3", "Bills", "what is due", "Add a bill and it shows up here as a target, with your checking balance as ammo.", "Add a bill")}
        ${iWait("c3", "Spending bridge", "what changed since last month", 3, 30, "days", "Needs one full month to compare against. Ready December 1.")}
        ${iWait("c3", "Two systems", "the same life, priced two ways", 3, 60, "days", "Needs two full months and a price source. Ready about February 1.")}
      </div>`;
    }
    return `<div class="panel">
      ${iTwo(m, "c4")}${iRunway(m, "c5")}${iStack(m, "c3")}
      ${iPace(m, "c3")}${iBills(m, "c5")}<div class="c4 col">${iDebt(m, "")}${iAllow(m, "")}</div>
      <div class="band">Month in detail</div>
      ${iWatershed(m, "c7")}${iBridge(m, "c5")}
      ${iLog(m, "c8")}${iHorizon(m, "c4")}
    </div>`;
  }

  /* ---------- Other screens ---------- */
  function spending(m) {
    if (m.day3) return `<div class="page"><h1>Spending</h1><p class="intro">Three days in. The pace line works already; comparisons arrive as months complete.</p><div class="grid2">${iPace(m, "c6", 180)}${iWait("c6", "Spending bridge", "what changed since last month", 3, 30, "days", "Ready December 1.")}</div></div>`;
    const drill = S.drill ? m.expenses.filter((e) => e.cat === S.drill) : null;
    return `<div class="page"><h1>Spending</h1><p class="intro">November 1–19 against the same days of October. Switch <b>$</b> / <b class="btc">₿</b> in the top bar to price everything in bitcoin at each purchase date. Select a category to see the entries behind it.</p>
      <div class="grid2">${iPace(m, "c5", 190)}${iBridge(m, "c7")}${iWatershed(m, "c12", 300)}
      ${drill ? inst("c12", S.drill, `${drill.length} entries behind ${m.fmt(m.catNow[S.drill])}`, `<table class="log"><thead><tr><th>Date</th><th>Entry</th><th class="hide-s">Category</th><th class="hide-s">Account</th><th class="r">Dollars</th><th class="r">Bitcoin that day</th></tr></thead><tbody>${logRows(m, drill, -1)}</tbody></table><div><button class="btn sm ghost" data-drill-clear>Clear selection</button></div>`) : `<p class="hint" style="grid-column:1/-1">Select a bridge row or a spending stream to list its entries here.</p>`}
      </div></div>`;
  }
  function log(m) {
    return `<div class="page"><h1>Transactions</h1><p class="intro">Every entry, newest first. Corrections never edit history: they append a reversal and a replacement.</p>
      ${inst("", "New entry", "type, Tab, Enter; stays open for the next one", `<div class="entry">
        <label class="field"><span>Date</span><input value="Nov 19" aria-label="Date"></label>
        <label class="field"><span>Payee or note</span><input id="payee" value="Mountain Market" aria-label="Payee or note"></label>
        <label class="field"><span>Category</span><input value="Groceries" aria-label="Category"></label>
        <label class="field"><span>Account</span><input value="${m.day3 ? "Everyday checking" : "Ridgeline Visa"}" aria-label="Account"></label>
        <label class="field"><span>Amount</span><input class="num" value="−42.18" aria-label="Amount"></label>
        <button class="btn primary">Save <kbd>⏎</kbd></button></div>
        <div class="hint num">${m.day3 ? "No price source yet, so no bitcoin cost is recorded. It is never guessed later." : `= ${F.btc(35516)} at today's reference (${D.price.source}). Saved with the entry, never repriced.`}  ·  <kbd>N</kbd> new  <kbd>J</kbd>/<kbd>K</kbd> move  <kbd>E</kbd> correct  <kbd>/</kbd> search</div>`)}
      ${inst("", "Entries", `${m.log.length} this month`, `<div style="overflow:hidden"><table class="log"><thead><tr><th>Date</th><th>Entry</th><th class="hide-s">Category</th><th class="hide-s">Account</th><th class="r">Dollars</th><th class="r">Bitcoin that day</th></tr></thead><tbody>${logRows(m, m.log, S.sel)}</tbody></table></div>`)}
    </div>`;
  }
  const STUB = {
    bills: ["Bills", "Every bill as a target at full size, a 30-day view, recurring bills and your paycheck schedule. Pay records a payment after you confirm. Destroy cancels a bill for good and shows what that frees each year."],
    stack: ["Stack", "Your bitcoin: holdings by wallet, every buy with the price actually paid, milestones and streaks, and the Two systems view at full size. Price source and provenance live here."],
    accounts: ["Accounts", "Checking, cards, reserve, brokerage, property and loans in one place. Bitcoin and dollars are listed in their own units; no combined net worth figure."],
    horizon: ["Retirement", "The existing retirement planner, restyled: saved scenarios side by side in both systems. Everything here is hypothetical and drawn in amethyst."],
    learn: ["Learn", "A short, well-made course on thinking in two monetary systems, using your own ledger as the worked example."],
  };
  function stub(k) {
    return `<div class="page"><h1>${STUB[k][0]}</h1><p class="intro">${STUB[k][1]}</p>${iInop("", "Not in this prototype", "described in docs/cockpit-design.md", "This screen is specified in the design brief and will be built in its increment.", "Back to dashboard").replace("<button", '<button data-go="cockpit"')}</div>`;
  }
  function system() {
    const sw = (v, name, use) => `<div class="sw"><i style="background:var(${v})"></i><div>${name}<small>${use}</small></div></div>`;
    const lamp = (lvl, label, acked) => `<span class="lamp on l-${lvl}${acked ? " acked" : ""}">${I[lvl]}<span>${label}</span></span>`;
    return `<div class="page"><h1>Design system</h1><p class="intro">The logo, the colour meanings, the type and the alert-light states this prototype is built from.</p>
      ${inst("", "Logo", "three gentle rolling hills, layered: two blues and one orange for bitcoin", `<div class="lockups">
        ${["night", "day"].map((t) => `<div class="plate ${t}"><div class="lockup">${mark(92)}<span class="wordmark">Appalachian <b>Bitcoin</b></span></div><small>Horizontal · ${t}</small></div>`).join("")}
        ${["night", "day"].map((t) => `<div class="plate ${t}">${stacked(190)}<small>Stacked · ${t}</small></div>`).join("")}
        <div class="plate night">${stacked(190, true)}<small>Alternate wordmark · serif</small></div>
        <div class="plate day"><div class="split" style="align-items:flex-end;gap:16px">${tile(64)}${tile(32)}${tile(16)}</div><small>App icon · 64, 32, 16 px</small></div>
        <div class="plate night"><div class="split" style="align-items:flex-end;gap:16px">${tile(64)}${tile(32)}${tile(16)}</div><small>App icon on dark</small></div>
        <div class="plate night"><div class="split" style="align-items:center;gap:16px">${mark(128)}${mark(76)}${mark(44)}</div><small>Mark only</small></div>
      </div>`)}
      ${inst("", "Colour", "every colour means one thing", `<div class="swatches">
        ${sw("--btc", "Copper", "Bitcoin. Saving.")}${sw("--usd", "Mist", "Dollars, neutral readings")}${sw("--plan", "Amethyst", "Planned or hypothetical")}${sw("--ok", "Green", "In range")}
        ${sw("--adv-fill", "Blue", "Heads-up alert only")}${sw("--caution-fill", "Amber", "Caution alert only")}${sw("--warn-fill", "Red", "Warning alert only")}
        ${sw("--bg", "Night", "Canvas")}${sw("--panel", "Panel", "Panel face")}${sw("--bezel", "Edge", "Panel edge")}${sw("--ink", "Ink", "Primary text")}${sw("--ink-3", "Ink 3", "Labels")}</div>`)}
      ${inst("", "Type", "B612, made for dense displays; its digits share one width, so numbers align", `<div style="display:grid;gap:6px">
        <div class="num hero">₿21,932,000 <span class="dim" style="font-size:15px">Hero 34</span></div><div class="num read">$4,812.40 <span class="dim" style="font-size:13px">Readout 24</span></div>
        <div class="lead">Covered through payday <span class="dim">Lead 15</span></div><div>Known bills are covered for 33 days. <span class="dim">Body 13</span></div>
        <div class="inst-name">Panel name <span class="dim" style="letter-spacing:0;text-transform:none;font-weight:400">Label 11, tracked caps</span></div></div>`)}
      ${inst("", "Alert lights", "level is carried by shape, word and colour together", `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
        ${lamp("advisory", "Advisory")}${lamp("caution", "Caution")}${lamp("warning", "Warning")}${lamp("advisory", "Acknowledged", 1)}${lamp("caution", "Acknowledged", 1)}${lamp("warning", "Acknowledged", 1)}<span class="lamp">Normal (dark)</span></div>
        <div class="hint">Circle = advisory, triangle = caution, octagon = warning. Acknowledged lights stay on but hollow until the problem is fixed.</div>`)}
      ${inst("", "States", "every panel has all of these", `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
        ${iWait("", "Collecting", "partial history", 19, 60, "days", "Shown instead of an empty chart.")}
        ${iInop("", "Not set up", "missing input", "Says what it needs and offers the one action that lights it.", "Set up")}
        <section class="inst"><div class="inst-h"><span class="inst-name">Missing price</span></div><div class="num read">$31.00</div><div><span class="tag miss">no price saved</span></div><div class="hint">Never guessed. Totals that include it say “partial”.</div></section>
        <section class="inst"><div class="inst-h"><span class="inst-name">Loading</span></div><div class="meter" style="height:24px;width:60%"><i style="width:100%;opacity:.25"></i></div><div class="meter" style="width:85%"><i style="width:100%;opacity:.25"></i></div><div class="hint">Skeleton at final size; no layout shift.</div></section>
        <section class="inst"><div class="inst-h"><span class="inst-name">Offline</span></div><div class="sub">Can't reach your ledger. Showing the last readings from 2:14 PM; entry is paused.</div><div><button class="btn sm">Retry</button></div></section>
        <section class="inst"><div class="inst-h"><span class="inst-name">Locked</span></div><div class="sub">Session ended. Panels are blanked, not cached.</div><div><button class="btn sm primary">Unlock</button></div></section></div>`)}
    </div>`;
  }

  /* ---------- Render ---------- */
  let M;
  function render() {
    document.documentElement.dataset.theme = S.theme;
    M = model();
    const seg = (key, opts) => `<span class="seg" role="group">${opts.map(([v, l]) => `<button data-set="${key}:${v}" aria-pressed="${S[key] === v}">${l}</button>`).join("")}</span>`;
    const body = S.screen === "cockpit" ? annunciator(M) + cockpit(M) : S.screen === "spending" ? spending(M) : S.screen === "log" ? log(M) : S.screen === "system" ? system() : stub(S.screen);
    document.getElementById("app").innerHTML = `
      <div class="proto"><b>PROTOTYPE</b><span>Fictional data</span>${seg("data", [["day3", "Day 3"], ["six", "Month 6"]])}${S.data === "six" ? seg("cond", [["calm", "All calm"], ["trouble", "Trouble"]]) : ""}${seg("theme", [["night", "Night"], ["day", "Day"]])}</div>
      <div class="shell">
        <nav class="rail" aria-label="Main"><div class="rail-mark">${tile(34)}</div>
          ${NAV.slice(0, 8).map(([k, l, i]) => `<button class="nav" data-go="${k}" ${S.screen === k ? 'aria-current="page"' : ""}>${i}<span>${l}</span></button>`).join("")}
          <div class="grow"></div>${NAV.slice(8).map(([k, l, i]) => `<button class="nav" data-go="${k}" ${S.screen === k ? 'aria-current="page"' : ""}>${i}<span>${l}</span></button>`).join("")}</nav>
        <div class="main">
          <header class="glare"><div class="rail-mark" style="padding:0">${tile(32)}</div><div class="lockup">${mark(92)}<span class="wordmark">Appalachian <b>Bitcoin</b></span></div><span class="crumb">${CRUMB[S.screen]}</span><span class="grow"></span>
            ${M.day3 ? `<button class="price"><span class="q dim">No price source</span><span class="prov">Choose one in setup</span></button>` : `<button class="price" data-tip="${D.price.legacy}\n${D.price.source} · ${D.price.when}"><span class="num q btc">${F.btc(D.price.perDollar)}</span><span class="per">per $1</span><span class="prov">${D.price.source} · ${D.price.when}</span></button>`}
            <div class="lens" role="group" aria-label="Price analysis in"><button data-set="lens:USD" aria-pressed="${S.lens === "USD"}" aria-label="Dollars">$</button><button class="b" data-set="lens:BITCOIN" aria-pressed="${S.lens === "BITCOIN"}" aria-label="Bitcoin">₿</button></div>
            ${master(M)}<button class="add" data-go="log" data-focus="payee"><span>Add entry</span><kbd>N</kbd><b aria-hidden="true">+</b></button></header>
          <main>${body}</main>
        </div>
      </div>
      <nav class="tabbar" aria-label="Main">${[NAV[0], NAV[1]].map(([k, l, i]) => `<button data-go="${k}" ${S.screen === k ? 'aria-current="page"' : ""}>${i}${l}</button>`).join("")}<button data-go="log" aria-label="Add entry"><span class="plus">${ic(`<path d="M12 5v14M5 12h14"/>`)}</span></button>${[NAV[3], NAV[4]].map(([k, l, i]) => `<button data-go="${k}" ${S.screen === k ? 'aria-current="page"' : ""}>${i}${l}</button>`).join("")}</nav>
      ${drawer(M)}${confirmSheet(M)}<div class="sr" aria-live="polite">${M.alerts.filter((a) => !isAcked(a) && a.level !== "advisory").map((a) => a.level + ": " + a.title).join(". ")}</div>`;
    draw();
  }
  function draw() {
    document.querySelectorAll("[data-chart]").forEach((el) => CH[el.dataset.chart](el, M));
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-pay],[data-payoff],[data-destroy],[data-fire],[data-cancel],[data-set],[data-go],[data-open],[data-close],[data-ack],[data-ackall],[data-master],[data-drill],[data-drill-clear]");
    if (!el) return;
    const d = el.dataset;
    if (d.pay || d.destroy || d.payoff) {
      if (S.boom) return;
      S.confirm = { name: d.pay || d.destroy || d.payoff, mode: d.pay ? "pay" : d.destroy ? "destroy" : "payoff" };
      S.drawer = null;
      render();
      return document.getElementById("fire")?.focus();
    }
    if ("cancel" in d) { S.confirm = null; return render(); }
    if ("fire" in d) {
      S.boom = S.confirm;
      S.confirm = null;
      render();
      return setTimeout(() => { ({ pay: S.paid, destroy: S.gone, payoff: S.paidOff })[S.boom.mode].push(S.boom.name); S.boom = null; render(); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520);
    }
    if (d.set) { const [k, v] = d.set.split(":"); S[k] = v; if (k !== "theme" && k !== "lens") { S.acks = {}; S.drawer = null; S.drill = null; S.paid = []; S.gone = []; S.paidOff = []; S.confirm = null; } }
    else if (d.go) { S.screen = d.go; S.drawer = null; window.scrollTo(0, 0); }
    else if (d.open) S.drawer = d.open;
    else if ("close" in d) S.drawer = null;
    else if (d.ack) { const a = M.alerts.find((x) => x.id === d.ack); S.acks[a.id] = { level: a.level, sev: a.sev }; }
    else if ("ackall" in d || "master" in d) { M.alerts.forEach((a) => (S.acks[a.id] = { level: a.level, sev: a.sev })); S.drawer = S.drawer ?? ""; }
    else if (d.drill) { S.drill = d.drill; S.screen = "spending"; }
    else if ("drillClear" in d) S.drill = null;
    render();
    if (d.focus) document.getElementById(d.focus)?.select();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.confirm) { S.confirm = null; return render(); }
    if (e.key === "Escape" && S.drawer !== null) { S.drawer = null; return render(); }
    if (e.target.matches("input")) return;
    if (e.key === "n" || e.key === "N") { e.preventDefault(); S.screen = "log"; render(); document.getElementById("payee")?.select(); }
    if (S.screen === "log" && (e.key === "j" || e.key === "k")) { S.sel = Math.max(0, Math.min(M.log.length - 1, S.sel + (e.key === "j" ? 1 : -1))); render(); }
  });
  const tipEl = document.createElement("div");
  tipEl.className = "tip";
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  const showTip = (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) return (tipEl.hidden = true);
    tipEl.textContent = t.dataset.tip;
    tipEl.hidden = false;
    const r = t.getBoundingClientRect(), w = tipEl.offsetWidth;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    tipEl.style.top = (r.top > 70 ? r.top - tipEl.offsetHeight - 8 : r.bottom + 8) + "px";
  };
  document.addEventListener("mouseover", showTip);
  document.addEventListener("focusin", showTip);
  document.addEventListener("focusout", () => (tipEl.hidden = true));
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(draw, 80); });
  const q = new URLSearchParams(location.search);
  for (const k of ["screen", "data", "cond", "theme", "lens", "drawer"]) if (q.get(k) !== null) S[k] = q.get(k);
  if (q.get("pay")) S.confirm = { name: q.get("pay"), mode: "pay" };
  if (q.get("destroy")) S.confirm = { name: q.get("destroy"), mode: "destroy" };
  if (q.get("payoff")) S.confirm = { name: q.get("payoff"), mode: "payoff" };
  document.fonts?.ready.then(render);
  render();
})();
