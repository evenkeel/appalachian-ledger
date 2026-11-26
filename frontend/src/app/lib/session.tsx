import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, setCsrf } from "../../lib/api";
import type { Preferences } from "../../lib/types";

export type Lens = "USD" | "BITCOIN";
export type Theme = "night" | "day";
interface Owner {
  username: string;
  csrf: string;
  /** Present on /auth/me; the sign-up and sign-in replies leave it out. */
  preferences?: Partial<Preferences>;
  demo?: boolean;
}
type Phase = "booting" | "offline" | "setup" | "locked" | "ready";

interface Session {
  phase: Phase;
  /** The owner pressed Log out, rather than the session running out. */
  signedOut: boolean;
  username: string;
  demo: boolean;
  demoEnabled: boolean;
  error: string;
  theme: Theme;
  lens: Lens;
  setTheme: (theme: Theme) => void;
  setLens: (lens: Lens) => void;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
}

const Context = createContext<Session | null>(null);
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("useSession needs a SessionProvider");
  return value;
}

const themeOf = (stored: Preferences["theme"] | undefined): Theme => (stored === "light" ? "day" : "night");
// The legacy BTC reporting unit maps to whole bitcoin here.
const lensOf = (stored: Preferences["denomination"] | undefined): Lens => (stored === "USD" || !stored ? "USD" : "BITCOIN");

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("booting");
  const [owner, setOwner] = useState<Owner | null>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [error, setError] = useState("");
  const [theme, setThemeState] = useState<Theme>("night");
  const [lens, setLensState] = useState<Lens>("USD");
  const [attempt, setAttempt] = useState(0);
  const [signedOut, setSignedOut] = useState(false);

  const adopt = useCallback((me: Owner) => {
    setCsrf(me.csrf);
    setOwner(me);
    setSignedOut(false);
    setThemeState(themeOf(me.preferences?.theme));
    setLensState(lensOf(me.preferences?.denomination));
    setPhase("ready");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await api<{ initialized: boolean; demo_enabled: boolean }>("/auth/status");
        if (!alive) return;
        setDemoEnabled(status.demo_enabled);
        if (!status.initialized) return setPhase("setup");
        try {
          const me = await api<Owner>("/auth/me");
          if (alive) adopt(me);
        } catch {
          if (alive) setPhase("locked");
        }
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        setPhase("offline");
      }
    })();
    return () => {
      alive = false;
    };
  }, [adopt, attempt]);

  // An expired session blanks the screen rather than leaving figures on display.
  useEffect(() => {
    const lock = () => {
      setOwner(null);
      setPhase("locked");
    };
    window.addEventListener("ledger:session-expired", lock);
    return () => window.removeEventListener("ledger:session-expired", lock);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo<Session>(
    () => ({
      phase,
      signedOut,
      username: owner?.username ?? "",
      demo: owner?.demo ?? false,
      demoEnabled,
      error,
      theme,
      lens,
      setTheme(next) {
        const previous = theme;
        setThemeState(next);
        // Read the saved settings first so a theme change never resubmits stale price settings.
        api<{ preferences: Preferences }>("/settings")
          .then(({ preferences }) =>
            api("/settings", "PUT", { ...preferences, theme: next === "day" ? "light" : "dark" }),
          )
          .catch(() => setThemeState(previous));
      },
      setLens(next) {
        const previous = lens;
        setLensState(next);
        api("/settings/monetary-lens", "PUT", { denomination: next }).catch(() => setLensState(previous));
      },
      async signIn(username, password) {
        adopt(await api<Owner>(phase === "setup" ? "/auth/setup" : "/auth/login", "POST", { username, password }));
      },
      async signOut() {
        try {
          await api("/auth/logout", "POST");
        } finally {
          setCsrf("");
          setOwner(null);
          setSignedOut(true);
          setPhase("locked");
        }
      },
      retry() {
        setError("");
        setPhase("booting");
        setAttempt((n) => n + 1);
      },
    }),
    [phase, signedOut, owner, demoEnabled, error, theme, lens, adopt],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
