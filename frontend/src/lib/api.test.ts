import { afterEach, expect, test, vi } from "vitest";
import { api, download, setCsrf } from "./api";
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf("");
});
test("mutations send session CSRF and preserve exact monetary strings", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  setCsrf("session-token");
  await api("/transactions", "POST", { amount: "9223372036854775807" });
  const options = fetcher.mock.calls[0][1];
  expect(options.headers["X-CSRF-Token"]).toBe("session-token");
  expect(options.body).toBe('{"amount":"9223372036854775807"}');
  expect(options.credentials).toBe("same-origin");
});
test("expired sessions tell the interface to lock and revoke cached CSRF", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response('{"detail":"Please sign in"}', { status: 401 }),
      ),
  );
  setCsrf("expired");
  const listener = vi.fn();
  window.addEventListener("ledger:session-expired", listener);
  await expect(api("/accounts")).rejects.toThrow("Please sign in");
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener("ledger:session-expired", listener);
});

test.each([api, (path: string) => download(path, "backup.albackup")])(
  "API and download failures retain validation details and handle non-JSON errors: %s",
  async (request) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ["body", "passphrase"],
              msg: "Must be at least 12 characters",
            },
          ],
        }),
        { status: 422 },
      ),
    );
    await expect(request("/backup")).rejects.toThrow(
      "passphrase: Must be at least 12 characters",
    );
    fetcher.mockResolvedValueOnce(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );
    await expect(request("/backup")).rejects.toThrow("Request failed (502)");
  },
);

test.each([api, (path: string) => download(path, "backup.albackup")])(
  "an old server or static HTML fallback explains how to recover: %s",
  async (request) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(
      new Response('{"detail":"Method Not Allowed"}', { status: 405 }),
    );
    await expect(request("/backup")).rejects.toThrow(
      "Restart the ledger with the latest code",
    );
    fetcher.mockResolvedValueOnce(
      new Response("<html>Ledger</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    await expect(request("/backup")).rejects.toThrow(
      "Restart the ledger with the latest code",
    );
    fetcher.mockResolvedValueOnce(
      new Response('{"detail":"Category not found"}', { status: 404 }),
    );
    await expect(request("/categories/99")).rejects.toThrow(
      "Category not found",
    );
  },
);
