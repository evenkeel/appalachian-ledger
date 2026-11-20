import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import type { Account, Category, Transaction } from "../../lib/types";
import { btc, usd } from "../lib/format";
import { EntryTable } from "./EntryTable";

type Kind = "expense" | "income" | "transfer" | "stack";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "income", label: "Income" },
  { kind: "stack", label: "Bitcoin buy" },
  { kind: "transfer", label: "Transfer" },
];
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
  const description = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, accountList, categoryList] = await Promise.all([
        api<Transaction[]>("/transactions"),
        api<Account[]>("/accounts"),
        api<Category[]>("/categories"),
      ]);
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

  // Everyday dollar accounts first, so a new entry defaults to where money is actually spent from.
  const ORDER = [
    "checking",
    "credit_card",
    "cash",
    "savings",
    "bitcoin_wallet",
  ];
  const money = accounts
    .filter((account) => ORDER.includes(account.kind))
    .sort(
      (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.id - b.id,
    );
  const dollars = accounts.filter(
    (account) =>
      account.currency === "USD" &&
      account.role === "asset" &&
      ["checking", "savings", "cash"].includes(account.kind),
  );
  const wallets = accounts.filter(
    (account) =>
      account.currency === "BITCOIN" && account.kind === "bitcoin_wallet",
  );
  const from =
    kind === "stack"
      ? dollars
      : kind === "transfer"
        ? [...money, ...accounts.filter((account) => !money.includes(account))]
        : money;
  const sourceAccount =
    from.find((account) => String(account.id) === source) ?? from[0];
  const to =
    kind === "stack"
      ? wallets
      : accounts.filter((account) => account.id !== sourceAccount?.id);
  const targetAccount =
    to.find((account) => String(account.id) === target) ?? to[0];
  const crossCurrency =
    (kind === "stack" || kind === "transfer") &&
    sourceAccount &&
    targetAccount &&
    sourceAccount.currency !== targetAccount.currency;
  const choices = categories.filter(
    (category) => category.kind === (kind === "income" ? "income" : "expense"),
  );

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
          : "transfer"
        : (row.kind as Kind),
    );
    setSource(String(row.account_id));
    setTarget(row.destination_id ? String(row.destination_id) : "");
    setFormKey((n) => n + 1);
    setNotice("");
    window.scrollTo(0, 0);
    setTimeout(() => description.current?.focus(), 0);
  }
  function reset(keepKind = true) {
    setEditing(null);
    if (!keepKind) setKind("expense");
    setFormKey((n) => n + 1);
    setTimeout(() => description.current?.focus(), 0);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceAccount) return setError("Add an account first.");
    const form = new FormData(event.currentTarget);
    const moving = kind === "stack" || kind === "transfer";
    const body: Record<string, unknown> = {
      date: form.get("date"),
      kind: moving ? "transfer" : kind,
      account_id: sourceAccount.id,
      amount: clean(form.get("amount")),
      description:
        String(form.get("description") ?? "").trim() ||
        (kind === "stack" ? "Bitcoin buy" : ""),
    };
    if (moving) {
      if (!targetAccount)
        return setError(
          kind === "stack"
            ? "Add a bitcoin wallet first."
            : "Choose where the money went.",
        );
      body.destination_id = targetAccount.id;
      if (crossCurrency) body.destination_amount = clean(form.get("received"));
    } else body.category_id = Number(form.get("category_id"));
    setBusy(true);
    setError("");
    try {
      const saved = await api<Transaction>(
        editing ? `/transactions/${editing.id}` : "/transactions",
        editing ? "PUT" : "POST",
        body,
      );
      setNotice(
        editing
          ? `Corrected “${saved.description}”. The original was reversed and replaced; nothing was edited in place.`
          : `Saved “${saved.description}”${saved.kind === "expense" && saved.currency === "USD" && !saved.purchase_cost ? ". No bitcoin price was saved for that date; it will show as missing, never guessed" : ""}.`,
      );
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
              onClick={() => setKind(item.kind)}
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
              required={kind !== "stack"}
              maxLength={500}
              placeholder={kind === "stack" ? "Bitcoin buy" : undefined}
              autoFocus
            />
          </label>
          {kind === "expense" || kind === "income" ? (
            <label className="field">
              <span>Category</span>
              <select
                name="category_id"
                defaultValue={editing?.category_id ?? undefined}
                required
              >
                {choices.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>{kind === "stack" ? "Into wallet" : "To"}</span>
              <select
                value={targetAccount ? String(targetAccount.id) : ""}
                onChange={(event) => setTarget(event.target.value)}
              >
                {to.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>
              {kind === "income"
                ? "Into"
                : kind === "expense"
                  ? "Paid from"
                  : "From"}
            </span>
            <select
              value={sourceAccount ? String(sourceAccount.id) : ""}
              onChange={(event) => setSource(event.target.value)}
            >
              {from.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{amountLabel}</span>
            <input
              name="amount"
              className="num"
              inputMode="decimal"
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
              <input
                name="received"
                className="num"
                inputMode="decimal"
                defaultValue={editing?.destination_amount ?? ""}
                placeholder={
                  targetAccount!.currency === "BITCOIN" ? "0" : "0.00"
                }
                required
              />
            </label>
          )}
          <span style={{ display: "flex", gap: 8 }}>
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
          </span>
        </form>
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
                : btc(removing.amount)}{" "}
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
