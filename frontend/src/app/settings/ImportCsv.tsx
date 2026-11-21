import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { plural } from "../lib/format";
import { Note, PAYMENT_KINDS, useAction } from "./controls";
import type { Lists } from "./controls";

/** Bring income and expenses in from a spreadsheet export. One refused row imports nothing. */
export function ImportCsv({ lists, onChanged }: { lists: Lists | null; onChanged: () => void }) {
  const action = useAction();
  const [file, setFile] = useState<File | null>(null);
  const accounts = (lists?.accounts ?? []).filter((account) => PAYMENT_KINDS.includes(account.kind));

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const account = new FormData(form).get("account_id");
    void action.run(async () => {
      if (!account) throw new Error("Choose the account these entries belong to.");
      if (!file) throw new Error("Choose a CSV file first.");
      const body = new FormData();
      body.set("account_id", String(account));
      body.set("file", file);
      const result = await api<{ imported: number; duplicates: number }>("/import/csv", "POST", body);
      form.reset();
      setFile(null);
      onChanged();
      const skipped = result.duplicates ? ` Skipped ${plural(result.duplicates, "row")} already in the ledger.` : "";
      return `Imported ${plural(result.imported, "entry").replace("entrys", "entries")}.${skipped}`;
    });
  }

  return (
    <Panel name="Import a CSV file" plain="income and expenses">
      <form className="set-form plain" onSubmit={send}>
        <label className="field">
          <span>Into account</span>
          <select name="account_id" defaultValue="" disabled={!accounts.length}>
            <option value="">{lists ? (accounts.length ? "Choose an account" : "Add an account first") : "Loading accounts…"}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency === "BITCOIN" ? "bitcoin" : "dollars"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <div className="hint">
          The first row names the columns. Required: <code>date</code>, <code>kind</code>, <code>amount</code>, <code>description</code>, <code>category</code>. Optional: <code>external_id</code>,{" "}
          <code>notes</code>. <code>kind</code> is <code>income</code> or <code>expense</code>; the category must already exist for that kind; amounts are in the account's own currency.
        </div>
        <div className="hint">UTF-8, up to 5 MB and 10,000 rows. If any row is refused, nothing is imported. Rows already imported are skipped. Transfers and bitcoin buys are recorded in Transactions.</div>
        <div className="set-actions">
          <button className="btn" disabled={action.busy || !accounts.length}>
            {action.busy ? "Importing…" : "Import"}
          </button>
        </div>
        <Note note={action.note} />
      </form>
    </Panel>
  );
}
