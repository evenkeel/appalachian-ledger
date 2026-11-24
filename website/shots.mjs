// Takes the website's pictures from the built browser demo, so they always show the current
// app on the fictional ledger and never anyone's real records.
//
//   node website/shots.mjs http://127.0.0.1:5214/demo/
//
// Needs Google Chrome and the demo being served (`make site-preview`). Writes to website/pages/img.
// Chrome is driven over its debugging port; nothing is installed and nothing leaves this computer.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const demo = process.argv[2] ?? "http://127.0.0.1:5214/demo/";
const out = join(dirname(fileURLToPath(import.meta.url)), "pages", "img");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9335;

// Each picture: the screen, the window size, and optionally one panel to cut out by its name.
const SHOTS = [
  { file: "dashboard.png", route: "", width: 1440, height: 900, scale: 1.6667 },
  { file: "checking-forecast.png", route: "", width: 1440, height: 1100, scale: 2, panel: "Checking forecast" },
  { file: "cost-of-living.png", route: "", width: 1440, height: 1100, scale: 2, panel: "Cost of living", press: "All" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "site-shots-"))}`, "--no-first-run", "--hide-scrollbars", "about:blank"],
  { stdio: "ignore" },
);
try {
  let address;
  for (let tries = 0; tries < 60 && !address; tries++) {
    try {
      address = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((tab) => tab.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!address) await sleep(250);
  }
  if (!address) throw new Error("Chrome did not start. Set CHROME to its path.");
  const socket = new WebSocket(address);
  await new Promise((resolve) => (socket.onopen = resolve));
  let id = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      socket.send(JSON.stringify({ id: n, method, params }));
    });
  const run = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

  await send("Page.enable");
  for (const shot of SHOTS) {
    await send("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: shot.scale, mobile: false });
    await send("Page.navigate", { url: "about:blank" });
    await send("Page.navigate", { url: `${demo}#/${shot.route}` });
    await sleep(3500);
    // The pictures show the app itself; the page they sit on already says it is the demo.
    await run(`(() => {
      const style = document.createElement("style");
      style.textContent = ".demo-banner{display:none!important} html.demo{--demo-banner:0px!important}";
      document.head.append(style);
    })()`);
    const find = `[...document.querySelectorAll(".inst")].find((panel) => panel.querySelector(".inst-name")?.textContent.trim().toLowerCase().startsWith(${JSON.stringify((shot.panel ?? "").toLowerCase())}))`;
    if (shot.press) {
      await run(`(() => { const panel = ${find}; [...(panel?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(shot.press)})?.click(); })()`);
      await sleep(1500);
    }
    let clip;
    if (shot.panel) {
      // Bring it into view first and let the chart settle, then measure it.
      await run(`(${find})?.scrollIntoView({ block: "center" })`);
      await sleep(1200);
      clip = await run(`(() => { const panel = ${find}; if (!panel) return null; const box = panel.getBoundingClientRect(); return { x: box.x + scrollX - 8, y: box.y + scrollY - 8, width: box.width + 16, height: box.height + 16, scale: 1 }; })()`);
      if (!clip) throw new Error(`No panel named "${shot.panel}" on #/${shot.route}`);
    }
    const picture = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    writeFileSync(join(out, shot.file), Buffer.from(picture.data, "base64"));
    console.log(`${shot.file}${clip ? `  ${Math.round(clip.width)}x${Math.round(clip.height)} at ${shot.scale}x` : ""}`);
  }
  socket.close();
} finally {
  chrome.kill();
}
