import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlertDrawer, AlertsButton, Lights, formatValue } from "./Alerts";
import type { Alert, AlertsData } from "./Alerts";

const lights = [
  { id: "overdue", label: "Bill overdue" },
  { id: "cash", label: "Cash short" },
  { id: "util", label: "Credit use" },
  { id: "conv", label: "Missing price" },
];
const util: Alert = {
  id: "util",
  level: "caution",
  magnitude: "68.8",
  acknowledged: false,
  panel: "debt",
  title: "Ridgeline Visa is at 69% of its limit",
  why: "A balance this high costs interest.",
  facts: [
    { label: "Balance", value: "4128.00", unit: "USD" },
    { label: "Used", value: "68.8", unit: "percent" },
  ],
  rows: [],
  advice: { text: "Pay {value} to get back under your 30% line.", value: "2328.00", unit: "USD" },
  action: { label: "Plan a payment", route: "accounts" },
};
const overdue: Alert = {
  id: "overdue",
  level: "warning",
  magnitude: "3",
  acknowledged: false,
  panel: "bills",
  title: "Car registration was due Nov 16",
  why: "3 days past due.",
  facts: [],
  rows: [{ name: "Car registration", note: "3 days late", value: "86.00", unit: "USD" }],
  advice: null,
  action: { label: "Pay it now", bill_id: 12 },
};
const data: AlertsData = { lights, active: [util, overdue] };
const noop = () => {};

describe("alert lights", () => {
  it("formats figures by unit, exactly", () => {
    expect(formatValue({ value: "2328.00", unit: "USD" })).toBe("$2,328.00");
    expect(formatValue({ value: "672400", unit: "BITCOIN" })).toBe("₿672,400");
    expect(formatValue({ value: "68.8", unit: "percent" })).toBe("69%");
    expect(formatValue({ value: "1", unit: "days" })).toBe("1 day");
  });

  it("keeps every light in place and carries level in words, not colour alone", () => {
    render(<Lights data={data} onOpen={noop} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("listitem", { name: /^caution: Credit use/ })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /^warning: Bill overdue/ })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Cash short: normal" })).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
  });

  it("says all normal when nothing is lit", () => {
    render(<Lights data={{ lights, active: [] }} onOpen={noop} />);
    expect(screen.getByText("All normal")).toBeInTheDocument();
  });

  it("lights the top-bar button for the worst unacknowledged level only", () => {
    const { rerender } = render(<AlertsButton data={data} onOpen={noop} />);
    expect(screen.getByRole("button", { name: "Warnings. 2 unacknowledged." })).toBeInTheDocument();
    rerender(<AlertsButton data={{ lights, active: [util, { ...overdue, acknowledged: true }] }} onOpen={noop} />);
    expect(screen.getByRole("button", { name: "Cautions. 1 unacknowledged." })).toBeInTheDocument();
    rerender(<AlertsButton data={{ lights, active: [{ ...util, acknowledged: true }] }} onOpen={noop} />);
    expect(screen.getByRole("button", { name: "1 acknowledged. 0 unacknowledged." })).toBeInTheDocument();
    rerender(<AlertsButton data={{ lights, active: [{ ...util, level: "advisory" }] }} onOpen={noop} />);
    expect(screen.getByRole("button", { name: "No alerts. 0 unacknowledged." })).toBeInTheDocument();
  });

  it("opens one alert's own detail with its figures and one action", () => {
    const onRoute = vi.fn(),
      onAcknowledge = vi.fn();
    render(<AlertDrawer data={data} open="util" onOpen={noop} onClose={noop} onAcknowledge={onAcknowledge} onRoute={onRoute} onPayBill={noop} />);
    const drawer = screen.getByRole("dialog", { name: "Credit use" });
    expect(within(drawer).getByText("$4,128.00")).toBeInTheDocument();
    expect(within(drawer).getByText("$2,328.00")).toBeInTheDocument();
    expect(within(drawer).queryByText("Car registration was due Nov 16")).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: /Plan a payment/ }));
    expect(onRoute).toHaveBeenCalledWith("accounts");
    fireEvent.click(within(drawer).getByRole("button", { name: "Acknowledge" }));
    expect(onAcknowledge).toHaveBeenCalledWith("util");
    // The other active alert is one click away, not mixed in.
    expect(within(drawer).getByRole("button", { name: "Bill overdue" })).toBeInTheDocument();
  });

  it("offers to pay the overdue bill straight from its alert", () => {
    const onPayBill = vi.fn();
    render(<AlertDrawer data={data} open="overdue" onOpen={noop} onClose={noop} onAcknowledge={noop} onRoute={noop} onPayBill={onPayBill} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay it now" }));
    expect(onPayBill).toHaveBeenCalledWith(12);
  });

  it("lists every alert, worst first", () => {
    render(<AlertDrawer data={data} open="" onOpen={noop} onClose={noop} onAcknowledge={noop} onRoute={noop} onPayBill={noop} />);
    const rows = within(screen.getByRole("dialog", { name: "All alerts · 2 active" })).getAllByText("Details →");
    expect(rows).toHaveLength(2);
    expect(rows[0].closest("button")).toHaveTextContent("Car registration");
  });
});
