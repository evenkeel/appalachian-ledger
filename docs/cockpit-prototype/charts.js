/* Hand-built SVG instruments. Floats are used for coordinates only; every label
   and tooltip is formatted from the exact integer amount. */
(function () {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const F = {
    usd(c) {
      const n = Math.abs(c);
      return (c < 0 ? "−" : "") + "$" + Math.floor(n / 100).toLocaleString("en-US") + "." + String(n % 100).padStart(2, "0");
    },
    usd0(c) {
      return (c < 0 ? "−" : "") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");
    },
    btc(n) {
      return (n < 0 ? "−" : "") + "₿" + Math.abs(n).toLocaleString("en-US");
    },
    btcShort(n) {
      const a = Math.abs(n);
      return "₿" + (a >= 1e6 ? (a / 1e6).toFixed(a % 1e6 ? 1 : 0) + "M" : a >= 1e3 ? Math.round(a / 1e3) + "k" : a);
    },
    date(offset) {
      const d = new Date(PROTO.TODAY);
      d.setDate(d.getDate() + offset);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    },
    pct(x, digits = 1) {
      return (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(digits) + "%";
    },
  };
  const svg = (w, h, body, label) =>
    `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">${body}</svg>`;
  const tip = (t) => `data-tip="${esc(t)}" tabindex="0"`;

  const CH = {};

  /* Runway: projected checking balance against known bills and planned paydays. */
  CH.runway = (el, m) => {
    const W = el.clientWidth, H = el.clientHeight, p = { l: 6, r: 6, t: 20, b: 20 };
    const r = m.runway, days = 30;
    if (r.low < 0) p.b = 26;
    const x = (d) => p.l + (Math.max(0, d) / days) * (W - p.l - p.r);
    const hi = Math.max(...r.steps.map((s) => s.after), r.start) * 1.08;
    const lo = Math.min(0, r.low) * 2.4;
    const y = (v) => p.t + (1 - (v - lo) / (hi - lo)) * (H - p.t - p.b);
    let before = `M${x(0)},${y(r.start)}`, after = "", bal = r.start, seenPay = false, marks = "", payLines = "";
    for (const s of r.steps) {
      const sx = x(s.day);
      if (s.pay) {
        if (!seenPay) before += `H${sx}`;
        else after += `H${sx}`;
        payLines += `<line x1="${sx}" x2="${sx}" y1="${p.t - 8}" y2="${H - p.b}" stroke="var(--plan)" stroke-width="1" stroke-dasharray="3 3"/>
          <line x1="${sx}" x2="${sx}" y1="${y(bal)}" y2="${y(s.after)}" stroke="var(--plan)" stroke-width="2"/>
          <text x="${Math.min(sx + 4, W - 70)}" y="${p.t - 9}" style="fill:var(--plan)">Payday ${F.date(s.day)}</text>
          <circle cx="${sx}" cy="${y(s.after)}" r="7" fill="transparent" ${tip(`Planned: ${s.name} ${F.usd(s.cents)}\n${F.date(s.day)} · not recorded yet`)}/>`;
        after += `${seenPay ? "" : `M${sx},${y(s.after)}`}${seenPay ? `V${y(s.after)}` : ""}`;
        seenPay = true;
      } else {
        const seg = `H${sx}V${y(s.after)}`;
        if (!seenPay) before += seg;
        else after += seg;
        const rad = 2.5 + 4.5 * Math.sqrt(s.cents / r.maxBill);
        if (s.cents >= r.maxBill * 0.95 && s.day < r.firstPay) {
          const left = x(r.firstPay) - sx < 110 && sx > 110;
          marks += `<text x="${left ? sx - 6 : sx + rad + 4}" y="${left ? y(s.after + s.cents) - 6 : y(s.after) - 6}" text-anchor="${left ? "end" : "start"}">${esc(s.name.replace(" payment", ""))}</text>`;
        }
        marks += `<circle cx="${sx}" cy="${y(s.after)}" r="${rad.toFixed(1)}" fill="var(--panel)" stroke="${s.overdue ? "var(--warn)" : "var(--usd)"}" stroke-width="1.6" ${tip(`${s.name} ${F.usd(s.cents)}\n${s.overdue ? "Overdue since " + F.date(s.origDay) : "Due " + F.date(s.day)} · balance after ${F.usd(s.after)}`)}/>`;
      }
      bal = s.after;
    }
    if (seenPay) after += `H${x(days)}`;
    else before += `H${x(days)}`;
    const y0 = y(0);
    const all = `M${x(0)},${y(r.start)}` + r.steps.map((s) => `H${x(s.day)}V${y(s.after)}`).join("") + `H${x(days)}`;
    const short = r.low < 0
      ? `<defs><clipPath id="below"><rect x="0" y="${y0}" width="${W}" height="${H}"/></clipPath>
         <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--warn)"/></pattern></defs>
         <path d="${all}V${y0}H${x(0)}Z" fill="url(#hatch)" opacity=".55" clip-path="url(#below)"/>`
      : "";
    const ticks = [0, 7, 14, 21, 28]
      .map((d) => `<text x="${x(d)}" y="${H - 5}" text-anchor="${d ? "middle" : "start"}">${d ? F.date(d) : "Today"}</text><line x1="${x(d)}" x2="${x(d)}" y1="${H - p.b}" y2="${H - p.b + 4}" stroke="var(--bezel)"/>`)
      .join("");
    const lx = x(r.lowDay), ly = y(r.low);
    const lowLabel = r.low < 0
      ? `<text class="lbl" x="${(x(r.shortDay) + x(r.firstPay)) / 2}" y="${ly + 16}" text-anchor="middle" style="fill:var(--warn);font-weight:700">Short ${F.usd(-r.low)}</text>`
      : `<text class="lbl" x="${Math.max(lx - 10, 96)}" y="${ly + 15}" text-anchor="end" style="font-weight:700">Low ${F.usd(r.low)}</text>`;
    el.innerHTML = svg(W, H,
      `${short}<line x1="${p.l}" x2="${W - p.r}" y1="${y0}" y2="${y0}" stroke="var(--bezel)"/><text x="${W - p.r}" y="${y0 - 4}" text-anchor="end">$0</text>
       ${payLines}<path d="${before}" fill="none" stroke="var(--usd)" stroke-width="2" stroke-linejoin="round"/>
       <path d="${after}" fill="none" stroke="var(--usd)" stroke-width="2" stroke-dasharray="5 4" opacity=".75"/>
       ${marks}<circle cx="${x(0)}" cy="${y(r.start)}" r="4" fill="var(--usd)"/>${lowLabel}${ticks}`,
      `Projected checking balance for 30 days. ${r.low < 0 ? "Falls short by " + F.usd(-r.low) : "Lowest point " + F.usd(r.low)} on ${F.date(r.lowDay)}.`);
  };

  /* Stack altimeter: a vertical tape centred on bitcoin held, showing this month's climb. */
  CH.tape = (el, m) => {
    const W = el.clientWidth, H = el.clientHeight, s = m.stack;
    const span = 1500000, step = 250000;
    const y = (v) => H / 2 - ((v - s.held) / span) * (H / 2);
    let t = "";
    for (let v = Math.ceil((s.held - span) / step) * step; v <= s.held + span; v += step) {
      const major = v % 500000 === 0, yy = y(v);
      if (yy < 8 || yy > H - 4) continue;
      t += `<line x1="${W - (major ? 14 : 8)}" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--ink-3)" stroke-width="1"/>`;
      if (major && Math.abs(yy - H / 2) > 11) t += `<text x="${W - 18}" y="${yy + 3.5}" text-anchor="end">${(v / 1e6).toFixed(1)}M</text>`;
    }
    const y1 = y(s.monthStart), yc = H / 2;
    el.innerHTML = svg(W, H,
      `<rect x="0" y="0" width="${W}" height="${H}" rx="6" fill="var(--well)" stroke="var(--hairline)"/>
       <rect x="${W - 6}" y="${yc}" width="6" height="${y1 - yc}" fill="var(--btc)" ${tip(`Climb this month\n${F.btc(s.monthStart)} → ${F.btc(s.held)}`)}/>
       ${t}
       <path d="M${W - 13},${y1}l-7,-4v8z" fill="var(--btc)" opacity=".7"/><text x="${W - 23}" y="${y1 + 3.5}" text-anchor="end" style="fill:var(--btc)">Nov 1</text>
       <path d="M0,${yc - 10}H${W - 16}L${W - 7},${yc}L${W - 16},${yc + 10}H0Z" fill="var(--panel-2)" stroke="var(--btc)" stroke-width="1.2"/>
       <text x="${W - 21}" y="${yc + 4}" text-anchor="end" style="fill:var(--ink);font-size:11px;font-weight:700">${(s.held / 1e6).toFixed(2)}M</text>`,
      `Bitcoin held ${F.btc(s.held)}, up from ${F.btc(s.monthStart)} at the start of the month.`);
  };

  CH.spark = (el, m) => {
    const W = el.clientWidth, H = el.clientHeight, pts = m.stack.history, pad = 4;
    const vals = pts.map((d) => d[1]), lo = Math.min(...vals), hi = Math.max(...vals);
    const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2), y = (v) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 22);
    const d = pts.map((q, i) => `${i ? "L" : "M"}${x(i)},${y(q[1])}`).join("");
    el.innerHTML = svg(W, H,
      `<path d="${d}V${H - 12}H${x(0)}Z" fill="var(--btc-soft)"/><path d="${d}" fill="none" stroke="var(--btc)" stroke-width="1.8"/>
       ${pts.map((q, i) => `<circle cx="${x(i)}" cy="${y(q[1])}" r="6" fill="transparent" ${tip(`${q[0]} · ${F.btc(q[1])}`)}/><circle cx="${x(i)}" cy="${y(q[1])}" r="2" fill="var(--btc)"/>`).join("")}
       <text x="${x(0)}" y="${H - 1}">${pts[0][0]}</text><text x="${x(pts.length - 1)}" y="${H - 1}" text-anchor="end">${pts[pts.length - 1][0]}</text>`,
      `Bitcoin held by month, ${pts[0][0]} to ${pts[pts.length - 1][0]}.`);
  };

  /* Spend pace: cumulative spending this month against the same days last month. */
  CH.pace = (el, m) => {
    const W = el.clientWidth, H = el.clientHeight, p = { l: 4, r: 4, t: 12, b: 18 };
    const pc = m.pace, n = 31, fmt = m.fmt;
    const hi = Math.max(pc.cur[pc.cur.length - 1] || 1, pc.prev ? pc.prev[pc.prev.length - 1] : 0) * 1.08;
    const x = (d) => p.l + ((d - 1) / (n - 1)) * (W - p.l - p.r), y = (v) => p.t + (1 - v / hi) * (H - p.t - p.b);
    const line = (arr, from = 1) => arr.map((v, i) => `${i ? "L" : "M"}${x(i + from)},${y(v)}`).join("");
    const col = m.lens === "USD" ? "var(--usd)" : "var(--btc)";
    const last = pc.cur.length - 1 + pc.from, lv = pc.cur[pc.cur.length - 1];
    const hover = pc.cur.map((v, i) => `<circle cx="${x(i + pc.from)}" cy="${y(v)}" r="6" fill="transparent" ${tip(`Nov ${Math.max(i + pc.from, 1)} · ${fmt(v)} so far${pc.prev ? `\nOct ${i + pc.from} · ${fmt(pc.prev[i + pc.from - 1])}` : ""}`)}/>`).join("");
    el.innerHTML = svg(W, H,
      `<line x1="${p.l}" x2="${W - p.r}" y1="${H - p.b}" y2="${H - p.b}" stroke="var(--bezel)"/>
       ${pc.prev ? `<path d="${line(pc.prev)}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="2 3"/>
         <text x="${W - p.r}" y="${y(pc.prev[30]) - 5}" text-anchor="end">Oct ${fmt(pc.prev[30])}</text>` : ""}
       <line x1="${x(last)}" x2="${x(last)}" y1="${p.t}" y2="${H - p.b}" stroke="var(--hairline)"/>
       <path d="${line(pc.cur, pc.from)}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>
       <circle cx="${x(last)}" cy="${y(lv)}" r="4" fill="${col}"/>${hover}
       <text x="${x(1)}" y="${H - 4}">1</text><text x="${x(last)}" y="${H - 4}" text-anchor="middle" class="lbl">Today</text><text x="${x(31)}" y="${H - 4}" text-anchor="end">31</text>`,
      `Cumulative spending this month: ${fmt(lv)} through day ${last}.`);
  };

  /* Bills to destroy: a 30-day lane. Further left is sooner; a bigger target is a bigger bill. */
  CH.lane = (el, m) => {
    const W = el.clientWidth, H = el.clientHeight, bills = m.bills.filter((b) => b.day <= 30);
    const late = bills.filter((b) => b.day < 0), up = bills.filter((b) => b.day >= 0).sort((a, b) => a.day - b.day);
    const zone = late.length ? 62 : 16, x = (d) => zone + (d / 30) * (W - zone - 24), cy = (H - 16) / 2 + 4;
    const max = Math.max(1, ...bills.map((b) => b.cents)), size = (c) => 12 + 24 * Math.sqrt(c / max);
    const target = (b, tx, ty) => {
      const s = size(b.cents), warn = b.day < 0, boom = m.boom && m.boom.name === b.name, blast = boom && m.boom.mode !== "pay", col = warn ? "var(--warn)" : "var(--usd)";
      const burst = blast ? `<g class="burst">${Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4; return `<line x1="${(Math.cos(a) * s * 0.7).toFixed(1)}" y1="${(Math.sin(a) * s * 0.7).toFixed(1)}" x2="${(Math.cos(a) * s * 1.25).toFixed(1)}" y2="${(Math.sin(a) * s * 1.25).toFixed(1)}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`; }).join("")}</g>` : "";
      return `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)})" data-pay="${esc(b.name)}" class="target" ${tip(`${b.name} ${F.usd(b.cents)}\n${warn ? `${-b.day} days overdue` : `Due ${F.date(b.day)}, in ${b.day} days`}\nClick to pay, or destroy it for good`)}>
        <g class="${blast ? "boom" : boom ? "hit" : ""}"><circle r="${s / 2}" fill="${warn ? "var(--warn)" : "var(--usd-soft)"}" stroke="${col}" stroke-width="1.6"${b.card ? ' stroke-dasharray="4 3"' : ""}/>
        ${s > 22 ? `<circle r="${s * 0.29}" fill="none" stroke="${warn ? "var(--lamp-on-ink)" : col}" stroke-width="1.2"/>` : ""}
        <circle r="${Math.max(1.8, s * 0.1)}" fill="${warn ? "var(--lamp-on-ink)" : col}"/></g>${burst}</g>`;
    };
    let out = `<line x1="${zone}" x2="${W}" y1="${cy}" y2="${cy}" stroke="var(--hairline)"/>`;
    if (late.length) out += `<rect x="0" y="6" width="${zone - 8}" height="${H - 26}" rx="6" fill="var(--warn)" opacity=".14"/><text x="${(zone - 8) / 2}" y="${H - 4}" text-anchor="middle" style="fill:var(--warn);font-weight:700">Past due</text>`;
    out += `<line x1="${x(0)}" x2="${x(0)}" y1="6" y2="${H - 18}" stroke="var(--ink-2)" stroke-width="1.5"/>`;
    out += [0, 7, 14, 21, 28].map((d) => `<text x="${x(d)}" y="${H - 4}" text-anchor="${d ? "middle" : "start"}"${d ? "" : ' class="lbl"'}>${d ? F.date(d) : "Today"}</text>`).join("");
    out += PROTO.six.paydays.map((p) => `<line x1="${x(p.day)}" x2="${x(p.day)}" y1="16" y2="${H - 18}" stroke="var(--plan)" stroke-dasharray="3 3"/><text x="${x(p.day)}" y="11" text-anchor="middle" style="fill:var(--plan)" ${tip(`Planned paycheck ${F.usd(p.cents)}\n${F.date(p.day)} · adds to your dollars in checking`)}>Payday +${F.usd0(p.cents)}</text>`).join("");
    out += late.map((b, i) => target(b, (zone - 8) / 2 + i * 8, cy)).join("");
    let prevX = -99, prevS = 0, flip = 1;
    for (const b of up) {
      const tx = x(b.day), s = size(b.cents), crowd = tx - prevX < (s + prevS) / 2 + 3;
      out += target(b, tx, crowd ? cy + flip * 15 : cy);
      flip = crowd ? -flip : 1; prevX = tx; prevS = s;
    }
    el.innerHTML = svg(W, H, out, `${up.length} bills in the next 30 days${late.length ? `, ${late.length} past due` : ""}. Nearest is furthest left.`);
  };

  /* Stack rate: share of income stacked each month. Higher is better. */
  CH.rate = (el, m) => {
    const W = el.clientWidth, H = el.clientHeight, r = m.stack.rates, n = r.length, top = Math.max(...r.map((d) => d[1])) * 1.1;
    const bw = Math.min(26, (W - 4) / n - 5), step = (W - bw) / (n - 1), y = (v) => 2 + (1 - v / top) * (H - 16);
    const avg = r.reduce((a, d) => a + d[1], 0) / n;
    el.innerHTML = svg(W, H,
      r.map((d, i) => `<rect x="${i * step}" y="${y(d[1])}" width="${bw}" height="${H - 14 - y(d[1])}" rx="2" fill="var(--btc)" opacity="${i === n - 1 ? 1 : 0.38}" ${tip(`${d[0]} · ${d[1].toFixed(1)}% of income stacked${i === n - 1 ? " so far" : ""}`)}/>
        <text x="${i * step + bw / 2}" y="${H - 2}" text-anchor="middle"${i === n - 1 ? ' class="lbl"' : ""}>${d[0]}</text>`).join("") +
      `<line x1="0" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--ink-3)" stroke-dasharray="2 3"/>`,
      `Stack rate by month. This month ${r[n - 1][1].toFixed(1)}%, average ${avg.toFixed(1)}%.`);
  };

  /* Cost of living: the same monthly spending, indexed to the first full month. */
  CH.dual = (el, m) => {
    const W = el.clientWidth, H = el.clientHeight, p = { l: 6, r: 92, t: 12, b: 18 };
    const t = m.two, n = t.months.length;
    const iu = t.usd.map((v) => (v / t.usd[0]) * 100), ib = t.bitcoin.map((v) => (v / t.bitcoin[0]) * 100);
    const lo = Math.min(...iu, ...ib, 100) - 4, hi = Math.max(...iu, ...ib, 100) + 4;
    const x = (i) => p.l + (i / (n - 1)) * (W - p.l - p.r), y = (v) => p.t + (1 - (v - lo) / (hi - lo)) * (H - p.t - p.b);
    const line = (a) => a.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
    const dots = (a, raw, col, f, name) => a.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${col}"/><circle cx="${x(i)}" cy="${y(v)}" r="8" fill="transparent" ${tip(`${t.months[i]} in ${name}\n${f(raw[i])} · index ${v.toFixed(1)}`)}/>`).join("");
    el.innerHTML = svg(W, H,
      `<line x1="${p.l}" x2="${W - p.r}" y1="${y(100)}" y2="${y(100)}" stroke="var(--bezel)" stroke-dasharray="3 4"/><text x="${p.l}" y="${y(100) - 4}">${t.months[0]} = 100</text>
       <path d="${line(iu)}L${x(n - 1)},${y(ib[n - 1])}${ib.slice().reverse().map((v, i) => `L${x(n - 1 - i)},${y(v)}`).join("")}Z" fill="var(--btc-soft)" opacity=".5"/>
       <path d="${line(iu)}" fill="none" stroke="var(--usd)" stroke-width="2"/><path d="${line(ib)}" fill="none" stroke="var(--btc)" stroke-width="2.4"/>
       ${dots(iu, t.usd, "var(--usd)", F.usd, "dollars")}${dots(ib, t.bitcoin, "var(--btc)", F.btc, "bitcoin")}
       <text x="${W - p.r + 8}" y="${y(iu[n - 1]) + 4}" style="fill:var(--usd);font-size:11px">Dollars ${F.pct(iu[n - 1] - 100)}</text>
       <text x="${W - p.r + 8}" y="${y(ib[n - 1]) + 4}" style="fill:var(--btc);font-size:11px;font-weight:700">Bitcoin ${F.pct(ib[n - 1] - 100)}</text>
       ${t.months.map((mo, i) => `<text x="${x(i)}" y="${H - 4}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${mo}</text>`).join("")}`,
      `Monthly cost of living indexed to ${t.months[0]}: dollars ${F.pct(iu[n - 1] - 100)}, bitcoin ${F.pct(ib[n - 1] - 100)}.`);
  };

  /* Month bridge: which categories carry last month's total to this month's. */
  CH.bridge = (el, m) => {
    const W = el.clientWidth, b = m.bridge, fmt = m.fmt, rowH = 24, top = 22, lab = Math.min(110, W * 0.3), valW = 86;
    const H = top + rowH * b.steps.length + 26;
    el.style.height = H + "px";
    const ends = b.steps.flatMap((s) => [s.start, s.end]).concat(b.prior, b.current);
    const lo = Math.min(...ends), hi = Math.max(...ends), padv = (hi - lo) * 0.12 || 1;
    const x = (v) => lab + ((v - (lo - padv)) / (hi - lo + padv * 2)) * (W - lab - valW);
    const col = m.lens === "USD" ? "var(--usd)" : "var(--btc)";
    const rows = b.steps.map((s, i) => {
      const yy = top + i * rowH, x0 = x(Math.min(s.start, s.end)), w = Math.max(2, Math.abs(x(s.end) - x(s.start))), up = s.change > 0;
      return `<g data-drill="${esc(s.name)}" ${tip(`${s.name}: ${up ? "+" : "−"}${fmt(Math.abs(s.change))} vs October\n${fmt(s.was)} → ${fmt(s.now)} · click for transactions`)}>
        <rect x="0" y="${yy}" width="${W}" height="${rowH}" fill="transparent"/>
        <text class="lbl" x="0" y="${yy + 15}" style="font-family:var(--font-ui);font-size:12px">${esc(s.name)}</text>
        <rect x="${x0}" y="${yy + 5}" width="${w}" height="${rowH - 10}" rx="2" fill="${up ? col : "none"}" stroke="${col}" stroke-width="1.4"${up ? "" : ' stroke-dasharray="3 2"'}/>
        <path d="M${x(s.end)},${yy + rowH - 5}V${yy + rowH + 5}" stroke="var(--ink-3)" stroke-width="1"/>
        <text x="${W}" y="${yy + 15}" text-anchor="end" class="lbl">${up ? "+" : "−"}${fmt(Math.abs(s.change))}</text></g>`;
    }).join("");
    const yEnd = top + b.steps.length * rowH;
    el.innerHTML = svg(W, H,
      `<line x1="${x(b.prior)}" x2="${x(b.prior)}" y1="${top - 6}" y2="${top + 5}" stroke="var(--ink-2)" stroke-width="2"/>
       <text x="${x(b.prior)}" y="${top - 10}" text-anchor="${x(b.prior) > W / 2 ? "end" : "start"}">Oct 1–19 · ${fmt(b.prior)}</text>
       ${rows}
       <line x1="${x(b.current)}" x2="${x(b.current)}" y1="${yEnd - 5}" y2="${yEnd + 8}" stroke="${col}" stroke-width="2.5"/>
       <text x="${x(b.current)}" y="${yEnd + 21}" text-anchor="${x(b.current) > W / 2 ? "end" : "start"}" class="lbl" style="font-weight:700">Nov 1–19 · ${fmt(b.current)}</text>`,
      `Change from October to November through day 19, by category. Total ${fmt(b.current - b.prior)}.`);
  };

  /* Watershed: one month, source to destination. Bitcoin stacked is the flow that matters. */
  CH.watershed = (el, m) => {
    const w = m.flow, fmt = m.fmt;
    let W = el.clientWidth, H = el.clientHeight;
    const narrow = W < 520, L = narrow ? 86 : 150, Rr = narrow ? 124 : 210, nodeW = 8, gap = 4, top = 6;
    const need = top * 2 + w.dests.length * 19 + 96;
    if (el.clientHeight < need) el.style.height = need + "px";
    const total = w.sources.reduce((a, s) => a + s.v, 0);
    H = el.clientHeight;
    const minSlot = 15, usable = H - top * 2 - gap * (w.dests.length - 1);
    let k = usable / total;
    for (let i = 0; i < 24; i++) k *= usable / w.dests.reduce((a, d) => a + Math.max(d.v * k, minSlot), 0);
    const xs = L, xh = L + (W - L - Rr) * 0.42, xd = W - Rr - nodeW;
    const ribbon = (x0, a0, a1, x1, b0, b1, fill, op, extra = "") => {
      const mx = (x0 + x1) / 2;
      return `<path d="M${x0},${a0}C${mx},${a0} ${mx},${b0} ${x1},${b0}L${x1},${b1}C${mx},${b1} ${mx},${a1} ${x0},${a1}Z" fill="${fill}" opacity="${op}" ${extra}/>`;
    };
    const hubTop = (H - total * k) / 2;
    let out = "", ys = hubTop, yh = hubTop;
    for (const s of w.sources) {
      const h = s.v * k;
      out += ribbon(xs + nodeW, ys, ys + h, xh, yh, yh + h, "var(--usd)", 0.13);
      out += `<rect x="${xs}" y="${ys}" width="${nodeW}" height="${h}" rx="2" fill="var(--usd)" ${tip(`${s.name} ${fmt(s.v)}`)}/>
        <text class="lbl" x="${xs - 8}" y="${ys + h / 2 - 2}" text-anchor="end" style="font-family:var(--font-ui);font-size:12px">${esc(s.name)}</text>
        <text x="${xs - 8}" y="${ys + h / 2 + 11}" text-anchor="end">${fmt(s.v)}</text>`;
      ys += h; yh += h;
    }
    out += `<rect x="${xh}" y="${hubTop}" width="${nodeW}" height="${total * k}" rx="2" fill="var(--ink-3)"/>`;
    let ya = hubTop, yd = top;
    for (const d of w.dests) {
      const h = Math.max(d.v * k, 1.5), slot = Math.max(h, minSlot), fill = d.kind === "stack" ? "var(--btc)" : d.kind === "rest" ? "var(--ink-3)" : "var(--usd)";
      const op = d.kind === "stack" ? 0.6 : d.kind === "rest" ? 0.1 : 0.2;
      const y0d = yd + (slot - h) / 2;
      out += ribbon(xh + nodeW, ya, ya + h, xd, y0d, y0d + h, fill, op, d.drill ? `data-drill="${esc(d.name)}"` : "");
      out += `<rect x="${xd}" y="${y0d}" width="${nodeW}" height="${h}" rx="2" fill="${fill}" ${d.drill ? `data-drill="${esc(d.name)}"` : ""} ${tip(`${d.name} ${d.label || fmt(d.v)}${d.note ? "\n" + d.note : ""}`)}/>`;
      const ty = yd + slot / 2 + 4, one = h < 22;
      out += d.kind === "stack"
        ? `<text x="${xd + nodeW + 8}" y="${one ? ty : ty - 7}" style="fill:var(--btc);font-family:var(--font-ui);font-size:12.5px;font-weight:700">Bitcoin stacked</text><text x="${xd + nodeW + 8}" y="${one ? ty : ty + 7}" dx="${one ? 104 : 0}" style="fill:var(--btc);font-size:11px">${d.label}</text>`
        : `<text class="lbl" x="${xd + nodeW + 8}" y="${ty}" style="font-family:var(--font-ui);font-size:${d.kind === "rest" ? 11.5 : 12}px;${d.kind === "rest" ? "fill:var(--ink-3)" : ""}">${esc(d.name)} <tspan style="font-family:var(--font-num);font-size:10.5px;fill:var(--ink-3)" dx="4">${fmt(d.v)}</tspan></text>`;
      ya += h; yd += slot + gap;
    }
    el.innerHTML = svg(W, H, out, `Where November's income flowed: ${w.dests.map((d) => `${d.name} ${d.label || fmt(d.v)}`).join(", ")}.`);
  };

  /* Small projection curve for the retirement readout (hypothetical, so amethyst). */
  CH.course = (el) => {
    const W = el.clientWidth, H = el.clientHeight, n = 40;
    const pts = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1), v = t < 0.42 ? 0.35 + 1.5 * t : 0.98 - 0.72 * Math.pow((t - 0.42) / 0.58, 1.6);
      return `${i ? "L" : "M"}${4 + t * (W - 8)},${H - 14 - v * (H - 26)}`;
    }).join("");
    const xr = 4 + 0.42 * (W - 8);
    el.innerHTML = svg(W, H,
      `<line x1="4" x2="${W - 4}" y1="${H - 14}" y2="${H - 14}" stroke="var(--bezel)"/><path d="${pts}" fill="none" stroke="var(--plan)" stroke-width="2" stroke-dasharray="5 3"/>
       <line x1="${xr}" x2="${xr}" y1="6" y2="${H - 14}" stroke="var(--plan)" stroke-dasharray="2 3"/><text x="${xr + 4}" y="12" style="fill:var(--plan)">Retire 58</text>
       <text x="4" y="${H - 2}">Age 41</text><text x="${W - 4}" y="${H - 2}" text-anchor="end">95</text>`,
      "Hypothetical projection of the Base case scenario to age 95.");
  };

  window.CH = CH;
  window.F = F;
})();
