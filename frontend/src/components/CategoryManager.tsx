import { useModalDialog } from "../lib/useModalDialog";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { Category, SpendingType } from "../lib/types";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Field } from "./EntryDialog";

export function CategoryManager({
  categories,
  initialKind = "expense",
  onClose,
  onSaved,
}: {
  categories: Category[];
  initialKind?: "income" | "expense";
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useModalDialog(ref);
  useEffect(() => {
    if (pending) confirmation.current?.focus();
  }, [pending]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/categories", "POST", {
        name: String(form.get("name")).trim(),
        kind: form.get("kind"),
      });
      setAdding(false);
      onSaved("Category created.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/categories/${pending.id}`, "DELETE");
      onSaved(`Category “${pending.name}” deleted.`);
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function classify(category: Category, spending_type: SpendingType) {
    setBusy(true);
    setError("");
    try {
      await api(`/categories/${category.id}/spending-type`, "PUT", {
        spending_type,
      });
      onSaved("Spending classification saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="entry-dialog category-manager"
      aria-labelledby="category-manager-title"
      onCancel={(event) => {
        event.stopPropagation();
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="category-manager-title">Manage categories</h2>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={onClose}
          aria-label="Close categories"
        >
          <X size={18} />
        </Button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="category-manager-body">
        {pending ? (
          <section
            aria-label="Confirm category deletion"
            className="category-confirm"
          >
            <h3 ref={confirmation} tabIndex={-1}>
              Delete “{pending.name}”?
            </h3>
            <div className="button-row">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setError("");
                }}
              >
                Cancel
              </Button>
              <Button variant="destructive" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete category"}
              </Button>
            </div>
          </section>
        ) : adding ? (
          <form className="stack category-create" onSubmit={create}>
            <Field label="Category name">
              <input
                name="name"
                required
                maxLength={100}
                autoFocus
                disabled={busy}
              />
            </Field>
            <Field label="Category type">
              <select name="kind" defaultValue={initialKind} disabled={busy}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </Field>
            <div className="button-row">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setAdding(false);
                  setError("");
                }}
              >
                Cancel
              </Button>
              <Button disabled={busy}>
                {busy ? "Saving…" : "Create category"}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setAdding(true);
              setError("");
            }}
          >
            <Plus size={16} />
            Add category
          </Button>
        )}
        {(
          [
            initialKind,
            initialKind === "expense" ? "income" : "expense",
          ] as const
        ).map((kind) => (
          <section
            key={kind}
            aria-label={`${kind === "income" ? "Income" : "Expense"} categories`}
            className="category-group"
          >
            <h3>{kind === "income" ? "Income" : "Expenses"}</h3>
            {categories
              .filter((category) => category.kind === kind)
              .map((category) => (
                <div className="category-manager-row" key={category.id}>
                  <span>{category.name}</span>
                  {kind === "expense" && (
                    <select
                      aria-label={`Spending type for ${category.name}`}
                      value={category.spending_type ?? "unclassified"}
                      disabled={busy || adding || pending !== null}
                      onChange={(event) =>
                        classify(category, event.target.value as SpendingType)
                      }
                    >
                      <option value="unclassified">Unclassified</option>
                      <option value="fixed">Fixed commitment</option>
                      <option value="essential">Variable essential</option>
                      <option value="discretionary">Discretionary</option>
                    </select>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || adding || pending !== null}
                    onClick={() => {
                      setPending(category);
                      setError("");
                    }}
                    aria-label={`Delete ${category.name}`}
                  >
                    <Trash2 size={14} />
                    Delete
                  </Button>
                </div>
              ))}
            {!categories.some((category) => category.kind === kind) && (
              <p className="hint">No categories yet.</p>
            )}
          </section>
        ))}
      </div>
    </dialog>
  );
}
