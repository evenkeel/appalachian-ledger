import { createContext, useContext, type ReactNode } from "react";
import type { Denomination } from "./money";

const LensContext = createContext<Denomination | undefined>(undefined);
export function MonetaryLensProvider({
  unit,
  children,
}: {
  unit: Denomination;
  children: ReactNode;
}) {
  return <LensContext.Provider value={unit}>{children}</LensContext.Provider>;
}
export function useReportingUnit(
  fallback: "USD" | "BITCOIN" = "BITCOIN",
): "USD" | "BITCOIN" {
  const lens = useContext(LensContext);
  return lens === undefined ? fallback : lens === "USD" ? "USD" : "BITCOIN";
}
