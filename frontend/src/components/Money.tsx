import { formatMoney, unitLabel, type Denomination } from "../lib/money";
export function Money({
  value,
  unit = "BITCOIN",
  className = "",
  label = true,
}: {
  value: string | null | undefined;
  unit?: Denomination;
  className?: string;
  label?: boolean;
}) {
  return (
    <span
      className={`money ${className}`}
      aria-label={
        value != null && unit === "BITCOIN" ? `${value} bitcoin` : undefined
      }
      title={
        value == null
          ? "No exchange-rate snapshot is available for this valuation"
          : undefined
      }
    >
      {formatMoney(value, unit)}
      {label && value != null && unit === "BTC" && (
        <span className="money-unit"> {unitLabel(unit)}</span>
      )}
    </span>
  );
}
