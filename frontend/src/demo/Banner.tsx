import type { ReactNode } from "react";
import { DOWNLOAD_URL } from "./mode";
import "./demo.css";

/** The slim strip across the top of the website demo. */
export function DemoBanner() {
  return (
    <aside className="demo-banner" aria-label="About this demo">
      <p>
        <b>Fictional demo</b> — nothing is saved
        <span className="demo-more">. A made-up person&rsquo;s money, with real bitcoin prices.</span>
      </p>
      <a className="btn" href={DOWNLOAD_URL}>
        Download
      </a>
    </aside>
  );
}

/** A screen that needs the app's own server, so the browser demo cannot show it. */
export function NotInDemo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <section className="inst demo-absent">
        <p>{children}</p>
        <p className="sub">Everything else in the demo is the real app, on a fictional ledger.</p>
        <a className="btn primary" href={DOWNLOAD_URL}>
          Download the app
        </a>
      </section>
    </div>
  );
}
