import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  Bitcoin,
  Copy,
  Plus,
  PiggyBank,
  TrendingUp,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  Account,
  BudgetOverview,
  Category,
  TrackingMonth,
  Transaction,
} from "../lib/types";
import { Money } from "./Money";
import { BudgetCards } from "./BudgetCards";
import { Button } from "./ui/button";
import type { DialogState } from "./EntryDialog";
import { TrackingChart, type TrackingSeries } from "./TrackingChart";
import { TransactionTable } from "./TransactionTable";

export function QuickEntries({
  onAdd,
  accounts,
}: {
  onAdd: (state: DialogState) => void;
  /** When given, savings and investing shortcuts appear only if such accounts exist. */
  accounts?: Account[];
}) {
  const has = (kinds: string[]) =>
    !accounts || accounts.some((a) => !a.archived && kinds.includes(a.kind));
  return (
    <div className="quick-entries" aria-label="Quick entries">
      <Button onClick={() => onAdd({ type: "transaction", intent: "bitcoin" })}>
        <Bitcoin size={17} /> Bitcoin buy
      </Button>
      <Button
        variant="outline"
        onClick={() => onAdd({ type: "transaction", kind: "expense" })}
      >
        <ArrowDownLeft size={17} /> Add expense
      </Button>
      <Button variant="outline" onClick={() => onAdd({ type: "transfer" })}>
        <ArrowLeftRight size={17} /> Transfer
      </Button>
      {has(["savings"]) && (
        <Button
          variant="outline"
          onClick={() => onAdd({ type: "transaction", intent: "savings" })}
        >
          <PiggyBank size={17} /> Move to savings
        </Button>
      )}
      {has(["brokerage", "stock", "etf"]) && (
        <Button
          variant="outline"
          onClick={() => onAdd({ type: "transaction", intent: "investing" })}
        >
          <TrendingUp size={17} /> Add investment funds
        </Button>
      )}
    </div>
  );
}

const labels = {
  bitcoin: "Bitcoin buys",
  savings: "Savings",
  investing: "Investing",
};
type View = keyof typeof labels;
const isGroup = (account: Account, view: View) =>
  account.role === "asset" &&
  (view === "bitcoin"
    ? account.currency === "BITCOIN"
    : view === "savings"
      ? account.kind === "savings"
      : account.kind !== "savings" &&
        (account.currency === "BITCOIN" ||
          ["brokerage", "stock", "etf"].includes(account.kind)));

