import { ArrowRight } from "lucide-react";
import type { BudgetOverview } from "../lib/types";
import { Money } from "./Money";
import { Button } from "./ui/button";

export function BudgetCards({
  budgets,
  onEdit,
  onExpense,
}: {
  budgets: BudgetOverview[];
  onEdit: (budget: BudgetOverview) => void;
  onExpense?: (budget: BudgetOverview) => void;
}) {
  return (
    <div className="budget-grid">
      {budgets.map((b) => (
        <section className="panel budget-card" key={b.category_id}>
          <div className="budget-heading">
            <h2>{b.category}</h2>
            {b.percent !== null && (
              <span
                className={`tag ${b.remaining_usd?.startsWith("-") ? "over-budget" : ""}`}
              >
                {b.percent}% used
              </span>
            )}
          </div>
          <Money
            value={b.spent_bitcoin}
            unit="BITCOIN"
            className="budget-value"
          />
          <div className="budget-plan-line">
            <Money value={b.spent_usd} unit="USD" /> spent
            {b.planned_usd !== null && (
              <>
                {" "}
                / <Money value={b.planned_usd} unit="USD" /> budget
              </>
            )}
          </div>
          {b.planned_usd !== null && (
            <>
              {b.percent !== null && (
                <div className="progress-track">
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, Number(b.percent)))}%`,
                    }}
                    className={b.remaining_usd?.startsWith("-") ? "over" : ""}
                  />
                </div>
              )}
              <div className="key-value">
                <span>Remaining</span>
                <Money value={b.remaining_usd} unit="USD" />
              </div>
            </>
          )}
          {b.estimated && (
            <p className="hint">
              Includes today’s conversion at the current Bitcoin quote.
            </p>
          )}
          <Button variant="ghost" size="sm" onClick={() => onEdit(b)}>
            {b.planned_usd !== null ? "Edit budget" : "Set USD budget"}
            <ArrowRight size={14} />
          </Button>
          {onExpense && (
            <Button variant="outline" size="sm" onClick={() => onExpense(b)}>
              Add expense
            </Button>
          )}
        </section>
      ))}
    </div>
  );
}
