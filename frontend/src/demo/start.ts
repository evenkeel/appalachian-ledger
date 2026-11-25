/**
 * Starts the website demo: loads the saved answers, sets the clock to the day they were saved,
 * and puts the stand-in server in place. Only the demo build ever imports this.
 */
import { setStandIn } from "../lib/api";
import { createServer } from "./server";
import type { Core } from "./server";

let info: Core | null = null;
/** What the demo was built from; null in the app itself. */
export const demoInfo = () => info;

/**
 * The demo ledger stops on the day it was built. Without this, a visitor a month later would
 * see date pickers and "today" marks a month ahead of every figure on the page. Time still
 * moves, from that moment, so anything timing a press or an animation works as usual.
 */
export function pinClock(to: string) {
  const RealDate = Date;
  const offset = new RealDate(to).getTime() - RealDate.now();
  class DemoDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = DemoDate as DateConstructor;
}

export async function startDemo() {
  const folder = new URL("demo-data/", document.baseURI);
  const load = async (file: string) => {
    const response = await fetch(new URL(`${file}.json`, folder));
    if (!response.ok) throw new Error("The demo's files could not be loaded. Reload the page to try again.");
    return response.json() as Promise<unknown>;
  };
  const core = (await load("core")) as Core;
  info = core;
  pinClock(core.captured_at);
  setStandIn(createServer(core, load));
}
