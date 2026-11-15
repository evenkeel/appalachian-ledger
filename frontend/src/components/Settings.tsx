import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Download, ShieldCheck, Server, LockKeyhole } from "lucide-react";
import { api, download, setCsrf } from "../lib/api";
import type {
  Account,
  Audit,
  Category,
  Owner,
  Preferences,
  Rate,
} from "../lib/types";
import { isPaymentAccount } from "../lib/accountActions";
import { Button } from "./ui/button";
import { Field, today } from "./EntryDialog";
import { Money } from "./Money";
import { PriceSettings } from "./PriceSettings";
interface NodeStatus {
  connected: boolean;
  message?: string;
  chain?: string;
  blocks?: number;
  headers?: number;
  sync_progress?: string;
  initial_block_download?: boolean;
}
interface Wallet {
  id: number;
  account_id: number;
  wallet: string;
  last_checked: string | null;
}
interface Reconciliation {
  balance_bitcoin: string;
  pending_bitcoin: string;
  ledger_balance: string;
  difference: string;
  transactions: {
    key: string;
    txid: string;
    bitcoin: string;
    confirmations: number;
    already_recorded: boolean;
  }[];
  checked_at: string;
  history_limit: number;
}
export function Settings({
  preferences,
  accounts,
  categories,
  rates,
  onRefresh,
  onRate,
  onNotice,
  onLogout,
}: {
  preferences: Preferences;
  accounts: Account[];
  categories: Category[];
  rates: Rate[];
  onRefresh: () => void;
  onRate: () => void;
  onNotice: (text: string) => void;
  onLogout: () => void;
}) {
  const [prefs, setPrefs] = useState(preferences),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [node, setNode] = useState<NodeStatus | null>(null),
    [wallets, setWallets] = useState<Wallet[]>([]),
    [reconciliation, setReconciliation] = useState<Reconciliation | null>(null),
    [audit, setAudit] = useState<Audit[]>([]);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [paymentDefaults, setPaymentDefaults] = useState(
    preferences.category_payment_defaults || {},
  );
  useEffect(() => {
    setPrefs(preferences);
    setPaymentDefaults(preferences.category_payment_defaults || {});
  }, [preferences]);
  useEffect(() => {
    api<Audit[]>("/audit")
      .then(setAudit)
      .catch(() => {});
    api<Wallet[]>("/node/wallets")
      .then(setWallets)
      .catch(() => {});
  }, []);
  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api("/settings", "PUT", prefs);
      onRefresh();
      onNotice("Preferences saved.");
    });
  }
  async function exportBackup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await run(() =>
      download("/backup", `ledger-${today()}.albackup`, {
        passphrase: String(data.get("passphrase")),
      }),
    );
  }
  async function restoreBackup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await run(async () => {
      await api("/restore", "POST", data);
      onLogout();
      onNotice(
        "Backup restored and verified. Sign in with the restored owner credentials.",
      );
    });
  }
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    await run(async () => {
      const result = await api<Owner>("/auth/password", "POST", {
        current_password: data.get("current_password"),
        new_password: data.get("new_password"),
      });
      setCsrf(result.csrf);
      form.reset();
      onNotice("Password changed. Other sessions were revoked.");
    });
  }
  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await run(async () => {
      await api("/node/wallets", "POST", {
        account_id: Number(data.get("account_id")),
        wallet: data.get("wallet"),
      });
      setWallets(await api("/node/wallets"));
      onNotice("Watch-only wallet connected.");
    });
  }
  return (
    <div className="settings-layout">
      {error && (
        <div className="alert error full-width" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Display & pricing</h2>
          <span className="tag">LOCAL PREFERENCES</span>
        </div>
        <form onSubmit={save} className="panel-body stack">
          <Field
            label="Default reporting currency"
            hint="Saved by the workspace currency switch. Controls estimated values and trend charts; original records keep their own currency."
          >
            <select
              value={prefs.denomination}
              onChange={(e) =>
                setPrefs({
                  ...prefs,
                  denomination: e.target.value as Preferences["denomination"],
                })
              }
            >
              <option value="USD">US dollars · USD</option>
              <option value="BITCOIN">bitcoin · whole base units</option>
              <option value="BTC">BTC · legacy equivalent</option>
            </select>
          </Field>
          <p className="hint">
            ₿1 is one whole bitcoin base unit (also called a satoshi). Legacy
            BTC equals ₿100,000,000. Historical spending uses each transaction’s
            dated reference; missing prices stay unavailable.
          </p>
          <Field label="Appearance">
            <select
              value={prefs.theme}
              onChange={(e) =>
                setPrefs({
                  ...prefs,
                  theme: e.target.value as "dark" | "light",
                })
              }
            >
              <option value="dark">Blue Ridge dark</option>
              <option value="light">Mountain mist light</option>
            </select>
          </Field>
          <Button disabled={busy}>Save preferences</Button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Default payment methods</h2>
        </div>
        <form
          className="panel-body stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/settings/payment-defaults", "PUT", {
                category_payment_defaults: paymentDefaults,
              });
              onRefresh();
              onNotice("Default payment methods saved.");
            });
          }}
        >
          <p className="hint">
            Choose the account to suggest when you select an expense category,
            such as Gemini Card for Groceries. You can change it for each
            expense. Existing transactions and saved bills keep their accounts.
          </p>
          {categories
            .filter((category) => category.kind === "expense")
            .map((category) => {
              const selected = accounts.find(
                (account) => account.id === paymentDefaults[category.id],
              );
              return (
                <Field key={category.id} label={category.name}>
                  <select
                    value={paymentDefaults[category.id] || ""}
                    onChange={(e) => {
                      const next = { ...paymentDefaults };
                      if (e.target.value)
                        next[category.id] = Number(e.target.value);
                      else delete next[category.id];
                      setPaymentDefaults(next);
                    }}
                  >
                    <option value="">No default</option>
                    {selected && !isPaymentAccount(selected) && (
                      <option value={selected.id} disabled>
                        {selected.name} · unavailable
                      </option>
                    )}
                    {accounts.filter(isPaymentAccount).map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ·{" "}
                        {account.currency === "BITCOIN" ? "bitcoin" : "USD"}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
          <Button disabled={busy}>Save payment defaults</Button>
        </form>
      </section>
      <PriceSettings
        preferences={preferences}
        rates={rates}
        onRefresh={onRefresh}
        onRate={onRate}
        onNotice={onNotice}
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>
            <ShieldCheck size={17} /> Data ownership
          </h2>
          <span className="tag">NO CLOUD REQUIRED</span>
        </div>
        <div className="panel-body stack">
          <p className="hint">
            Export original transaction amounts or the complete journal,
            including reversals and equity entries.
          </p>
          <div className="button-row">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => download("/export/csv", "ledger-transactions.csv"))
              }
            >
              <Download size={15} />
              Transactions CSV
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => download("/export/journal", "ledger-journal.json"))
              }
            >
              <Download size={15} />
              Complete journal
            </Button>
          </div>
          <hr />
          <form onSubmit={exportBackup} className="stack">
            <h3>Encrypted database backup</h3>
            <Field
              label="Backup passphrase"
              hint="At least 12 characters. Keep it somewhere safe; it cannot be recovered."
            >
              <input
                name="passphrase"
                type="password"
                minLength={12}
                maxLength={200}
                required
                autoComplete="new-password"
              />
            </Field>
            <Button disabled={busy}>
              <LockKeyhole size={15} />
              Download encrypted backup
            </Button>
          </form>
          <details>
            <summary>Restore an encrypted backup</summary>
            <form onSubmit={restoreBackup} className="stack restore-form">
              <p className="hint">
                Restore replaces this database after schema, integrity, and
                journal checks. Export a backup first. All sessions will be
                signed out.
              </p>
              <Field label="Backup file">
                <input type="file" name="file" accept=".albackup" required />
              </Field>
              <Field label="Backup passphrase">
                <input
                  name="passphrase"
                  type="password"
                  minLength={12}
                  required
                  autoComplete="off"
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={restoreConfirm}
                  onChange={(e) => setRestoreConfirm(e.target.checked)}
                />
                Replace my current ledger with this backup
              </label>
              <Button variant="destructive" disabled={busy || !restoreConfirm}>
                Verify and restore
              </Button>
            </form>
          </details>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            <Server size={17} /> Bitcoin Core
          </h2>
          <span className="tag">READ ONLY</span>
        </div>
        <div className="panel-body stack">
          <p className="hint">
            Configure BITCOIN_RPC_HOST, PORT, USER and PASSWORD in your
            protected environment. Only wallets with private keys disabled are
            accepted. Credentials never enter this browser or the database.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(async () => setNode(await api("/node/status")))}
          >
            Check node connection
          </Button>
          {node && (
            <div className={`alert ${node.connected ? "success" : ""}`}>
              {node.connected
                ? `${node.chain} · ${node.blocks?.toLocaleString()} / ${node.headers?.toLocaleString()} blocks · ${node.initial_block_download ? "syncing" : "synchronized"}`
                : node.message}
            </div>
          )}
          <form onSubmit={connect} className="stack">
            <Field label="Bitcoin ledger account">
              <select name="account_id" required>
                <option value="">Select account</option>
                {accounts
                  .filter(
                    (a) =>
                      a.currency === "BITCOIN" &&
                      a.role === "asset" &&
                      !a.archived,
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Existing watch-only wallet name">
              <input
                name="wallet"
                required
                placeholder="ledger-watch"
                maxLength={120}
              />
            </Field>
            <Button variant="outline" disabled={busy}>
              Connect watch-only wallet
            </Button>
          </form>
          {wallets.map((w) => (
            <div className="wallet-row" key={w.id}>
              <span>{w.wallet}</span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () =>
                    setReconciliation(
                      await api(`/node/wallets/${w.id}/reconcile`),
                    ),
                  )
                }
              >
                Reconcile
              </Button>
            </div>
          ))}
          {reconciliation && (
            <div className="stack">
              <div className="key-value">
                <span>Node confirmed balance</span>
                <Money value={reconciliation.balance_bitcoin} />
              </div>
              <div className="key-value">
                <span>Ledger balance</span>
                <Money value={reconciliation.ledger_balance} />
              </div>
              <div className="key-value">
                <span>Difference</span>
                <Money value={reconciliation.difference} />
              </div>
              <p className="hint">
                Latest {reconciliation.history_limit} wallet entries,
                deduplicated. Pending:{" "}
                <Money value={reconciliation.pending_bitcoin} />. Review and
                record ledger entries manually; automatic ingestion is not
                enabled.
              </p>
              <div className="mini-table">
                <table>
                  <thead>
                    <tr>
                      <th>Transaction ID</th>
                      <th>bitcoin</th>
                      <th>Confirmations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.transactions.slice(0, 20).map((tx) => (
                      <tr key={tx.key}>
                        <td title={tx.txid}>{tx.txid.slice(0, 12)}…</td>
                        <td>
                          <Money value={tx.bitcoin} label={false} />
                        </td>
                        <td>{tx.confirmations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Local authentication</h2>
          <LockKeyhole size={17} />
        </div>
        <form className="panel-body stack" onSubmit={password}>
          <p className="hint">
            One local owner. Passwords are hashed with Argon2id; sessions expire
            after 12 hours.
          </p>
          <Field label="Current password">
            <input
              type="password"
              name="current_password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              name="new_password"
              minLength={12}
              maxLength={200}
              autoComplete="new-password"
              required
            />
          </Field>
          <Button variant="outline" disabled={busy}>
            Change password
          </Button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Audit trail</h2>
          <span className="tag">APPEND ONLY</span>
        </div>
        <div className="audit-list">
          {audit.slice(0, 20).map((row) => (
            <details key={row.id}>
              <summary>
                <span>{row.action}</span>
                <small>{new Date(row.created_at).toLocaleString()}</small>
              </summary>
              <pre>{JSON.stringify(row.detail, null, 2)}</pre>
            </details>
          ))}
          {!audit.length && <p className="hint">No audit events to display.</p>}
        </div>
      </section>
    </div>
  );
}