export function MoneyTracking({
  budgetMode = false,
  loading = false,
  month,
  revision,
  accounts,
  categories,
  transactions,
  budgets,
  onAdd,
  onSaved,
}: {
  budgetMode?: boolean;
  loading?: boolean;
  month: string;
  revision: number;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: BudgetOverview[];
  onAdd: (state: DialogState) => void;
  onSaved: (message: string) => void;
}) {
  const [view, setView] = useState<View>("bitcoin");
  const [period, setPeriod] = useState("6");
  const [category, setCategory] = useState("");
  useEffect(() => {
    if (category && !categories.some((item) => item.id === Number(category)))
      setCategory("");
  }, [categories, category]);
  const [account, setAccount] = useState("");
  const [result, setResult] = useState<{
    key: string;
    history: TrackingMonth[];
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [copying, setCopying] = useState(false);
  const params = new URLSearchParams({ month, months: period });
  if (budgetMode && category) params.set("category_id", category);
  if (!budgetMode && account) params.set("account_id", account);
  const query = params.toString();
  const requestKey = `${query}:${revision}:${retry}`;
  useEffect(() => {
    let alive = true;
    setError("");
    api<{ history: TrackingMonth[] }>(`/tracking?${query}`)
      .then((data) => {
        if (alive) setResult({ key: requestKey, history: data.history });
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [query, requestKey]);
  const history = result?.key === requestKey ? result.history : [];
  const selected = history.at(-1);
  const groupAccounts = accounts.filter((a) => isGroup(a, view));
  const groupIds = new Set(
    groupAccounts
      .filter((a) => !account || a.id === Number(account))
      .map((a) => a.id),
  );
  const activity = transactions.filter(
    (t) =>
      t.date.startsWith(month) &&
      (budgetMode
        ? t.kind === "expense" &&
          (!category || t.category_id === Number(category))
        : view === "bitcoin"
          ? t.kind === "transfer" &&
            t.currency === "USD" &&
            t.destination_currency === "BITCOIN" &&
            accounts.some((a) => a.id === t.account_id && a.role === "asset") &&
            groupIds.has(t.destination_id!)
          : groupIds.has(t.account_id) || groupIds.has(t.destination_id!)),
  );
  const cards: {
    label: string;
    value: string | null;
    unit?: "USD" | "BITCOIN";
    detail: string;
  }[] = !selected
    ? []
    : budgetMode
      ? [
          {
            label: "Monthly plan",
            value: selected.planned_usd,
            detail: "USD category allowances",
          },
          {
            label: "Spent this month",
            value: selected.spent_usd,
            detail: "Recorded expenses, including unbudgeted spending",
          },
          {
            label: "Plan minus spending",
            value: selected.remaining_usd,
            detail: "Negative means spending exceeds the plan",
          },
          {
            label: "Without a budget",
            value: selected.unbudgeted_usd,
            detail: "Spending in categories with no USD allowance",
          },
        ]
      : view === "bitcoin"
        ? [
            {
              label: "Bitcoin bought",
              value: selected.bitcoin_bought,
              unit: "BITCOIN",
              detail: `${selected.purchase_count} purchase${selected.purchase_count === 1 ? "" : "s"} this month`,
            },
            {
              label: "Dollars exchanged",
              value: selected.bitcoin_paid_usd,
              detail: "Actual USD sent for purchases this month",
            },
            {
              label: "Average purchase price",
              value: selected.average_price_usd,
              detail: "USD per ₿100,000,000",
            },
            {
              label: "Bitcoin held",
              value: selected.bitcoin_balance,
              unit: "BITCOIN",
              detail: `Recorded balance as of ${selected.date}`,
            },
          ]
        : [
            {
              label: "Net transfers this month",
              value: selected[`${view}_net_usd`],
              detail: "Transfers in minus transfers out",
            },
            {
              label:
                view === "savings" ? "Savings balance" : "Investment value",
              value: selected[`${view}_balance_usd`],
              detail: `Recorded value in USD as of ${selected.date}`,
            },
          ];
  const primary: TrackingSeries[] = budgetMode
    ? [
        { key: "spent_usd", label: "Spending", color: "var(--accent)" },
        {
          key: "planned_usd",
          label: "Budget",
          color: "var(--blue)",
          line: true,
        },
      ]
    : view === "bitcoin"
      ? [
          {
            key: "bitcoin_bought",
            label: "Bitcoin bought",
            color: "var(--accent)",
          },
        ]
      : [
          {
            key: `${view}_net_usd`,
            label: "Net transfers",
            color: "var(--blue)",
          },
        ];
  const secondary: TrackingSeries[] =
    view === "bitcoin"
      ? [
          {
            key: "bitcoin_paid_usd",
            label: "Dollars exchanged",
            color: "var(--blue)",
          },
        ]
      : [
          {
            key: `${view}_balance_usd`,
            label: "Recorded balance",
            color: "var(--amethyst)",
            line: true,
          },
        ];
  async function copyPrevious() {
    setCopying(true);
    try {
      const copied = await api<{ copied: number; from: string }>(
        "/budgets/copy-previous",
        "POST",
        { month },
      );
      onSaved(
        copied.copied
          ? `Copied ${copied.copied} budget${copied.copied === 1 ? "" : "s"} from ${copied.from}. Existing plans were kept.`
          : `No additional USD budgets to copy from ${copied.from}. Existing plans were kept.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCopying(false);
    }
  }
  return (
    <div className="money-tracking">
      <QuickEntries onAdd={onAdd} accounts={accounts} />
      <section className="panel tracking-controls">
        {!budgetMode && (
          <div
            className="tracking-tabs"
            role="group"
            aria-label="Tracking view"
          >
            {(Object.keys(labels) as View[]).map((key) => (
              <button
                key={key}
                aria-pressed={view === key}
                onClick={() => {
                  setView(key);
                  setAccount("");
                }}
              >
                {labels[key]}
              </button>
            ))}
          </div>
        )}
        <div className="tracking-filters">
          <label className="field">
            <span>{budgetMode ? "Spending category" : "Account"}</span>
            {budgetMode ? (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All expense categories</option>
                {categories
                  .filter((c) => c.kind === "expense")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            ) : (
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">
                  All {view === "bitcoin" ? "bitcoin" : view} accounts
                </option>
                {groupAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="field">
            <span>Chart history</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {[3, 6, 12, 24].map((n) => (
                <option key={n} value={n}>
                  {n} months
                </option>
              ))}
            </select>
          </label>
          {budgetMode && (
            <Button variant="outline" disabled={copying} onClick={copyPrevious}>
              <Copy size={16} />
              {copying ? "Copying…" : "Copy previous month"}
            </Button>
          )}
        </div>
      </section>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </Button>
        </div>
      )}
      {!selected && !error && <p role="status">Loading tracking history…</p>}
      {selected && (
        <>
          <p className="hint">
            {month} ·{" "}
            {selected.date.slice(8) !==
            new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0)
              .getDate()
              .toString()
              ? "Month to date"
              : "Month end"}
          </p>
          <div className="tracking-stats">
            {cards.map((card) => (
              <section className="panel tracking-stat" key={card.label}>
                <span>{card.label}</span>
                <Money value={card.value} unit={card.unit || "USD"} />
                <small>{card.detail}</small>
              </section>
            ))}
          </div>
          {(budgetMode || view !== "bitcoin") &&
            history.some((row) => row.estimated) && (
              <p className="hint" role="status">
                Some activity uses today’s current-quote estimate. Missing
                conversions remain unavailable.
              </p>
            )}
          <div className={`tracking-charts ${budgetMode ? "single" : ""}`}>
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  {budgetMode
                    ? "Spending vs. budget"
                    : view === "bitcoin"
                      ? "Bitcoin buys each month"
                      : "Monthly net transfers"}
                </h2>
                <span className="hint">
                  {!budgetMode && view === "bitcoin"
                    ? "Native bitcoin units"
                    : "USD"}
                </span>
              </div>
              <div className="tracking-legend">
                {primary.map((s) => (
                  <span key={s.key}>
                    <i style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
              <TrackingChart
                rows={history}
                series={primary}
                unit={!budgetMode && view === "bitcoin" ? "BITCOIN" : "USD"}
                title={
                  budgetMode
                    ? "Monthly spending compared with budget"
                    : `${labels[view]} monthly activity`
                }
              />
            </section>
            {!budgetMode && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    {view === "bitcoin"
                      ? "Dollars exchanged each month"
                      : "Balance over time"}
                  </h2>
                  <span className="hint">USD</span>
                </div>
                <TrackingChart
                  rows={history}
                  series={secondary}
                  title={
                    view === "bitcoin"
                      ? "Monthly dollar cost of bitcoin buys"
                      : `${labels[view]} recorded balance history`
                  }
                />
              </section>
            )}
          </div>
          <p className="hint tracking-explanation">
            {budgetMode
              ? "Budget totals include USD plans only. Spending includes every expense in the selected categories. Missing conversion rates appear as gaps, not zero."
              : view === "bitcoin"
                ? "Purchases are USD-to-bitcoin transfers. Moving bitcoin between your wallets is not a purchase. Average price covers this month’s purchases and excludes separately recorded fees; it is not the cost basis of your current holdings."
                : "Net transfers show funding less withdrawals, excluding transfers within the selected group. Balances also include opening balances, income, expenses, adjustments, and recorded valuations. They are not investment returns. Historical bitcoin values require a month-end price; current values use an available current quote."}
          </p>
          {!budgetMode && !groupAccounts.length && (
            <div className="alert">
              Add{" "}
              {view === "bitcoin"
                ? "a bitcoin wallet"
                : view === "savings"
                  ? "a savings account"
                  : "a brokerage, stock, ETF or bitcoin account"}{" "}
              to start tracking.
              <Button
                variant="outline"
                onClick={() =>
                  onAdd({
                    type: "account",
                    accountKind:
                      view === "bitcoin"
                        ? "bitcoin_wallet"
                        : view === "savings"
                          ? "savings"
                          : "brokerage",
                  })
                }
              >
                Add account
              </Button>
            </div>
          )}
          <details className="panel tracking-history">
            <summary>Monthly figures · {history.length} months</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    {primary.map((s) => (
                      <th key={s.key} className="numeric">
                        {s.label}
                      </th>
                    ))}
                    {!budgetMode && (
                      <th className="numeric">
                        {view === "bitcoin" ? "USD exchanged" : "Balance · USD"}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.month}>
                      <th scope="row">{row.month}</th>
                      {primary.map((s) => (
                        <td key={s.key} className="numeric">
                          <Money
                            value={row[s.key]}
                            unit={
                              !budgetMode && view === "bitcoin"
                                ? "BITCOIN"
                                : "USD"
                            }
                          />
                        </td>
                      ))}
                      {!budgetMode && (
                        <td className="numeric">
                          <Money value={row[secondary[0].key]} unit="USD" />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {budgetMode && !loading && (
        <>
          <div className="section-toolbar">
            <h2>Category budgets</h2>
            <div className="button-row">
              <Button
                variant="outline"
                onClick={() => onAdd({ type: "manageCategories" })}
              >
                Manage categories
              </Button>
              <Button
                variant="ghost"
                onClick={() => onAdd({ type: "category", kind: "expense" })}
              >
                <Plus size={16} />
                Add category
              </Button>
            </div>
          </div>
          <BudgetCards
            budgets={budgets.filter(
              (b) => !category || b.category_id === Number(category),
            )}
            onEdit={(budget) => onAdd({ type: "budget", budget })}
            onExpense={(budget) =>
              onAdd({
                type: "transaction",
                kind: "expense",
                category_id: budget.category_id,
              })
            }
          />
          {!budgets.length && (
            <div className="panel empty-inline">
              Start with a monthly allowance or record an expense to see its
              category here.
              <Button onClick={() => onAdd({ type: "budget" })}>
                Set your first budget
              </Button>
            </div>
          )}
        </>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>
            {budgetMode ? "Expenses" : "Activity"} · {month}
          </h2>
          <span className="count">{activity.length}</span>
        </div>
        {loading ? (
          <p className="empty-inline" role="status">
            Refreshing activity…
          </p>
        ) : (
          <TransactionTable
            rows={activity}
            onEdit={(transaction) =>
              onAdd({ type: "transaction", transaction })
            }
            onDelete={(transaction) =>
              onAdd({ type: "deleteTransaction", transaction })
            }
          />
        )}
      </section>
    </div>
  );
}
