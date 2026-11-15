import { useEffect } from "react";
import { api } from "./api";
import type { PriceStatus } from "../components/PriceSettings";

// Poll local sync state, not the provider. Refresh money views only when prices change.
export function usePriceUpdates(
  enabled: boolean,
  source: string,
  refresh: () => void,
) {
  useEffect(() => {
    if (!enabled || source === "manual") return;
    let alive = true;
    let previous = "";
    let loading = false;
    async function check() {
      if (loading) return;
      loading = true;
      try {
        const status = await api<PriceStatus>("/prices/status");
        const version = JSON.stringify([
          status.source,
          status.quote?.fetched_at,
          status.quote?.stale,
          status.history?.last_success_at,
        ]);
        if (alive && version !== previous) {
          previous = version;
          refresh();
        }
      } catch {
        /* The normal data loader owns API errors; never invent a quote. */
      } finally {
        loading = false;
      }
    }
    void check();
    const timer = window.setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [enabled, source, refresh]);
}
