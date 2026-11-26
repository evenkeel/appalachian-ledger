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

  it("lets someone new start their own ledger from the sign-in screen", async () => {
    localStorage.clear();
    replies["GET /auth/status"] = { initialized: true, demo_enabled: false };
    replies["GET /auth/me"] = new Error("Request failed (401)");
    replies["POST /auth/setup"] = { username: "ben", csrf: "token" };
    show();
    fireEvent.click(await screen.findByRole("button", { name: "New to this computer? Start your own ledger" }));
    expect(screen.getByRole("heading", { name: "Start your own ledger" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ben" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "bens-password" } });
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "bens-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("ready night USD ben")).toBeInTheDocument();
    expect(calls).toContainEqual({ path: "/auth/setup", method: "POST", body: { username: "ben", password: "bens-password" } });
    expect(JSON.parse(localStorage.getItem("ledger:names")!)).toEqual(["ben"]);
  });

  it("offers the names that have signed in on this browser, and no others", async () => {
    localStorage.setItem("ledger:names", JSON.stringify(["ann", "ben"]));
    replies["GET /auth/status"] = { initialized: true, demo_enabled: false };
    replies["GET /auth/me"] = new Error("Request failed (401)");
    replies["POST /auth/login"] = { username: "ben", csrf: "token" };
    show();
    const people = await screen.findByRole("group", { name: "People who have signed in here" });
    expect(people.textContent).toBe("annben");
    fireEvent.click(screen.getByRole("button", { name: "ben" }));
    expect(screen.getByLabelText("Username")).toHaveValue("ben");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "bens-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("ready night USD ben")).toBeInTheDocument();
    expect(calls).toContainEqual({ path: "/auth/login", method: "POST", body: { username: "ben", password: "bens-password" } });
    // The list came from this browser: the server was never asked who has a ledger.
    expect(calls.map((call) => call.path).sort()).toEqual(["/auth/login", "/auth/me", "/auth/status"]);
    localStorage.clear();
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
