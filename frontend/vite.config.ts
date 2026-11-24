import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// A second dev server can use its own backend: API_TARGET=http://127.0.0.1:8010 npm run dev
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * `--mode demo` builds the website demo: the same interface, answered from saved fictional
 * responses in `demo-public/demo-data` (written by `scripts/web_demo.py`) instead of a server.
 * It uses relative addresses throughout, so it can be served from any folder of a static site.
 */
const demoPage: Plugin = {
  name: "demo-page",
  transformIndexHtml: (html) =>
    html
      .replace('data-theme="night"', 'data-theme="day"')
      .replace('content="#070E13"', 'content="#EBE9E1"')
      .replace("<title>Appalachian Bitcoin</title>", "<title>Appalachian Bitcoin: fictional demo</title>")
      .replace(/<main>[\s\S]*?<\/main>/, "<main><h1>Appalachian Bitcoin</h1><p>Loading the fictional demo…</p></main>"),
};

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  // index.html is the new interface; legacy.html keeps the previous one until every screen is rebuilt.
  const input: Record<string, string> = demo ? { main: "index.html" } : { main: "index.html", legacy: "legacy.html" };
  return {
    plugins: [react(), tailwindcss(), ...(demo ? [demoPage] : [])],
    base: demo ? "./" : "/",
    publicDir: demo ? "demo-public" : "public",
    build: {
      // The entry awaits the demo's saved answers before the first render.
      target: "es2022",
      outDir: demo ? "../website/dist/demo" : "dist",
      emptyOutDir: true,
      rollupOptions: {
        input,
        output: { manualChunks: { charts: ["recharts"] } },
      },
    },
    server: { port: 5173, proxy: { "/api": env.API_TARGET ?? "http://127.0.0.1:8000" } },
    test: { environment: "jsdom", setupFiles: "./src/test-setup.ts", css: false },
  };
});
