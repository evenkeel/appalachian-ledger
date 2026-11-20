import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // index.html is the new interface; legacy.html keeps the previous one until every screen is rebuilt.
      input: { main: "index.html", legacy: "legacy.html" },
      output: { manualChunks: { charts: ["recharts"] } },
    },
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts", css: false },
});
