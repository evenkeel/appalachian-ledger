import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Account, Category, PayeeRule } from "../lib/types";
import { Button } from "./ui/button";

/** Saved "always file X under Y" rules; they are created from the entry form. */
export function PayeeRules({
  rules,
  categories,
  accounts,
  onRefresh,
  onNotice,
}: {
  rules: PayeeRule[];
  categories: Category[];
  accounts: Account[];
  onRefresh: () => void;
  onNotice: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove(rule: PayeeRule) {
    setBusy(true);
    setError("");
    try {
      await api("/settings/payee-rules", "PUT", {
        payee_rules: rules.filter((existing) => existing !== rule),
      });
      onRefresh();
      onNotice(`Rule for “${rule.match}” removed.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Payee rules</h2>
        <span className="hint">
          {rules.length} rule{rules.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="panel-body stack">
        <p className="hint">
          When a description contains a rule&rsquo;s text, its category (and
          account, for expenses) is filled in for you. Add a rule from any
          expense or income form with &ldquo;Always file … under …&rdquo;.
        </p>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {rules.length ? (
          <ul className="rule-list">
            {rules.map((rule) => {
              const category = categories.find(
                (c) => c.id === rule.category_id,
              );
              const account = accounts.find((a) => a.id === rule.account_id);
              return (
                <li key={`${rule.match}:${rule.category_id}`}>
                  <span>
                    <strong>{rule.match}</strong>
                    <small>
                      {category?.kind === "income" ? "Income" : "Expense"} ·{" "}
                      {category?.name ?? "Deleted category"}
                      {account ? ` · ${account.name}` : ""}
                    </small>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={`Remove rule for ${rule.match}`}
                    onClick={() => remove(rule)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-inline">No rules yet.</p>
        )}
      </div>
    </section>
  );
}
