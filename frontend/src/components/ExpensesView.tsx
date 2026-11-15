import { HistoricalSpending } from "./HistoricalSpending";
import { CostHistory } from "./CostHistory";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Account, Category, Transaction } from "../lib/types";
import type { Denomination } from "../lib/money";
import type { DialogState } from "./EntryDialog";
import { RecurringBills } from "./RecurringBills";
import { TransactionTable } from "./TransactionTable";
import { Button } from "./ui/button";
import { SpendingAnalysis } from "./SpendingAnalysis";

export function ExpensesView({
  revision,
  monetaryLens,
  month,
  onMonth,
  accounts,
  categories,
  transactions,
  onAdd,
  onSaved,
}: {
  revision: number;
  monetaryLens?: Denomination;
  month: string;
  onMonth?: (month: string) => void;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  onAdd: (state: DialogState) => void;
  onSaved: (message: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showCosts, setShowCosts] = useState(false);
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("month");
  const [showConversions, setShowConversions] = useState(false);
  const rows = transactions.filter(
    (row) =>
      row.kind === "expense" &&
      (scope === "all" || row.date.startsWith(month)) &&
      (!account || row.account_id === Number(account)) &&
      (!category || row.category_id === Number(category)) &&
      (!search ||
        `${row.description} ${row.notes} ${row.account} ${row.category}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  return (
    <div className="expenses-workspace">
      <SpendingAnalysis
        monetaryLens={monetaryLens}
        month={month}
        onMonth={onMonth}
        accounts={accounts}
        categories={categories}
        transactions={transactions}
        onAdd={onAdd}
        actions={
          <Button
            onClick={() => onAdd({ type: "transaction", kind: "expense" })}
          >
            <Plus size={16} /> Add expense
          </Button>
        }
      />
      <details
        className="panel"
        onToggle={(event) => setShowHistory(event.currentTarget.open)}
      >
        <summary>Historical Spending · annual and custom ranges</summary>
        {showHistory && (
          <HistoricalSpending
            accounts={accounts}
            categories={categories}
            revision={revision}
          />
        )}
      </details>
      <div className="expense-supporting">
        <RecurringBills
          calendar
          allowCreate={false}
          revision={revision}
          onAdd={onAdd}
          onSaved={onSaved}
        />
        <details className="panel expense-records">
          <summary>
            Recorded Expenses <span className="count">{rows.length}</span>
          </summary>
          <div className="expense-records-content">
            <div className="filter-bar">
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search expenses"
                  placeholder="Search expenses…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <select
                aria-label="Expense account"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              >
                <option value="">All accounts</option>
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Expense category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">All categories</option>
                {categories
                  .filter((item) => item.kind === "expense")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Expense date scope"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="month">Selected month</option>
                <option value="all">All history</option>
              </select>
            </div>
            <section className="expense-records-body">
              <div className="panel-heading">
                <h2>
                  Expense History <span className="count">{rows.length}</span>
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={showConversions}
                  onClick={() => setShowConversions(!showConversions)}
                >
                  {showConversions ? "Hide conversions" : "Show conversions"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onAdd({ type: "manageCategories", kind: "expense" })
                  }
                >
                  Manage categories <Plus size={14} />
                </Button>
              </div>
              {rows.length ? (
                <TransactionTable
                  rows={rows}
                  showConversions={showConversions}
                  onRepeat={(transaction) =>
                    onAdd({
                      type: "transaction",
                      kind: "expense",
                      repeat: transaction,
                    })
                  }
                  onEdit={(transaction) =>
                    onAdd({ type: "transaction", transaction })
                  }
                  onDelete={(transaction) =>
                    onAdd({ type: "deleteTransaction", transaction })
                  }
                />
              ) : (
                <div className="empty-inline">
                  No recorded expenses match these filters. Add an expense or
                  confirm an upcoming payment to build your history.
                </div>
              )}
            </section>
          </div>
        </details>
        <details
          className="panel expense-costs"
          onToggle={(event) => setShowCosts(event.currentTarget.open)}
        >
          <summary>Cost History</summary>
          {showCosts && (
            <CostHistory revision={revision} categories={categories} />
          )}
        </details>
      </div>
    </div>
  );
}
