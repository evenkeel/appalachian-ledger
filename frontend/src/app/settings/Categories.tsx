import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { plural } from "../lib/format";
import { Note, PAYMENT_KINDS, TwoStep, useAction } from "./controls";
import type { CategoryRow, Lists, PayeeRule } from "./controls";

const TYPES: [string, string][] = [
  ["unclassified", "Not set"],
  ["fixed", "Fixed commitment"],
  ["essential", "Variable essential"],
  ["discretionary", "Discretionary"],
];
interface SavedSettings {
  preferences: { category_payment_defaults?: Record<string, number> };
}

/** The categories entries are filed under, with each expense category's type and usual account. */
export function Categories({ lists, error, reload }: { lists: Lists | null; error: string; reload: () => Promise<void> }) {
  const action = useAction();
  const run = (work: () => Promise<string>) =>
    void action.run(async () => {
      const done = await work();
      await reload();
      return done;
    });

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    run(async () => {
      if (!name) throw new Error("Give the category a name.");
      await api("/categories", "POST", { name, kind: data.get("kind") });
      form.reset();
      return `Added ${name}.`;
    });
  }
  const remove = (category: CategoryRow) =>
    run(async () => {
      await api(`/categories/${category.id}`, "DELETE");
      return `Removed ${category.name}.`;
    });
  const classify = (category: CategoryRow, spending_type: string) =>
    run(async () => {
      await api(`/categories/${category.id}/spending-type`, "PUT", { spending_type });
      return `${category.name} is now ${TYPES.find(([value]) => value === spending_type)![1].toLowerCase()}.`;
    });
  const usual = (category: CategoryRow, account: string) =>
    run(async () => {
      // The whole map is replaced on save, so start from what the server holds now.
      const fresh = (await api<SavedSettings>("/settings")).preferences.category_payment_defaults ?? {};
      const next: Record<string, number> = { ...fresh };
      if (account) next[String(category.id)] = Number(account);
      else delete next[String(category.id)];
      await api("/settings/payment-defaults", "PUT", { category_payment_defaults: next });
      const name = lists?.accounts.find((row) => row.id === Number(account))?.name;
      return name ? `${category.name} is usually paid from ${name}.` : `${category.name} has no usual account now.`;
    });

  if (!lists)
    return (
      <Panel className="c7" name="Categories" plain="what entries are filed under" inop={!error}>
        {error ? (
          <p className="set-note error" role="alert">
            {error}
          </p>
        ) : (
          <div className="sub">Loading categories…</div>
        )}
      </Panel>
    );

  const paying = lists.accounts.filter((account) => PAYMENT_KINDS.includes(account.kind));
  const group = (kind: "expense" | "income") => {
    const rows = lists.categories.filter((category) => category.kind === kind);
    return (
      <section aria-label={kind === "expense" ? "Expense categories" : "Income categories"}>
        <div className="set-sub">
          {kind === "expense" ? "Expenses" : "Income"} · {rows.length}
        </div>
        {rows.length ? (
          <ul className={`set-cats ${kind}`}>
            {rows.map((category) => {
              const saved = lists.paymentDefaults[String(category.id)];
              const gone = saved !== undefined && !paying.some((account) => account.id === saved);
              return (
                <li key={category.id}>
                  <b className="set-clip">{category.name}</b>
                  {kind === "expense" && (
                    <>
                      <select aria-label={`Spending type for ${category.name}`} value={category.spending_type ?? "unclassified"} disabled={action.busy} onChange={(event) => classify(category, event.target.value)}>
                        {TYPES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select aria-label={`Usually paid from, for ${category.name}`} value={saved ?? ""} disabled={action.busy} onChange={(event) => usual(category, event.target.value)}>
                        <option value="">No usual account</option>
                        {gone && (
                          <option value={saved} disabled>
                            Closed account
                          </option>
                        )}
                        {paying.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <TwoStep ask="Remove" confirm="Yes, remove" label={`Remove ${category.name}`} disabled={action.busy} onConfirm={() => remove(category)} />
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="sub">None yet.</div>
        )}
      </section>
    );
  };

  return (
    <Panel className="c7" name="Categories" plain="what entries are filed under">
      {group("expense")}
      {group("income")}
      <div className="hint">
        The spending type sorts expenses into fixed, essential and discretionary. The usual account is offered when you pick the category in the previous interface's entry form; the new Transactions screen does not use it yet. A category that entries, budgets or bills still use cannot be removed.
      </div>
      <Note note={action.note} />
      <form className="set-form" onSubmit={add}>
        <div className="set-pair">
          <label className="field">
            <span>New category</span>
            <input name="name" maxLength={100} placeholder="Name" />
          </label>
          <label className="field">
            <span>Kind</span>
            <select name="kind" defaultValue="expense">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
        </div>
        <div className="set-actions">
          <button className="btn" disabled={action.busy}>
            Add category
          </button>
        </div>
      </form>
    </Panel>
  );
}

/** "Always file X under Y" rules. They are made from the entry form; this is where one is removed. */
export function PayeeRules({ lists, reload }: { lists: Lists | null; reload: () => Promise<void> }) {
  const action = useAction();
  const rules = lists?.payeeRules ?? [];
  const remove = (rule: PayeeRule) =>
    void action.run(async () => {
      // Remove it from the rules the server holds now, not from the list this screen loaded.
      const fresh = (await api<{ preferences: { payee_rules?: PayeeRule[] } }>("/settings")).preferences.payee_rules ?? [];
      const kind = (id: number) => lists?.categories.find((category) => category.id === id)?.kind;
      const payee_rules = fresh.filter((other) => !(other.match === rule.match && kind(other.category_id) === kind(rule.category_id)));
      await api("/settings/payee-rules", "PUT", { payee_rules });
      await reload();
      return `Removed the rule for “${rule.match}”.`;
    });
  return (
    <Panel name="Payee rules" plain={lists ? plural(rules.length, "rule") : "filing shortcuts"} inop={lists !== null && !rules.length}>
      {rules.length ? (
        <ul className="set-list">
          {rules.map((rule) => {
            const category = lists!.categories.find((row) => row.id === rule.category_id);
            const account = lists!.accounts.find((row) => row.id === rule.account_id);
            return (
              <li key={`${rule.match}:${rule.category_id}`}>
                <span className="set-clip">
                  <b>{rule.match}</b>
                  <small>
                    {category?.kind === "income" ? "Income" : "Expense"} · {category?.name ?? "Removed category"}
                    {account ? ` · ${account.name}` : ""}
                  </small>
                </span>
                <TwoStep ask="Remove" confirm="Yes, remove" label={`Remove the rule for ${rule.match}`} disabled={action.busy} onConfirm={() => remove(rule)} />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="sub">{lists ? "No rules yet." : "Loading rules…"}</div>
      )}
      <div className="hint">When an entry's description contains a rule's text, the previous interface's entry form fills in its category and account. Rules are made there too; the new Transactions screen does not use them yet.</div>
      <Note note={action.note} />
    </Panel>
  );
}
