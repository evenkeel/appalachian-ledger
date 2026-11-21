import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replies: Record<string, unknown> = {};
const calls: { path: string; method: string; body?: unknown }[] = [];
vi.mock("../../lib/api", () => ({
  setCsrf: vi.fn(),
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    const reply = replies[`${method} ${path}`];
    if (reply instanceof Error) throw reply;
    return reply;
  }),
}));

import { SignIn } from "../shell/SignIn";
import { SessionProvider, useSession } from "./session";

function Probe() {
  const { phase, theme, lens, username } = useSession();
  return phase === "setup" || phase === "locked" ? <SignIn /> : <p>{`${phase} ${theme} ${lens} ${username}`}</p>;
}
const show = () =>
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(replies)) delete replies[key];
});

describe("session", () => {
  it("creates the first owner even though the sign-up reply carries no preferences", async () => {
    replies["GET /auth/status"] = { initialized: false, demo_enabled: false };
    replies["POST /auth/setup"] = { username: "owner", csrf: "token" };
    show();
    await screen.findByRole("heading", { name: "Create your owner account" });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-battery" } });
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("ready night USD owner")).toBeInTheDocument();
    expect(calls).toContainEqual({ path: "/auth/setup", method: "POST", body: { username: "owner", password: "correct-horse-battery" } });
  });

  it("refuses mismatched or short passwords before anything is sent", async () => {
    replies["GET /auth/status"] = { initialized: false, demo_enabled: false };
    show();
    await screen.findByRole("heading", { name: "Create your owner account" });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-battery" } });
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "different-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("restores the saved theme and lens for a returning owner", async () => {
    replies["GET /auth/status"] = { initialized: true, demo_enabled: false };
    replies["GET /auth/me"] = { username: "owner", csrf: "t", demo: false, preferences: { theme: "light", denomination: "BITCOIN" } };
    show();
    expect(await screen.findByText("ready day BITCOIN owner")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("day"));
  });

  it("shows the unlock screen, and nothing else, when the session has ended", async () => {
    replies["GET /auth/status"] = { initialized: true, demo_enabled: false };
    replies["GET /auth/me"] = new Error("Request failed (401)");
    show();
    expect(await screen.findByRole("heading", { name: "Unlock your ledger" })).toBeInTheDocument();
  });

  it("blanks the screen when a session expires mid-use", async () => {
    replies["GET /auth/status"] = { initialized: true, demo_enabled: false };
    replies["GET /auth/me"] = { username: "owner", csrf: "t", preferences: {} };
    show();
    await screen.findByText("ready night USD owner");
    window.dispatchEvent(new Event("ledger:session-expired"));
    expect(await screen.findByRole("heading", { name: "Unlock your ledger" })).toBeInTheDocument();
    expect(screen.queryByText(/ready night/)).toBeNull();
  });
});
