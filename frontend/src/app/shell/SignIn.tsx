import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Lockup } from "../design/Logo";
import { useSession } from "../lib/session";

/** First-run setup, sign-in, and starting another person's ledger. Nothing from any ledger is shown until this succeeds. */
export function SignIn() {
  const { phase, signedOut, signIn, names } = useSession();
  const first = phase === "setup";
  // Someone new to this computer asked for their own ledger.
  const [joining, setJoining] = useState(false);
  const creating = first || joining;
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const password = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const secret = String(data.get("password") ?? "");
    if (creating && secret !== data.get("confirm")) return setError("The two passwords do not match.");
    setBusy(true);
    setError("");
    try {
      await signIn(username, secret, joining);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function swap(next: boolean) {
    setJoining(next);
    setUsername("");
    setError("");
  }

  return (
    <main className="gate">
      <Lockup />
      <form className="inst gate-form" onSubmit={submit} aria-labelledby="gate-title">
        <h1 id="gate-title">
          {first
            ? "Create your owner account"
            : joining
              ? "Start your own ledger"
              : signedOut
                ? "You are logged out"
                : "Unlock your ledger"}
        </h1>
        <p className="sub">
          {first
            ? "This account lives only on this machine. There is no cloud sign-up and no recovery email, so pick a password you will remember."
            : joining
              ? "Your ledger is yours alone. Nobody else on this computer can open it, and you cannot open theirs. There is no recovery email, so pick a password you will remember."
              : signedOut
                ? "Nothing from the ledger is on screen. Sign in to open it again."
                : "Your session ended. Sign in to show your figures again."}
        </p>
        {!creating && names.length > 0 && (
          <div className="gate-names" role="group" aria-label="People who have signed in here">
            {names.map((name) => (
              <button
                type="button"
                key={name}
                className="btn"
                aria-pressed={username === name}
                onClick={() => {
                  setUsername(name);
                  password.current?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            required
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            ref={password}
            name="password"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            required
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
          {busy ? "One moment…" : creating ? "Create account" : signedOut ? "Sign in" : "Unlock"}
        </button>
        {!first && (
          <button type="button" className="gate-link" onClick={() => swap(!joining)}>
            {joining ? "Already have a ledger here? Sign in" : "New to this computer? Start your own ledger"}
          </button>
        )}
      </form>
      <p className="hint">Self-hosted. No telemetry, no third-party analytics.</p>
    </main>
  );
}
