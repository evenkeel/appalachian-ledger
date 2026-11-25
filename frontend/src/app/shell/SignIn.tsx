import { useState } from "react";
import type { FormEvent } from "react";
import { Lockup } from "../design/Logo";
import { useSession } from "../lib/session";

/** First-run setup and sign-in. Nothing from the ledger is shown until this succeeds. */
export function SignIn() {
  const { phase, signIn } = useSession();
  const creating = phase === "setup";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (creating && password !== data.get("confirm")) return setError("The two passwords do not match.");
    if (creating && password.length < 12) return setError("Use at least 12 characters.");
    setBusy(true);
    setError("");
    try {
      await signIn(String(data.get("username") ?? ""), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <Lockup />
      <form className="inst gate-form" onSubmit={submit} aria-labelledby="gate-title">
        <h1 id="gate-title">{creating ? "Create your owner account" : "Unlock your ledger"}</h1>
        <p className="sub">
          {creating
            ? "This account lives only on this machine. There is no cloud sign-up and no recovery email, so keep the password somewhere safe."
            : "Your session ended. Sign in to show your figures again."}
        </p>
        <label className="field">
          <span>Username</span>
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            required
            minLength={creating ? 12 : undefined}
          />
        </label>
        {creating && (
          <label className="field">
            <span>Password again</span>
            <input name="confirm" type="password" autoComplete="new-password" required />
          </label>
        )}
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? "One moment…" : creating ? "Create account" : "Unlock"}
        </button>
      </form>
      <p className="hint">Self-hosted. No telemetry, no third-party analytics.</p>
    </main>
  );
}
