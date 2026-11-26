import { AccountDetail, openAccountCard } from "./components/AccountDetail";
import { CardOrderProvider, SortableCards } from "./components/SortableCards";
import { PaymentDialog } from "./components/PaymentDialog";
import { AssetsLiabilitiesView } from "./components/AssetsLiabilitiesView";
import { accountAction, belongsInAssets } from "./lib/accountActions";
import { TransferDialog } from "./components/TransferDialog";
import { ExpensesView } from "./components/ExpensesView";
import { SpendingPaceCard } from "./components/SpendingPaceCard";
import { RecurringBills } from "./components/RecurringBills";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { usePriceUpdates } from "./lib/usePriceUpdates";
import {
  ArrowRight,
  ArrowLeftRight,
  BarChart3,
  Building2,
  CircleDollarSign,
  Download,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Bitcoin,
  Receipt,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Target,
  Wallet,
  X,
} from "lucide-react";
import { api, setCsrf, download } from "./lib/api";
import { type Denomination } from "./lib/money";
import type {
  Account,
  Asset,
  BudgetOverview,
  Category,
  Owner,
  Preferences,
  Rate,
  Report,
  Transaction,
} from "./lib/types";
import { Button } from "./components/ui/button";
import { Money } from "./components/Money";
import {
  CurrencyToggle,
  OverviewView,
  ReportsView,
} from "./components/FinancialViews";
import {
  EntryDialog,
  Field,
  today,
  type DialogState,
} from "./components/EntryDialog";
import { MoneyTracking, QuickEntries } from "./components/MoneyTracking";
import { TransactionTable } from "./components/TransactionTable";
import { MonetaryLensProvider } from "./lib/monetaryLens";
import { RetirementPlanner } from "./components/RetirementPlanner";
import { IncomeView } from "./components/IncomeView";
import { HoldingsDialog, HoldingsSummary } from "./components/Holdings";
import { Settings } from "./components/Settings";
import { MountainMark } from "./components/MountainMark";
import { CategoryManager } from "./components/CategoryManager";
import { Goals } from "./components/Goals";
import {
  AccountsSummary,
  TransactionsSummary,
} from "./components/PageSummaries";

const navigation = [
  { name: "Overview", icon: LayoutDashboard, group: "" },
  { name: "Accounts", icon: Wallet, group: "Money" },
  { name: "Income", icon: CircleDollarSign, group: "Money" },
  { name: "Expenses", icon: Receipt, group: "Money" },
  { name: "Transactions", icon: ScrollText, group: "Money" },
  { name: "Budgets", icon: Target, group: "Plan" },
  { name: "Stacking", icon: Bitcoin, group: "Plan" },
  { name: "Retirement", icon: Hourglass, group: "Plan" },
  { name: "Assets & liabilities", icon: Building2, group: "Wealth" },
  { name: "Reports", icon: BarChart3, group: "Wealth" },
  { name: "Settings", icon: Settings2, group: "System" },
] as const;
type Page = (typeof navigation)[number]["name"];
const pageSummary: Record<Page, string> = {
  Overview: "Where you stand today, in dollars and bitcoin.",
  Accounts: "Wallets, banking, investments, and credit cards.",
  Income: "What came in this month and where it came from.",
  Expenses: "Where the money went, and what is coming due.",
  Transactions: "Every entry in your ledger, searchable.",
  Budgets: "Planned spending against what you actually spent.",
  Stacking: "Bitcoin bought, held and planned. Bitcoin is your saving.",
  Retirement: "Hypothetical scenarios built from your own assumptions.",
  "Assets & liabilities": "Property, valued assets, and longer-term debt.",
  Reports: "Account history, cash flow, and monthly comparisons.",
  Settings: "Display, prices, payment defaults, and backups.",
};
const defaults: Preferences = {
  denomination: "USD",
  theme: "dark",
  rate_source: "manual",
};

