import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AmountInput } from "../lib/AmountInput";
import { api } from "../../lib/api";
import { matchRule, payeeMemory, upsertRule } from "../../lib/payees";
import { accountChoices } from "./accountChoices";
import type { Anchor } from "./accountChoices";
import type { PayeeRule, Preferences } from "../../lib/types";
import type { Account, Category, Transaction } from "../../lib/types";
import { btc, usd } from "../lib/format";
import { EntryTable } from "./EntryTable";
import { Private } from "../lib/privacy";

type Kind = "expense" | "income" | "transfer" | "stack" | "sell";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "stack", label: "Bitcoin buy" },
  { kind: "income", label: "Income" },
  { kind: "transfer", label: "Transfer" },
  { kind: "sell", label: "Bitcoin sale" },
];
/** A buy, a sale and a transfer are all moves between two of your own accounts. */
const isMove = (kind: Kind) => kind === "stack" || kind === "sell" || kind === "transfer";
const clean = (value: FormDataEntryValue | null) =>
  String(value ?? "").replace(/[$₿,\s]/g, "");
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Every entry, newest first, with fast keyboard entry. Corrections never edit history. */
export function Activity({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState<Kind>("expense");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Transaction | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  // For a transfer, the list picked by hand last stays whole and the other narrows to fit it.
  const [anchor, setAnchor] = useState<Anchor>(null);
  // Saved payee rules and each category's usual account fill a new entry; anything picked by hand wins.
  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [usual, setUsual] = useState<Record<string, number>>({});
  const [categoryId, setCategoryId] = useState("");
  const [remember, setRemember] = useState(false);
  const byHand = useRef({ category: false, account: false });
  const amount = useRef<HTMLInputElement>(null);
  const description = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, accountList, categoryList, settings] = await Promise.all([
        api<Transaction[]>("/transactions"),
        api<Account[]>("/accounts"),
        api<Category[]>("/categories"),
        // Rules are a convenience; the form works without them.
        api<{ preferences: Partial<Preferences> }>("/settings").catch(() => null),
      ]);
      setRules(settings?.preferences?.payee_rules ?? []);
      setUsual(settings?.preferences?.category_payment_defaults ?? {});
      setRows(list);
      setAccounts(accountList.filter((account) => !account.archived));
      setCategories(categoryList);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Each list offers only accounts that fit this kind of entry; see accountChoices.ts for the rules.
  const {
    from,
    to,
    source: sourceAccount,
    target: targetAccount,
  } = accountChoices(kind, accounts, { from: source, to: target }, anchor, editing ? [editing.account_id, ...(editing.destination_id ? [editing.destination_id] : [])] : []);
  const crossCurrency =
    isMove(kind) &&
    sourceAccount &&
    targetAccount &&
    sourceAccount.currency !== targetAccount.currency;
  const choices = categories.filter(
    (category) => category.kind === (kind === "income" ? "income" : "expense"),
  );
  const chosenCategory = choices.find((category) => String(category.id) === categoryId) ?? choices[0];
  const learning = !editing && (kind === "expense" || kind === "income");
  const memory = useMemo(() => (learning ? payeeMemory(rows ?? [], kind) : []), [learning, rows, kind]);
  const choiceIds = useMemo(() => new Set(choices.map((category) => category.id)), [choices]);

  function useAccount(id: number | null | undefined) {
    if (id != null && !byHand.current.account && from.some((account) => account.id === id)) setSource(String(id));
  }
  /** A saved rule wins; otherwise an exact match with a past payee fills the category, account and amount. */
  function describe(text: string) {
    if (!learning || byHand.current.category) return;
    const rule = matchRule(rules, text, choiceIds);
    const known = memory.find((payee) => payee.description.toLowerCase() === text.trim().toLowerCase());
    const category = rule?.category_id ?? known?.category_id;
    if (category == null || !choiceIds.has(category)) return;
    setCategoryId(String(category));
    if (kind === "expense") useAccount(rule?.account_id ?? known?.account_id ?? usual[String(category)]);
    if (known && amount.current && !amount.current.value.trim()) amount.current.value = known.amount;
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = rows ?? [];
    return needle
      ? list.filter((row) =>
          `${row.description} ${row.category} ${row.account} ${row.destination_account ?? ""} ${row.amount}`
            .toLowerCase()
            .includes(needle),
        )
      : list;
  }, [rows, query]);

  function begin(row: Transaction) {
    setEditing(row);
    setKind(
      row.kind === "transfer"
        ? row.currency === "USD" && row.destination_currency === "BITCOIN"
          ? "stack"
          : row.currency === "BITCOIN" && row.destination_currency === "USD"
            ? "sell"
            : "transfer"
        : (row.kind as Kind),
    );
    setSource(String(row.account_id));
    setTarget(row.destination_id ? String(row.destination_id) : "");
    setCategoryId(row.category_id ? String(row.category_id) : "");
    byHand.current = { category: true, account: true };
    setRemember(false);
    setFormKey((n) => n + 1);
    setNotice("");
    window.scrollTo(0, 0);
    setTimeout(() => description.current?.focus(), 0);
  }
  function reset(keepKind = true) {
    byHand.current = { category: false, account: false };
    setCategoryId("");
    setRemember(false);
    setAnchor(null);
    setEditing(null);
    if (!keepKind) setKind("expense");
    setFormKey((n) => n + 1);
    setTimeout(() => description.current?.focus(), 0);
  }

  const fromLabel = kind === "income" ? "Into" : kind === "expense" ? "Paid from" : "From";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceAccount)
      return setError(
        kind === "transfer" && targetAccount
          ? `Nothing can be moved into ${targetAccount.name} from the accounts you have.`
          : kind === "stack"
            ? "Add a dollar account to buy from first."
            : kind === "sell"
              ? "Add a bitcoin wallet first."
              : "Add an account first.",
      );
    const form = new FormData(event.currentTarget);
    const moving = isMove(kind);
    const body: Record<string, unknown> = {
      date: form.get("date"),
      kind: moving ? "transfer" : kind,
      account_id: sourceAccount.id,
      amount: clean(form.get("amount")),
      description:
        String(form.get("description") ?? "").trim() ||
        (kind === "stack" ? "Bitcoin buy" : kind === "sell" ? "Bitcoin sale" : ""),
    };
    if (moving) {
      if (!targetAccount)
        return setError(
          kind === "stack"
            ? "Add a bitcoin wallet first."
            : kind === "sell"
              ? "Add a dollar account for the money to land in first."
              : `Nothing fits as a destination for ${sourceAccount.name}.`,
        );
      body.destination_id = targetAccount.id;
      if (crossCurrency) body.destination_amount = clean(form.get("received"));
    } else body.category_id = chosenCategory?.id;
    setBusy(true);
    setError("");
    try {
      const saved = await api<Transaction>(
        editing ? `/transactions/${editing.id}` : "/transactions",
        editing ? "PUT" : "POST",
        body,
      );
      let message = editing
        ? `Corrected “${saved.description}”. The original was reversed and replaced; nothing was edited in place.`
        : `Saved “${saved.description}”${saved.kind === "expense" && saved.currency === "USD" && !saved.purchase_cost ? ". No bitcoin price was saved for that date; it will show as missing, never guessed" : ""}.`;
      const text = String(body.description).trim();
      if (learning && remember && chosenCategory && text.length >= 2) {
        // The entry is already saved; a rule that fails to save must not undo it.
        try {
          const next = upsertRule(rules, { match: text.slice(0, 80), category_id: chosenCategory.id, account_id: kind === "expense" ? sourceAccount.id : null }, choiceIds);
          await api("/settings/payee-rules", "PUT", { payee_rules: next });
          setRules(next);
          message += ` “${text}” will be filed under ${chosenCategory.name} from now on.`;
        } catch (e) {
          message += ` The rule could not be saved: ${(e as Error).message}`;
        }
      }
      setNotice(message);
      reset();
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: Transaction) {
    setBusy(true);
    try {
      await api(`/transactions/${row.id}`, "DELETE");
      setNotice(
        `Removed “${row.description}” by reversal. The original stays in the journal.`,
      );
      setRemoving(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Keyboard: N new, / search, J and K move, E correct the selected entry.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement).closest(
        "input,select,textarea",
      );
      if (event.key === "Escape") {
        if (removing) setRemoving(null);
        else if (editing) reset();
        else (event.target as HTMLElement).blur?.();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = shown.findIndex((row) => row.id === selected);
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        reset();
      } else if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
      } else if (event.key === "j" || event.key === "J")
        setSelected(shown[Math.min(shown.length - 1, index + 1)]?.id ?? null);
      else if (event.key === "k" || event.key === "K")
        setSelected(shown[Math.max(0, index - 1)]?.id ?? null);
      else if ((event.key === "e" || event.key === "E") && index >= 0)
        begin(shown[index]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, selected, editing, removing]);

  const picked = shown.find((row) => row.id === selected);
  const amountLabel =
    kind === "stack"
      ? "Dollars paid"
      : kind === "sell"
        ? "Bitcoin sold (₿)"
        : sourceAccount?.currency === "BITCOIN"
        ? "Amount (₿)"
        : "Amount";
  return (
    <div className="page">
      <h1>Transactions</h1>
      <p className="intro">
        Every entry, newest first. Corrections never edit history: they append a
        reversal and a replacement.
      </p>
      <section
        className={`inst${editing ? " flag-advisory" : ""}`}
        aria-label={editing ? "Correct entry" : "New entry"}
      >
        <div className="inst-h">
          <span className="inst-name">
            {editing ? "Correct entry" : "New entry"}
          </span>
          <span className="inst-plain">
            {editing
              ? `replaces “${editing.description}” from ${editing.date}`
              : "type, Tab, Enter; stays open for the next one"}
          </span>
        </div>
        <div
          className="seg"
          role="group"
          aria-label="Kind of entry"
          style={{ alignSelf: "start" }}
        >
          {KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              aria-pressed={kind === item.kind}
              onClick={() => {
                setKind(item.kind);
                setAnchor(null);
                setCategoryId("");
                byHand.current.category = false;
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <form key={formKey} className="entry" onSubmit={save}>
          <label className="field">
            <span>Date</span>
            <input
              name="date"
              type="date"
              defaultValue={editing?.date ?? today()}
              max={today()}
              required
            />
          </label>
          <label className="field">
            <span>
              {kind === "income"
                ? "From"
                : kind === "expense"
                  ? "Payee or note"
                  : "Note"}
            </span>
            <input
              ref={description}
              name="description"
              defaultValue={editing?.description ?? ""}
              required={kind !== "stack" && kind !== "sell"}
              maxLength={500}
              placeholder={kind === "stack" ? "Bitcoin buy" : kind === "sell" ? "Bitcoin sale" : undefined}
              list={learning ? "known-payees" : undefined}
              onChange={(event) => describe(event.target.value)}
              autoFocus
            />
            {learning && (
              <datalist id="known-payees">
                {memory.slice(0, 40).map((payee) => (
                  <option key={payee.description} value={payee.description} />
                ))}
              </datalist>
            )}
          </label>
          {kind === "expense" || kind === "income" ? (
            <>
              <label className="field">
                <span>Category</span>
                <select
                  name="category_id"
                  value={chosenCategory ? String(chosenCategory.id) : ""}
                  onChange={(event) => {
                    byHand.current.category = true;
                    setCategoryId(event.target.value);
                    if (kind === "expense" && !editing) useAccount(usual[event.target.value]);
                  }}
                  required
                >
                  {choices.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{fromLabel}</span>
                <select
                  value={sourceAccount ? String(sourceAccount.id) : ""}
                  onChange={(event) => {
                    byHand.current.account = true;
                    setAnchor("from");
                    setSource(event.target.value);
                  }}
                >
                  {from.length === 0 && <option value="">No account fits</option>}
                  {from.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>{fromLabel}</span>
                <select
                  value={sourceAccount ? String(sourceAccount.id) : ""}
                  onChange={(event) => {
                    byHand.current.account = true;
                    setAnchor("from");
                    setSource(event.target.value);
                  }}
                >
                  {from.length === 0 && <option value="">No account fits</option>}
                  {from.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{kind === "stack" ? "Into wallet" : kind === "sell" ? "Dollars into" : "To"}</span>
                <select
                  value={targetAccount ? String(targetAccount.id) : ""}
                  onChange={(event) => {
                    setAnchor("to");
                    setTarget(event.target.value);
                  }}
                >
                  {to.length === 0 && <option value="">No account fits</option>}
                  {to.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="field">
            <span>{amountLabel}</span>
            <AmountInput
              ref={amount}
              name="amount"
              defaultValue={editing?.amount ?? ""}
              placeholder={sourceAccount?.currency === "BITCOIN" ? "0" : "0.00"}
              required
            />
          </label>
          {crossCurrency && (
            <label className="field">
              <span>
                {targetAccount!.currency === "BITCOIN"
                  ? "Bitcoin received (₿)"
                  : "Dollars received"}
              </span>
              <AmountInput
                name="received"
                defaultValue={editing?.destination_amount ?? ""}
                placeholder={
                  targetAccount!.currency === "BITCOIN" ? "0" : "0.00"
                }
                required
              />
            </label>
          )}
          <span style={{ display: "flex", gap: "8px 16px", gridColumn: "1 / -1", flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn primary" disabled={busy}>
              {editing ? "Save correction" : "Save"} <kbd>⏎</kbd>
            </button>
            {editing && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => reset()}
              >
                Cancel <kbd>Esc</kbd>
              </button>
            )}
            {learning && (
              <label className="check-line">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Always file this payee under{" "}
              {chosenCategory?.name ?? "this category"}
              </label>
            )}
          </span>
        </form>
        {kind === "transfer" && (
          <div className="hint">
            Each list shows only accounts that fit the other. Dollars move between dollar accounts and bitcoin between bitcoin accounts; buying and selling bitcoin each have their own kind.
          </div>
        )}
        {kind === "sell" && (
          <div className="hint">
            Enter the bitcoin you sold and the dollars you actually received. The price you got is worked out from those two; nothing is estimated.
          </div>
        )}
        {kind === "stack" && (
          <div className="hint">
            Enter the dollars you paid and the bitcoin you actually received. A
            buy is saving, not spending, so it never counts against a budget.
          </div>
        )}
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="sub" role="status" style={{ margin: 0 }}>
            {notice}
          </p>
        )}
        <div className="hint">
          <kbd>N</kbd> new &nbsp;<kbd>/</kbd> search &nbsp;<kbd>J</kbd>/
          <kbd>K</kbd> move &nbsp;<kbd>E</kbd> correct the selected entry
        </div>
      </section>
      <section className="inst" aria-label="Entries">
        <div className="inst-h">
          <span className="inst-name">Entries</span>
          <span className="inst-plain">
            {rows === null
              ? "loading"
              : query
                ? `${shown.length} of ${rows.length}`
                : `${rows.length} in the ledger`}
          </span>
          <label className="field" style={{ width: 220 }}>
            <span className="sr">Search entries</span>
            <input
              ref={search}
              type="search"
              placeholder="Search  /"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {rows === null ? (
          <div className="meter" style={{ width: "50%" }}>
            <i style={{ width: "100%", opacity: 0.25 }} />
          </div>
        ) : shown.length ? (
          <>
            {picked && (
              <div className="sub picked">
                <span className="nm">
                  Selected: <b>{picked.description}</b>
                </span>
                <button className="btn sm" onClick={() => begin(picked)}>
                  Correct
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => setRemoving(picked)}
                >
                  Remove
                </button>
              </div>
            )}
            <EntryTable
              rows={shown.slice(0, 300)}
              selected={selected}
              onSelect={(row) => setSelected(row.id)}
              actions={(row) => (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button
                    className="btn sm ghost"
                    onClick={() => begin(row)}
                    aria-label={`Correct ${row.description}, ${row.date}`}
                  >
                    Correct
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => setRemoving(row)}
                    aria-label={`Remove ${row.description}, ${row.date}`}
                  >
                    Remove
                  </button>
                </span>
              )}
            />
          </>
        ) : (
          <div className="sub">
            {rows.length
              ? "Nothing matches that search."
              : "Nothing recorded yet. Your first entry appears here as soon as you save it."}
          </div>
        )}
        {shown.length > 300 && (
          <div className="hint">
            Showing the newest 300. Search to narrow the list.
          </div>
        )}
      </section>
      {removing && (
        <>
          <div className="scrim" onClick={() => setRemoving(null)} />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Remove ${removing.description}`}
          >
            <h2>Remove “{removing.description}”?</h2>
            <p className="sub">
              {removing.currency === "USD"
                ? usd(removing.amount)
                : <Private>{btc(removing.amount)}</Private>}{" "}
              on {removing.date}. It is removed by a reversal entry; the
              original stays in the journal for the record.
            </p>
            <div className="acts">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void remove(removing)}
                autoFocus
              >
                Remove
              </button>
              <button className="btn ghost" onClick={() => setRemoving(null)}>
                Keep it <kbd>Esc</kbd>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
