import type { Flow } from "./types";

export function conversionNote(flows: (Flow | undefined)[]) {
  const status = flows.map((flow) => flow?.conversion_status);
  const notes = ["Saved transaction rates stay fixed."];
  if (status.some((s) => s?.dated_reference))
    notes.push(
      "Missing snapshots use available prices for the transaction date.",
    );
  if (status.some((s) => s?.current_estimate))
    notes.push(
      "Today’s conversions are estimates at the current Bitcoin quote and update with the market.",
    );
  if (status.some((s) => s?.missing))
    notes.push(
      "Some dated prices are still missing; original amounts remain visible.",
    );
  return notes.join(" ");
}