function Brand() {
  return (
    <div className="brand">
      <img src="/mountains.svg" alt="" />
      <div>
        Appalachian <span>Bitcoin</span>
      </div>
    </div>
  );
}
export function Auth({
  initialized,
  onOwner,
  available = true,
}: {
  initialized: boolean;
  onOwner: (owner: Owner) => void;
  available?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    if (!initialized && data.get("password") !== data.get("confirm_password")) {
      setError("Passwords do not match.");
      setBusy(false);
      return;
    }
    if (!available) {
      setBusy(false);
      return;
    }
    try {
      const owner = await api<Owner>(
        initialized ? "/auth/login" : "/auth/setup",
        "POST",
        { username: data.get("username"), password: data.get("password") },
      );
      setCsrf(owner.csrf);
      onOwner(owner);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <Brand />
        <section className="auth-form panel" aria-labelledby="auth-title">
          <div className="auth-heading">
            <h1 id="auth-title">{initialized ? "Log in" : "Create account"}</h1>
            <span className="beta-badge">Beta</span>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={submit} className="stack">
            <Field label="Username">
              <input
                name="username"
                autoComplete="username"
                required
                pattern="[a-zA-Z0-9_.\-]+"
                title="Letters, numbers, dots, dashes and underscores"
                maxLength={80}
                autoFocus
              />
            </Field>
            <Field
              label="Password"
            >
              <input
                name="password"
                type="password"
                autoComplete={initialized ? "current-password" : "new-password"}
                required
                minLength={1}
                maxLength={200}
              />
            </Field>
            {!initialized && (
              <Field label="Confirm password">
                <input
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={200}
                />
              </Field>
            )}
            <Button disabled={busy || !available}>
              {busy
                ? "Opening your ledger…"
                : initialized
                  ? "Log in"
                  : "Create account"}
              <ArrowRight size={17} />
            </Button>
          </form>
        </section>
        <p className="auth-local-note">
          Your account and ledger are stored on this device.
        </p>
      </div>
    </main>
  );
}
export default function App() {
  const [status, setStatus] = useState<{
      initialized: boolean;
      demo_enabled: boolean;
    } | null>(null),
    [owner, setOwner] = useState<Owner | null>(null),
    [booting, setBooting] = useState(true);
  const [page, setPage] = useState<Page>(() => {
      // The new interface links here with ?page=Accounts and so on.
      const wanted = new URLSearchParams(window.location.search).get("page");
      return navigation.find((item) => item.name === wanted)?.name ?? "Overview";
    }),
    [prefs, setPrefs] = useState<Preferences>(defaults),
    [mobile, setMobile] = useState(false);
  const [month, setMonth] = useState(today().slice(0, 7)),
    [period, setPeriod] = useState("6"),
    [unit, setUnit] = useState<Denomination>("USD");
  const preferenceVersion = useRef(0);
  const [lensBusy, setLensBusy] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [report, setReport] = useState<Report | null>(null),
    [accounts, setAccounts] = useState<Account[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [transactions, setTransactions] = useState<Transaction[]>([]),
    [budgets, setBudgets] = useState<BudgetOverview[]>([]),
    [assets, setAssets] = useState<Asset[]>([]),
    [rates, setRates] = useState<Rate[]>([]);
  const [showArchivedAccounts, setShowArchivedAccounts] = useState(false);
  const [detailAccountId, setDetailAccountId] = useState<number | null>(null);
  const [holdingsAccount, setHoldingsAccount] = useState<Account | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [accountFilter, setAccountFilter] = useState(""),
    [currencyFilter, setCurrencyFilter] = useState(""),
    [txPeriod, setTxPeriod] = useState("month"),
    [reviewOnly, setReviewOnly] = useState(false);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const lockLedger = useCallback((message = "") => {
    preferenceVersion.current += 1;
    setLensBusy(false);
    setPreferencesReady(false);
    setCsrf("");
    setOwner(null);
    setReport(null);
    setHoldingsAccount(null);
    setAccounts([]);
    setCategories([]);
    setTransactions([]);
    setBudgets([]);
    setAssets([]);
    setRates([]);
    setDialog(null);
    setDetailAccountId(null);
    setShowArchivedAccounts(false);
    setPrefs(defaults);
    setPage("Overview");
    setMobile(false);
    setSearch("");
    setFilter("");
    setAccountFilter("");
    setCurrencyFilter("");
    setTxPeriod("month");
    setReviewOnly(false);
    setQuoteError("");
    setError("");
    setNotice(message);
    setStatus((s) => (s ? { ...s, initialized: true } : s));
  }, []);
  usePriceUpdates(Boolean(owner), prefs.rate_source, refresh);
  const hasHoldings = accounts.some((a) => a.portfolio && !a.archived);
  useEffect(() => {
    if (!owner || !hasHoldings) return;
    let alive = true,
      pending = false;
    const update = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await api<{ changed: boolean }>(
          "/investments/refresh",
          "POST",
        );
        if (alive) {
          setQuoteError("");
          if (result.changed) refresh();
        }
      } catch (e) {
        if (alive)
          setQuoteError(
            `Market quotes could not refresh: ${(e as Error).message}`,
          );
      } finally {
        pending = false;
      }
    };
    void update();
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [owner, hasHoldings, refresh]);
  useEffect(() => {
    const lock = () =>
      lockLedger("Your session expired. Please sign in again.");
    window.addEventListener("ledger:session-expired", lock);
    return () => window.removeEventListener("ledger:session-expired", lock);
  }, [lockLedger]);

  useEffect(() => {
    let alive = true;
    async function init() {
      try {
        const initial = await api<{
          initialized: boolean;
          demo_enabled: boolean;
        }>("/auth/status");
        if (!alive) return;
        setStatus(initial);
        if (initial.initialized) {
          try {
            const me = await api<Owner>("/auth/me");
            if (alive) {
              setCsrf(me.csrf);
              setOwner(me);
            }
          } catch {
            /* Locked installations show sign-in. */
          }
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBooting(false);
      }
    }
    void init();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const version = preferenceVersion.current;
    api<{ preferences: Preferences }>("/settings")
      .then((result) => {
        if (alive && version === preferenceVersion.current) {
          setPrefs(result.preferences);
          setPreferencesReady(true);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [owner, revision]);
  useEffect(() => {
    setUnit(prefs.denomination);
  }, [prefs.denomination]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([
      api<Report>(
        `/reports?month=${month}&months=${period}&denomination=${unit}`,
      ),
      api<Account[]>("/accounts"),
      api<Category[]>("/categories"),
      api<Transaction[]>("/transactions"),
      api<BudgetOverview[]>(`/budget-overview?month=${month}`),
      api<Asset[]>("/assets"),
      api<Rate[]>("/rates"),
    ])
      .then(([r, a, c, t, b, as, ra]) => {
        if (alive) {
          setReport(r);
          setAccounts(a);
          setCategories(c);
          setTransactions(t);
          setBudgets(b);
          setAssets(as);
          setRates(ra);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [owner, month, period, unit, revision]);
  async function changeMonetaryLens(denomination: Denomination) {
    if (lensBusy || !preferencesReady || denomination === unit) return;
    const version = ++preferenceVersion.current;
    setLensBusy(true);
    try {
      await api("/settings/monetary-lens", "PUT", { denomination });
      if (version === preferenceVersion.current) {
        setPrefs((previous) => ({ ...previous, denomination }));
      }
    } catch (e) {
      if (version === preferenceVersion.current)
        setError(`Could not save monetary lens: ${(e as Error).message}`);
    } finally {
      if (version === preferenceVersion.current) setLensBusy(false);
    }
  }
  function navigate(value: Page) {
    setDetailAccountId(null);
    setPage(value);
    // Each page starts at its top instead of inheriting the last scroll offset.
    document.documentElement.scrollTop = 0;
    setMobile(false);
    setNotice("");
    setError("");
  }
  async function logout() {
    try {
      await api("/auth/logout", "POST");
      lockLedger();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function demo() {
    setLoading(true);
    try {
      await api("/demo", "POST");
      setOwner((o) => (o ? { ...o, demo: true } : o));
      refresh();
      setNotice(
        "Fictional demo loaded. The person and his money are made up. The bitcoin prices are real Coinbase daily closes.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const toReview = transactions.filter((t) => t.review_reasons?.length);
  // The queue spans all dates; nothing waiting means there is no queue to show.
  const reviewing = reviewOnly && toReview.length > 0;
  async function markReviewed(rows: Transaction[]) {
    try {
      await api("/transactions/review", "POST", {
        ids: rows.map((row) => row.id),
      });
      setNotice(
        rows.length === 1
          ? `“${rows[0].description}” marked as reviewed.`
          : `${rows.length} entries marked as reviewed.`,
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const shownTransactions = (reviewing ? toReview : transactions).filter(
    (t) =>
      (!search ||
        (t.description + " " + t.notes + " " + t.account)
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!filter || t.kind === filter) &&
      (!currencyFilter ||
        t.currency === currencyFilter ||
        (t.kind === "transfer" && t.destination_currency === currencyFilter)) &&
      (!accountFilter ||
        t.account_id === Number(accountFilter) ||
        t.destination_id === Number(accountFilter)) &&
      (reviewing || txPeriod === "all" || t.date.startsWith(month)),
  );
  function openAccount(account: Account) {
    setDetailAccountId(account.id);
    setNotice("");
    setError("");
  }
  const detailAccount = accounts.find(
    (account) => account.id === detailAccountId,
  );
  const everydayAccounts = accounts.filter(
    (account) => !belongsInAssets(account),
  );
  const visibleEverydayAccounts = everydayAccounts.filter(
    (account) => showArchivedAccounts || !account.archived,
  );
  if (booting)
    return (
      <div className="loading-screen">
        <Brand />
        <span>Opening your local ledger…</span>
      </div>
    );
  if (!owner)
    return (
      <>
        {error && !status && (
          <div className="alert error" role="alert">
            Cannot reach the local API: {error}. Start the backend and reload.
          </div>
        )}
        <Auth
          initialized={status?.initialized ?? true}
          available={status !== null}
          onOwner={(o) => {
            setOwner(o);
            setStatus((s) => (s ? { ...s, initialized: true } : s));
            setError("");
          }}
        />
      </>
    );
  return (
    <MonetaryLensProvider unit={unit}>
      <CardOrderProvider
        orders={prefs.card_orders || {}}
        onSaved={(card_orders) =>
          setPrefs((previous) => ({ ...previous, card_orders }))
        }
      >
        <div className="app-shell">
          <aside className={`sidebar ${mobile ? "open" : ""}`}>
            <Brand />
            <nav aria-label="Main navigation">
              {navigation.map(({ name, icon: Icon, group }, index) => (
                <Fragment key={name}>
                  {group && navigation[index - 1].group !== group && (
                    <span className="nav-group" aria-hidden="true">
                      {group}
                    </span>
                  )}
                  <button
                    className={page === name ? "nav-item active" : "nav-item"}
                    aria-current={page === name ? "page" : undefined}
                    onClick={() => navigate(name)}
                  >
                    <Icon size={18} />
                    <span>{name}</span>
                    {name === "Transactions" && toReview.length > 0 && (
                      <span
                        className="nav-badge"
                        aria-label={`${toReview.length} to review`}
                      >
                        {toReview.length}
                      </span>
                    )}
                  </button>
                </Fragment>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="owner">
                <span className="avatar">
                  {owner.username.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  {owner.username}
                  <small>Local owner</small>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  aria-label="Sign out"
                >
                  <LogOut size={16} />
                </Button>
              </div>
            </div>
          </aside>
          {mobile && (
            <button
              className="sidebar-scrim"
              aria-label="Close navigation"
              onClick={() => setMobile(false)}
            />
          )}
          <div className="main-shell">
            <header className="topbar">
              <div className="breadcrumb">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mobile-menu"
                  aria-label="Open navigation"
                  onClick={() => setMobile(!mobile)}
                >
                  <Menu size={20} />
                </Button>
                <strong>{page}</strong>
                {owner.demo && (
                  <span className="demo-pill">Fictional demo</span>
                )}
              </div>
              <div className="topbar-right">
                <Button
                  size="sm"
                  className="topbar-add"
                  onClick={() => setDialog({ type: "transaction" })}
                >
                  <Plus size={15} />
                  Add transaction
                </Button>
                <CurrencyToggle
                  unit={unit}
                  onChange={changeMonetaryLens}
                  disabled={!preferencesReady || lensBusy}
                />
                <span className="beta-badge">Beta</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle color theme"
                  onClick={async () => {
                    const next = {
                      ...prefs,
                      theme:
                        prefs.theme === "dark"
                          ? ("light" as const)
                          : ("dark" as const),
                    };
                    try {
                      await api("/settings", "PUT", next);
                      setPrefs(next);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {prefs.theme === "dark" ? (
                    <Sun size={17} />
                  ) : (
                    <Moon size={17} />
                  )}
                </Button>
              </div>
            </header>
            <main
              className={`content${page === "Overview" ? " overview-content" : page === "Expenses" ? " expenses-content" : ""}`}
            >
              <>
                <div className="page-heading">
                  <div>
                    <h1>{page}</h1>
                    <p>{pageSummary[page]}</p>
                  </div>
                  <div className="page-actions">
                    {(
                      [
                        "Overview",
                        "Income",
                        "Transactions",
                        "Budgets",
                        "Stacking",
                        "Reports",
                      ] as Page[]
                    ).includes(page) && (
                      <label className="period-control">
                        <span className="sr-only">Reporting month</span>
                        <input
                          type="month"
                          aria-label="Reporting month"
                          value={month}
                          max={today().slice(0, 7)}
                          onChange={(e) => {
                            if (e.target.value) setMonth(e.target.value);
                          }}
                        />
                      </label>
                    )}
                    {page === "Income" ? (
                      <Button
                        onClick={() =>
                          setDialog({ type: "transaction", kind: "income" })
                        }
                      >
                        <Plus size={16} />
                        Record income
                      </Button>
                    ) : page === "Accounts" ? (
                      <Button onClick={() => setDialog({ type: "account" })}>
                        <Plus size={16} />
                        Add account
                      </Button>
                    ) : page === "Budgets" ? (
                      <Button onClick={() => setDialog({ type: "budget" })}>
                        <Plus size={16} />
                        Set budget
                      </Button>
                    ) : page === "Assets & liabilities" ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setDialog({ type: "account", accountKind: "loan" })
                          }
                        >
                          <Plus size={16} /> Add debt
                        </Button>
                        <Button
                          onClick={() =>
                            setDialog({
                              type: "account",
                              accountKind: "real_estate",
                            })
                          }
                        >
                          <Plus size={16} /> Add asset
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {notice && (
                  <div className="alert success" role="status">
                    {notice}
                    <button
                      aria-label="Dismiss notification"
                      onClick={() => setNotice("")}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                {error && (
                  <div className="alert error" role="alert">
                    {error}
                    <Button size="sm" variant="outline" onClick={refresh}>
                      Retry
                    </Button>
                  </div>
                )}
                {quoteError && (
                  <div className="alert error" role="alert">
                    {quoteError}
                  </div>
                )}
                {loading && (
                  <div className="loading-bar" aria-label="Refreshing ledger" />
                )}
                {!accounts.length && !loading && page !== "Settings" && (
                  <section className="welcome-panel">
                    <MountainMark size={56} />
                    <div>
                      <h2>Start your ledger</h2>
                      <p>
                        Everything stays on this device. Add an account and the
                        rest of the app fills in around it.
                      </p>
                    </div>
                    <ol className="welcome-steps">
                      <li>
                        <strong>
                          <b>1</b>Add an account
                        </strong>
                        A wallet, checking account or card, with today&rsquo;s
                        balance.
                      </li>
                      <li>
                        <strong>
                          <b>2</b>Record what moves
                        </strong>
                        Income, expenses and transfers take a few seconds each.
                      </li>
                      <li>
                        <strong>
                          <b>3</b>Watch the picture form
                        </strong>
                        Net worth, spending and trends in dollars and bitcoin.
                      </li>
                    </ol>
                    <div className="button-row">
                      <Button onClick={() => setDialog({ type: "account" })}>
                        <Plus size={16} />
                        Create first account
                      </Button>
                      {status?.demo_enabled && (
                        <Button
                          variant="outline"
                          onClick={demo}
                          disabled={loading}
                        >
                          Load fictional demo
                        </Button>
                      )}
                    </div>
                  </section>
                )}
                {report?.missing_rates &&
                  (page === "Reports" || page === "Overview") && (
                    <div className="alert">
                      Bitcoin exchange rate needed for{" "}
                      {report.history.at(-1)?.date ?? report.month}.
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate("Settings")}
                      >
                        Price settings
                      </Button>
                    </div>
                  )}
                {page === "Overview" && report && accounts.length > 0 && (
                  <>
                    <OverviewView
                      transactions={transactions}
                      utilities={
                        <QuickEntries onAdd={setDialog} accounts={accounts} />
                      }
                      spendingPace={
                        <SpendingPaceCard
                          month={report.month}
                          transactions={transactions}
                          onOpen={() => navigate("Expenses")}
                        />
                      }
                      expenses={
                        <RecurringBills
                          compact
                          onOpen={() => navigate("Expenses")}
                          revision={revision}
                          onAdd={setDialog}
                          onSaved={(message) => {
                            setNotice(message);
                            refresh();
                          }}
                        />
                      }
                      categories={categories}
                      report={report}
                      period={period}
                      onPeriod={setPeriod}
                      onTransactions={() => navigate("Transactions")}
                      onIncome={() => navigate("Income")}
                      onBills={() => navigate("Expenses")}
                      onSaved={(message) => {
                        setNotice(message);
                        refresh();
                      }}
                      onUnit={changeMonetaryLens}
                      loading={loading || lensBusy || !preferencesReady}
                    />
                  </>
                )}
                {page === "Expenses" && (
                  <ExpensesView
                    monetaryLens={unit}
                    revision={revision}
                    month={month}
                    onMonth={setMonth}
                    accounts={accounts}
                    categories={categories}
                    transactions={transactions}
                    onAdd={setDialog}
                    onSaved={(message) => {
                      setNotice(message);
                      refresh();
                    }}
                  />
                )}
                {page === "Income" && report && (
                  <IncomeView
                    report={report}
                    transactions={transactions}
                    onAdd={() =>
                      setDialog({ type: "transaction", kind: "income" })
                    }
                    onEdit={(transaction) =>
                      setDialog({ type: "transaction", transaction })
                    }
                    onDelete={(transaction) =>
                      setDialog({ type: "deleteTransaction", transaction })
                    }
                    onCategory={() =>
                      setDialog({ type: "category", kind: "income" })
                    }
                    onManageCategories={() =>
                      setDialog({ type: "manageCategories", kind: "income" })
                    }
                  />
                )}
                {page === "Accounts" && (
                  <>
                    <AccountsSummary accounts={everydayAccounts} />
                    <div className="section-toolbar accounts-toolbar">
                      <strong>
                        {everydayAccounts.filter((a) => !a.archived).length}{" "}
                        active accounts
                      </strong>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={showArchivedAccounts}
                          onChange={(event) =>
                            setShowArchivedAccounts(event.target.checked)
                          }
                        />
                        Show archived
                      </label>
                      <div className="button-row">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate("Assets & liabilities")}
                        >
                          View assets & debts
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ type: "rate" })}
                        >
                          Record exchange rate
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setDialog({ type: "transfer" })}
                        >
                          <ArrowLeftRight size={16} /> Transfer
                        </Button>
                      </div>
                    </div>
                    {!visibleEverydayAccounts.length && (
                      <p className="empty-inline">
                        No active money accounts to show. Add a wallet, bank,
                        brokerage, or credit card account to get started.
                      </p>
                    )}
                    <SortableCards
                      scope="accounts"
                      className="account-grid"
                      items={visibleEverydayAccounts}
                      itemId={(account) => String(account.id)}
                      itemLabel={(account) => account.name}
                      renderItem={(a, handle) => (
                        <section
                          key={a.id}
                          className={`panel account-card account-clickable holding-${a.holding_type} ${a.archived ? "archived" : ""}`}
                          onClick={(event) =>
                            openAccountCard(event, () => openAccount(a))
                          }
                        >
                          <div className="account-card-top">
                            <span className="account-symbol">
                              {a.currency === "BITCOIN" ? (
                                <MountainMark size={28} />
                              ) : a.role === "liability" ? (
                                <Building2 size={21} />
                              ) : (
                                <Wallet size={21} />
                              )}
                            </span>
                            <span className={`tag ${a.holding_type}`}>
                              {a.archived
                                ? "ARCHIVED"
                                : a.kind.replaceAll("_", " ")}
                            </span>
                            {handle}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Manage ${a.name}`}
                              onClick={() =>
                                setDialog({ type: "editAccount", account: a })
                              }
                            >
                              <SlidersHorizontal size={16} />
                            </Button>
                          </div>
                          <h2>
                            <button
                              type="button"
                              className="account-title-link"
                              title="View linked bills and payments"
                              onClick={() => openAccount(a)}
                            >
                              {a.name}
                            </button>
                          </h2>
                          {a.role === "liability" &&
                            a.kind !== "mortgage" &&
                            a.exclude_from_consumer_debt && (
                              <span className="hint">
                                Excluded from consumer debt
                              </span>
                            )}
                          <span className="hint">
                            {a.holding_type === "debt"
                              ? "Balance"
                              : a.holding_type === "valued_asset"
                                ? "Valuation"
                                : "Balance"}
                          </span>
                          <Money
                            value={a.balance}
                            unit={a.currency}
                            className="account-value"
                          />
                          <div className="key-value">
                            <span>
                              {a.currency === "USD"
                                ? "bitcoin equivalent"
                                : "USD equivalent"}
                            </span>
                            <Money
                              value={a.currency === "USD" ? a.bitcoin : a.usd}
                              unit={a.currency === "USD" ? "BITCOIN" : "USD"}
                            />
                          </div>
                          {a.currency === "USD" &&
                            ["brokerage", "stock", "etf"].includes(a.kind) && (
                              <>
                                <HoldingsSummary account={a} />
                                <Button
                                  variant="outline"
                                  disabled={a.archived}
                                  onClick={() => setHoldingsAccount(a)}
                                >
                                  {a.portfolio
                                    ? "Edit holdings & cash"
                                    : "Enter shares & ticker"}
                                </Button>
                              </>
                            )}
                          {!a.archived && accountAction(a) !== "valuation" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                accountAction(a) === "cash" && !a.portfolio
                              }
                              onClick={() =>
                                setDialog({
                                  type:
                                    accountAction(a) === "payment"
                                      ? "payment"
                                      : "transfer",
                                  account: a,
                                  cashMovement: accountAction(a) === "cash",
                                })
                              }
                            >
                              <ArrowLeftRight size={15} />{" "}
                              {accountAction(a) === "payment"
                                ? a.kind === "credit_card"
                                  ? "Make payment"
                                  : "Record payment"
                                : accountAction(a) === "cash"
                                  ? "Move cash"
                                  : "Transfer from this account"}
                            </Button>
                          )}
                          {!a.archived &&
                            accountAction(a) === "cash" &&
                            !a.portfolio && (
                              <p className="hint">
                                Set up holdings & cash to move uninvested funds.
                              </p>
                            )}
                          {!a.portfolio && (
                            <div className="account-footer">
                              <span>
                                {a.rate_day
                                  ? `Conversion quote: ${a.rate_day}`
                                  : "No conversion quote"}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={a.archived}
                                onClick={() => {
                                  const valued = assets.find(
                                    (asset) => asset.account_id === a.id,
                                  );
                                  setDialog(
                                    accountAction(a) === "valuation"
                                      ? valued
                                        ? { type: "valuation", asset: valued }
                                        : { type: "valuation", account: a }
                                      : valued
                                        ? { type: "valuation", asset: valued }
                                        : { type: "adjustment", account: a },
                                  );
                                }}
                              >
                                {accountAction(a) === "valuation"
                                  ? "Update value"
                                  : assets.some(
                                        (asset) => asset.account_id === a.id,
                                      )
                                    ? "Record valuation"
                                    : "Adjust balance"}
                                <ArrowRight size={13} />
                              </Button>
                            </div>
                          )}
                        </section>
                      )}
                    />
                  </>
                )}
                {page === "Transactions" && (
                  <>
                    {toReview.length > 0 && (
                      <div className="review-banner" role="status">
                        <span>
                          <strong>
                            {toReview.length}{" "}
                            {toReview.length === 1 ? "entry" : "entries"} to
                            review
                          </strong>
                          Imported, or filed under a catch-all category. Confirm
                          each one or give it a better category.
                        </span>
                        <div className="button-row">
                          {reviewing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markReviewed(shownTransactions)}
                              disabled={!shownTransactions.length}
                            >
                              Mark all shown as reviewed
                            </Button>
                          )}
                          <Button
                            variant={reviewing ? "outline" : "default"}
                            size="sm"
                            aria-pressed={reviewing}
                            onClick={() => setReviewOnly(!reviewing)}
                          >
                            {reviewing ? "Show all transactions" : "Review now"}
                          </Button>
                        </div>
                      </div>
                    )}
                    <TransactionsSummary rows={shownTransactions} />
                    <section className="panel">
                      <div className="panel-heading filter-bar journal-heading">
                        <h2>
                          Transaction journal{" "}
                          <span className="count">
                            {shownTransactions.length}
                          </span>
                        </h2>
                        <div className="search-field">
                          <Search size={16} />
                          <input
                            aria-label="Search transactions"
                            placeholder="Search descriptions, notes, accounts…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        <select
                          aria-label="Filter transaction type"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="">All types</option>
                          <option value="income">Income</option>
                          <option value="expense">Expenses</option>
                          <option value="transfer">Transfers</option>
                        </select>
                        <select
                          aria-label="Filter transaction currency"
                          value={currencyFilter}
                          onChange={(e) => setCurrencyFilter(e.target.value)}
                        >
                          <option value="">Both currencies</option>
                          <option value="USD">USD activity</option>
                          <option value="BITCOIN">Bitcoin activity</option>
                        </select>
                        <select
                          aria-label="Filter account"
                          value={accountFilter}
                          onChange={(e) => setAccountFilter(e.target.value)}
                        >
                          <option value="">All accounts</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Transaction date scope"
                          value={txPeriod}
                          onChange={(e) => setTxPeriod(e.target.value)}
                        >
                          <option value="month">Selected month</option>
                          <option value="all">All history</option>
                        </select>
                        <Button
                          variant="outline"
                          onClick={() => setDialog({ type: "import" })}
                        >
                          <Download size={15} />
                          Import CSV
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDialog({ type: "manageCategories" })
                          }
                        >
                          Manage categories
                          <Plus size={14} />
                        </Button>
                      </div>
                      <TransactionTable
                        rows={shownTransactions}
                        onReview={(row) => markReviewed([row])}
                        showConversions={!reviewing}
                        onRepeat={(transaction) =>
                          setDialog({
                            type: "transaction",
                            kind: "expense",
                            repeat: transaction,
                          })
                        }
                        onEdit={(t) =>
                          setDialog({ type: "transaction", transaction: t })
                        }
                        onDelete={(t) =>
                          setDialog({
                            type: "deleteTransaction",
                            transaction: t,
                          })
                        }
                      />
                    </section>
                    <p className="below-note">
                      <ShieldCheck size={14} /> Edits and deletions create
                      reversal entries. Your original records remain in the
                      audit trail.
                    </p>
                  </>
                )}
                {(page === "Budgets" || page === "Stacking") && (
                  <MoneyTracking
                    key={page}
                    budgetMode={page === "Budgets"}
                    loading={loading || report?.month !== month}
                    month={month}
                    revision={revision}
                    accounts={accounts}
                    categories={categories}
                    transactions={transactions}
                    budgets={budgets}
                    onAdd={setDialog}
                    onSaved={(message) => {
                      setNotice(message);
                      refresh();
                    }}
                  />
                )}
                {page === "Stacking" && accounts.length > 0 && (
                  <Goals
                    accounts={accounts}
                    revision={revision}
                    onSaved={(message) => {
                      setNotice(message);
                      refresh();
                    }}
                  />
                )}
                {page === "Assets & liabilities" && (
                  <AssetsLiabilitiesView
                    accounts={accounts}
                    assets={assets}
                    onAdd={setDialog}
                    onAccounts={() => navigate("Accounts")}
                    onOpen={openAccount}
                    onTransactions={(account) => {
                      setAccountFilter(String(account.id));
                      setTxPeriod("all");
                      setFilter("");
                      setSearch("");
                      setCurrencyFilter("");
                      navigate("Transactions");
                    }}
                  />
                )}
                {page === "Reports" && report && (
                  <ReportsView
                    transactions={transactions}
                    budgets={budgets}
                    report={report}
                    period={period}
                    onPeriod={setPeriod}
                    onExport={() =>
                      download("/export/journal", "ledger-journal.json").catch(
                        (e) => setError(e.message),
                      )
                    }
                  />
                )}
                {page === "Retirement" && <RetirementPlanner />}
                {page === "Settings" && (
                  <Settings
                    revision={revision}
                    preferences={prefs}
                    accounts={accounts}
                    categories={categories}
                    rates={rates}
                    onRefresh={refresh}
                    onRate={() => setDialog({ type: "rate" })}
                    onNotice={setNotice}
                    onLogout={() => lockLedger()}
                  />
                )}
              </>
            </main>
          </div>
          {detailAccount && (
            <AccountDetail
              key={detailAccount.id}
              account={detailAccount}
              revision={revision}
              notice={notice}
              onDismiss={() => setNotice("")}
              onClose={() => setDetailAccountId(null)}
              onAdd={setDialog}
              onSaved={(message) => {
                setNotice(message);
                refresh();
              }}
            />
          )}
          {holdingsAccount && (
            <HoldingsDialog
              account={holdingsAccount}
              onClose={() => setHoldingsAccount(null)}
              onSaved={() => {
                setHoldingsAccount(null);
                setNotice(
                  "Holdings saved. Market value and net worth updated.",
                );
                refresh();
              }}
            />
          )}
          {dialog?.type === "manageCategories" && (
            <CategoryManager
              categories={categories}
              initialKind={dialog.kind}
              onClose={() => setDialog(null)}
              onSaved={(message) => {
                setNotice(message);
                refresh();
              }}
            />
          )}
          {dialog?.type === "transfer" && (
            <TransferDialog
              accounts={accounts}
              initialAccount={dialog.account}
              cashMovement={dialog.cashMovement}
              onClose={() => setDialog(null)}
              onSaved={(message) => {
                setDialog(null);
                setNotice(message);
                refresh();
              }}
            />
          )}
          {dialog?.type === "payment" && dialog.account && (
            <PaymentDialog
              debt={dialog.account}
              accounts={accounts}
              categories={categories}
              onClose={() => setDialog(null)}
              onSaved={(message) => {
                setDialog(null);
                setNotice(message);
                refresh();
              }}
            />
          )}
          {dialog &&
            dialog.type !== "manageCategories" &&
            dialog.type !== "transfer" &&
            dialog.type !== "payment" && (
              <EntryDialog
                state={dialog}
                paymentDefaults={prefs.category_payment_defaults}
                history={transactions}
                payeeRules={prefs.payee_rules}
                accounts={accounts}
                categories={categories}
                month={month}
                onClose={() => setDialog(null)}
                onSaved={(message) => {
                  setDialog(null);
                  setNotice(message);
                  refresh();
                }}
                onSavedAnother={(message) => {
                  setNotice(message);
                  refresh();
                }}
              />
            )}
        </div>
      </CardOrderProvider>
    </MonetaryLensProvider>
  );
}
