import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./design/tokens.css";
import "./design/app.css";
import { DEMO } from "../demo/mode";

// The website demo loads its saved answers before the first screen asks for anything.
// The app itself never fetches this code.
if (DEMO) {
  document.documentElement.classList.add("demo");
  await (await import("../demo/start")).startDemo();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
