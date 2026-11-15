import { ArrowRight } from "lucide-react";
import type { BudgetOverview } from "../lib/types";
import { Money } from "./Money";
import { useReportingUnit } from "../lib/monetaryLens";
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
  const unit = useReportingUnit("BITCOIN");
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
          {/* The headline follows the workspace currency; the plan itself is in dollars. */}
          <Money
            value={unit === "USD" ? b.spent_usd : b.spent_bitcoin}
            unit={unit}
            className="budget-value"
          />
          <div className="budget-plan-line">
            {unit === "USD" ? (
              <>
                spent · <Money value={b.spent_bitcoin} unit="BITCOIN" />
              </>
            ) : (
              <>
                <Money value={b.spent_usd} unit="USD" /> spent
              </>
            )}
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
                <div
                  className="progress-track"
                  role="img"
                  aria-label={`${b.percent}% of the ${b.category} budget used`}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, Number(b.percent)))}%`,
                    }}
                    className={
                      b.remaining_usd?.startsWith("-")
                        ? "over"
                        : Number(b.percent) >= 80
                          ? "near"
                          : ""
                    }
                  />
                </div>
              )}
              <div className="key-value">
                <span>
                  {b.remaining_usd?.startsWith("-") ? "Over by" : "Remaining"}
                </span>
                <Money
                  value={b.remaining_usd?.replace(/^-/, "") ?? null}
                  unit="USD"
                />
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
