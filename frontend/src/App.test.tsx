import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { api } from "./lib/api";

vi.mock("./lib/api", () => ({
  api: vi.fn(),
  setCsrf: vi.fn(),
  download: vi.fn(),
}));
vi.mock("./lib/usePriceUpdates", () => ({ usePriceUpdates: vi.fn() }));
vi.mock("./components/FinancialViews", () => ({
  OverviewView: ({ utilities }: { utilities: ReactNode }) => <>{utilities}</>,
  ReportsView: () => null,
  CurrencyToggle: ({
    unit,
    onChange,
    disabled,
  }: {
    unit: string;
    onChange: (unit: string) => void;
    disabled: boolean;
  }) => (
    <div role="group" aria-label="Reporting currency">
      {["USD", "BITCOIN"].map((value) => (
        <button
          key={value}
          disabled={disabled}
          aria-pressed={unit === value}
          onClick={() => onChange(value)}
        >
          {value}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./components/Settings", () => ({
  Settings: ({ onLogout }: { onLogout: () => void }) => (
    <button onClick={onLogout}>Finish restore</button>
  ),
}));

let nextSession = false;
beforeEach(() => {
  nextSession = false;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/auth/status")
      return { initialized: true, demo_enabled: false };
    if (path === "/auth/me" || path === "/auth/login")
      return { username: "owner", csrf: "token", demo: false };
    if (path === "/auth/logout") return { ok: true };
    // Keep the next ledger load pending so stale state cannot hide behind a fast refresh.
    if (nextSession) return new Promise(() => {});
    if (path === "/settings")
      return {
        preferences: {
          theme: "dark",
          denomination: "USD",
          rate_source: "manual",
        },
      };
    if (path.startsWith("/reports?")) return { month: "2026-11", history: [] };
    if (path === "/accounts")
      return [
        {
          id: 1,
          name: "Previous ledger account",
          kind: "checking",
          role: "asset",
          currency: "USD",
        },
      ];
    if (path === "/categories")
      return [{ id: 1, name: "Previous ledger category", kind: "expense" }];
    return [];
  });
});

test.each(["sign out", "expired session", "restore"])(
  "%s clears ledger state before another login",
  async (action) => {
    render(<App />);
    await screen.findByRole("button", { name: "Add expense" });
    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    fireEvent.change(screen.getByLabelText("Search transactions"), {
      target: { value: "Private search" },
    });
    fireEvent.change(screen.getByLabelText("Filter account"), {
      target: { value: "1" },
    });
    if (action === "restore") {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      fireEvent.click(screen.getByRole("button", { name: "Finish restore" }));
    } else if (action === "expired session") {
      fireEvent(window, new Event("ledger:session-expired"));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    }
    await screen.findByRole("button", { name: "Log in" });
    nextSession = true;
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "owner" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "correct-horse-battery-staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    expect(screen.getByLabelText("Search transactions")).toHaveValue("");
    expect(screen.getByLabelText("Filter account")).toHaveValue("");
    expect(
      screen.queryByRole("option", { name: "Previous ledger account" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(
      screen.queryByRole("option", { name: "Previous ledger category" }),
    ).not.toBeInTheDocument();
  },
);

test("workspace lens saves independently, survives navigation, and reloads from settings", async () => {
  const { unmount } = render(<App />);
  const bitcoin = await screen.findByRole("button", {
    name: "BITCOIN",
  });
  await waitFor(() => expect(bitcoin).toBeEnabled());
  fireEvent.click(bitcoin);
  await waitFor(() => expect(bitcoin).toHaveAttribute("aria-pressed", "true"));
  expect(api).toHaveBeenCalledWith("/settings/monetary-lens", "PUT", {
    denomination: "BITCOIN",
  });
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === "PUT"),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
  expect(bitcoin).toHaveAttribute("aria-pressed", "true");
  unmount();
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, ...args) =>
    path === "/settings"
      ? {
          preferences: {
            theme: "dark",
            denomination: "BITCOIN",
            rate_source: "manual",
          },
        }
      : implementation(path, ...args),
  );
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "BITCOIN" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
});

test("failed lens save retains the saved currency and reports the failure", async () => {
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, ...args) => {
    if (path === "/settings/monetary-lens") throw new Error("Offline");
    return implementation(path, ...args);
  });
  render(<App />);
  const bitcoin = await screen.findByRole("button", {
    name: "BITCOIN",
  });
  await waitFor(() => expect(bitcoin).toBeEnabled());
  fireEvent.click(bitcoin);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save monetary lens: Offline",
  );
  expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a pending lens save cannot change a later session", async () => {
  let finishSave!: (value: unknown) => void;
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, ...args) => {
    if (path === "/settings/monetary-lens")
      return new Promise((resolve) => {
        finishSave = resolve;
      });
    return implementation(path, ...args);
  });
  render(<App />);
  const bitcoin = await screen.findByRole("button", { name: "BITCOIN" });
  await waitFor(() => expect(bitcoin).toBeEnabled());
  fireEvent.click(bitcoin);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("button", { name: "Log in" });
  finishSave({ denomination: "BITCOIN" });
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "owner" },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: "correct-horse-battery-staple" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  const usd = await screen.findByRole("button", { name: "USD" });
  await waitFor(() => expect(usd).toBeEnabled());
  expect(usd).toHaveAttribute("aria-pressed", "true");
});

test("Accounts hides archived cards until Show archived is selected", async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, ...args) => {
    if (path === "/accounts")
      return [
        {
          id: 9,
          name: "Closed checking",
          kind: "checking",
          role: "asset",
          currency: "USD",
          balance: "0.00",
          archived: true,
        },
      ];
    return original(path, ...args);
  });
  render(<App />);
  await screen.findByRole("button", { name: "Add expense" });
  fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
  expect(
    screen.queryByRole("button", { name: "Closed checking" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }));
  expect(
    screen.getByRole("button", { name: "Closed checking" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }));
  expect(
    screen.queryByRole("button", { name: "Closed checking" }),
  ).not.toBeInTheDocument();
});
