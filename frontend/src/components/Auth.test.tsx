import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Auth } from "../App";
import { api, setCsrf } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: vi.fn(),
  setCsrf: vi.fn(),
  download: vi.fn(),
}));
const owner = { username: "tester", csrf: "test-csrf", demo: false };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue(owner);
});

test("first visit creates an account and opens the authenticated ledger", async () => {
  const onOwner = vi.fn();
  render(<Auth initialized={false} onOwner={onOwner} />);
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "tester" },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: "test-password-123" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "test-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(onOwner).toHaveBeenCalledWith(owner));
  expect(api).toHaveBeenCalledWith("/auth/setup", "POST", {
    username: "tester",
    password: "test-password-123",
  });
  expect(setCsrf).toHaveBeenCalledWith(owner.csrf);
});

test("mismatched confirmation does not create an account", async () => {
  render(<Auth initialized={false} onOwner={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "tester" },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: "test-password-123" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "different-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Passwords do not match.",
  );
  expect(api).not.toHaveBeenCalled();
});

test("returning users log in and authentication errors remain visible", async () => {
  const onOwner = vi.fn();
  vi.mocked(api).mockRejectedValueOnce(
    new Error("Invalid username or password"),
  );
  render(<Auth initialized onOwner={onOwner} />);
  expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "tester" },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: "test-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Invalid username or password",
  );
  expect(onOwner).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(onOwner).toHaveBeenCalledWith(owner));
  expect(api).toHaveBeenLastCalledWith("/auth/login", "POST", {
    username: "tester",
    password: "test-password-123",
  });
});
