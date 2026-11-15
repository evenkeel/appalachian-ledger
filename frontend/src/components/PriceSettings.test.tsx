import { test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PriceSettings, QuoteStatus } from "./PriceSettings";
import type { PriceStatus } from "./PriceSettings";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const status: PriceStatus = {
  source: "coinbase",
  automatic: true,
  history: null,
  quote: {
    usd_per_btc: "120000.00",
    source: "Coinbase",
    observed_at: "2026-01-05T12:00:00Z",
    fetched_at: "2026-01-05T12:01:00Z",
    stale: true,
  },
};
beforeEach(() => {
  vi.mocked(api).mockReset();
});

test("a stale current price is labeled with its source and timestamp", () => {
  render(<QuoteStatus status={status} />);
  expect(screen.getByText("$120,000.00")).toBeInTheDocument();
  expect(screen.getByText(/Stale · .* · Coinbase/)).toBeInTheDocument();
  expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
});

test("unavailable prices are not zero", () => {
  render(<QuoteStatus status={{ ...status, quote: null }} />);
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
});

test("manual mode cannot request remote prices until provider settings are saved", async () => {
  vi.mocked(api).mockResolvedValue({
    ...status,
    source: "manual",
    quote: null,
  });
  render(
    <PriceSettings
      preferences={{
        denomination: "USD",
        theme: "dark",
        rate_source: "manual",
      }}
      rates={[]}
      onRate={vi.fn()}
      onRefresh={vi.fn()}
      onNotice={vi.fn()}
    />,
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith("/prices/status"));
  expect(screen.getByRole("button", { name: "Refresh price" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sync history" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Price source"), {
    target: { value: "coinbase" },
  });
  fireEvent.click(screen.getByLabelText("Automatic prices"));
  fireEvent.click(screen.getByRole("button", { name: "Save price settings" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/settings", "PUT", {
      denomination: "USD",
      theme: "dark",
      rate_source: "coinbase",
      automatic_prices: true,
    }),
  );
});

test("review shows exact conversions and saves only the reviewed entry/rate pairs", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/prices/status") return status;
    if (path === "/prices/conversions")
      return {
        missing: 1,
        items: [
          {
            entry_id: 42,
            rate_id: 8,
            date: "2026-01-05",
            description: "Groceries",
            source: "Coinbase",
            method: "daily_close",
            usd_per_btc: "100000",
            bitcoin: "10000",
            usd: "10.00",
          },
        ],
      };
    return { attached: 1 };
  });
  render(
    <PriceSettings
      preferences={{
        denomination: "USD",
        theme: "dark",
        rate_source: "coinbase",
      }}
      rates={[]}
      onRate={vi.fn()}
      onRefresh={vi.fn()}
      onNotice={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review missing conversions" }),
  );
  expect(await screen.findByText("Groceries")).toBeInTheDocument();
  expect(screen.getByText("₿10,000")).toBeInTheDocument();
  expect(screen.getByText("$10.00")).toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.some((call) => call[1] === "POST")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save 1 conversions" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/prices/conversions", "POST", {
      items: [{ entry_id: 42, rate_id: 8 }],
    }),
  );
});
