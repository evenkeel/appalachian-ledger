import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { usePriceUpdates } from "./usePriceUpdates";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));

test("new and stale prices refresh financial views, unchanged prices and offline mode do not", async () => {
  vi.useFakeTimers();
  try {
    const refresh = vi.fn();
    vi.mocked(api).mockResolvedValue({
      source: "coinbase",
      quote: { fetched_at: "2026-01-01T12:00:00Z", stale: false },
    });
    const hook = renderHook(
      ({ source }) => usePriceUpdates(true, source, refresh),
      { initialProps: { source: "manual" } },
    );
    expect(api).not.toHaveBeenCalled();
    await act(async () => {
      hook.rerender({ source: "coinbase" });
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.mocked(api).mockResolvedValue({
      source: "coinbase",
      quote: { fetched_at: "2026-01-01T12:00:00Z", stale: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    hook.unmount();
  } finally {
    vi.useRealTimers();
  }
});
