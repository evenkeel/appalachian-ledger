import { useModalDialog } from "../lib/useModalDialog";
import { useRef, type MouseEvent } from "react";
import { X } from "lucide-react";
import { canMoveMoney } from "../lib/accountActions";
import type { Account } from "../lib/types";
import type { DialogState } from "./EntryDialog";
import { AccountActivity } from "./AccountActivity";
import { RecurringBills } from "./RecurringBills";
import { Button } from "./ui/button";

export function openAccountCard(
  event: MouseEvent<HTMLElement>,
  open: () => void,
) {
  if (event.defaultPrevented || !(event.target instanceof Element)) return;
  if (event.target.closest("button,a,input,select,textarea,summary,details"))
    return;
  if (window.getSelection()?.toString()) return;
  open();
}

export function AccountDetail({
  account,
  revision,
  notice,
  onDismiss,
  onClose,
  onAdd,
  onSaved,
}: {
  account: Account;
  revision: number;
  notice: string;
  onDismiss: () => void;
  onClose: () => void;
  onAdd: (state: DialogState) => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModalDialog(dialog);
  return (
    <dialog
      ref={dialog}
      className="entry-dialog account-bills-dialog"
      aria-labelledby="account-bills-title"
      onCancel={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <h2 id="account-bills-title">{account.name}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close account bills"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      {notice && (
        <div className="alert success" role="status">
          {notice}
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}
      <AccountActivity accountId={account.id} revision={revision} />
      <details className="account-planned-bills">
        <summary>Planned bills</summary>
        <RecurringBills
          key={account.id}
          accountId={account.id}
          title="Scheduled bills"
          table
          revision={revision}
          allowCreate={
            !account.archived &&
            (canMoveMoney(account) || account.kind === "credit_card")
          }
          onAdd={(state) =>
            onAdd({ ...state, account: state.account || account })
          }
          onSaved={onSaved}
        />
      </details>
    </dialog>
  );
}
