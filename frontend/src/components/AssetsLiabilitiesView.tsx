import { useState } from "react";
import { openAccountCard } from "./AccountDetail";
import { SortableCards } from "./SortableCards";
import { Building2, SlidersHorizontal } from "lucide-react";
import type { Account, Asset } from "../lib/types";
import { belongsInAssets } from "../lib/accountActions";
import type { DialogState } from "./EntryDialog";
import { Money } from "./Money";
import { Button } from "./ui/button";
import { EquitySummary } from "./PageSummaries";

export function AssetsLiabilitiesView({
  accounts,
  assets,
  onAdd,
  onAccounts,
  onTransactions,
  onOpen,
}: {
  accounts: Account[];
  assets: Asset[];
  onAdd: (state: DialogState) => void;
  onAccounts: () => void;
  onTransactions: (account: Account) => void;
  onOpen?: (account: Account) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const managed = accounts.filter(belongsInAssets);
  const visible = managed.filter(
    (account) => showArchived || !account.archived,
  );
  return (
    <>
      <EquitySummary accounts={managed} />
      <div className="section-toolbar accounts-toolbar">
        <strong>
          {managed.filter((account) => !account.archived).length} active
        </strong>
        <label className="check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
        <div className="button-row">
          <Button variant="ghost" size="sm" onClick={onAccounts}>
            View money accounts
          </Button>
        </div>
      </div>
      <SortableCards
        scope="assets"
        className="asset-grid"
        items={visible}
        itemId={(account) => String(account.id)}
        itemLabel={(account) => account.name}
        renderItem={(account, handle) => {
          const asset = assets.find((item) => item.account_id === account.id);
          const debt = account.role === "liability";
          return (
            <section
              key={account.id}
              className={`panel asset-card ${onOpen ? "account-clickable" : ""} ${account.archived ? "archived" : ""}`}
              onClick={(event) =>
                onOpen && openAccountCard(event, () => onOpen(account))
              }
            >
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">
                    {account.archived ? "Archived · " : ""}
                    {account.kind.replaceAll("_", " ")}
                  </span>
                  <h2>
                    {onOpen ? (
                      <button
                        type="button"
                        className="account-title-link"
                        title="View linked bills and payments"
                        onClick={() => onOpen(account)}
                      >
                        {account.name}
                      </button>
                    ) : (
                      account.name
                    )}
                  </h2>
                </div>
                <div className="card-tools">
                  {handle}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Manage ${account.name}`}
                    onClick={() => onAdd({ type: "editAccount", account })}
                  >
                    <SlidersHorizontal size={16} />
                  </Button>
                </div>
              </div>
              <div className="panel-body">
                <span className="hint">
                  {debt ? "Debt owed" : "Recorded value"}
                </span>
                <Money
                  value={account.balance}
                  unit={account.currency}
                  className="asset-value"
                />
                <div className="key-value">
                  <span>
                    {account.currency === "USD"
                      ? "bitcoin equivalent"
                      : "USD equivalent"}
                  </span>
                  <Money
                    value={
                      account.currency === "USD" ? account.bitcoin : account.usd
                    }
                    unit={account.currency === "USD" ? "BITCOIN" : "USD"}
                  />
                </div>
                <p className="hint">
                  Conversion quote: {account.rate_day ?? "Unavailable"}
                </p>
                {debt && (
                  <p className="hint">
                    {account.kind === "mortgage"
                      ? "Mortgages are excluded from consumer debt."
                      : account.exclude_from_consumer_debt
                        ? "Excluded from consumer debt. Included in total debt and net worth."
                        : "Included in consumer debt. Change this in Manage account."}
                  </p>
                )}
                {debt ? (
                  <Button
                    variant="outline"
                    disabled={account.archived}
                    onClick={() => onAdd({ type: "payment", account })}
                  >
                    Record payment
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled={account.archived}
                    onClick={() =>
                      onAdd(
                        asset
                          ? { type: "valuation", asset }
                          : { type: "valuation", account },
                      )
                    }
                  >
                    Update value
                  </Button>
                )}
                {!debt && (
                  <details className="asset-history">
                    <summary>
                      Valuation history
                      {asset?.history.length
                        ? ` · ${asset.history.length}`
                        : ""}
                    </summary>
                    {asset?.history.length ? (
                      <div className="mini-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th className="numeric">Total value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {asset.history.map((item) => (
                              <tr key={item.date}>
                                <td>{item.date}</td>
                                <td className="numeric">
                                  <Money
                                    value={item.value}
                                    unit={account.currency}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="hint">
                        No later valuations recorded. The recorded account value
                        is shown above. Use Update value when it changes.
                      </p>
                    )}
                  </details>
                )}
                {debt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onTransactions(account)}
                  >
                    View payment activity
                  </Button>
                )}
              </div>
            </section>
          );
        }}
      />
      {!visible.length && (
        <section className="panel empty-state">
          <Building2 size={32} />
          <h2>No active property or longer-term debts to show.</h2>
          <p>
            Add an asset or debt above. Existing wallets, banking, investments,
            and credit cards are managed in Accounts.
          </p>
          <Button variant="outline" onClick={onAccounts}>
            View accounts
          </Button>
        </section>
      )}
      <p className="below-note">
        Wallets, bank accounts, brokerage investments, and credit cards are
        managed in Accounts. All balances remain included in net worth and
        reporting.
      </p>
    </>
  );
}
