import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DebtGauge } from "./DebtGauge";
import { api } from "../lib/api";
import type { DebtGaugeData } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const empty: DebtGaugeData = {
  debt_usd: "800.00",
  limits: null,
  level: null,
  position: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ ok: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});

test("debt gauge stays uncalibrated until the user saves personal levels", async () => {
  const onSaved = vi.fn();
  render(<DebtGauge data={empty} onSaved={onSaved} />);
  expect(screen.getByRole("img")).toHaveAccessibleName(
    "Consumer debt gauge: not calibrated",
  );
  fireEvent.click(screen.getByRole("button", { name: "Set levels" }));
  fireEvent.change(screen.getByLabelText("Low · up to USD"), {
    target: { value: "100" },
  });
  fireEvent.change(screen.getByLabelText("Medium · up to USD"), {
    target: { value: "500" },
  });
  fireEvent.change(screen.getByLabelText("High · up to USD"), {
    target: { value: "1000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save levels" }));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith("Consumer debt levels saved."),
  );
  expect(api).toHaveBeenCalledWith("/debt-limits", "PUT", {
    low: "100",
    medium: "500",
    high: "1000",
  });
});

test("calibration errors leave entered amounts available for correction", async () => {
  vi.mocked(api).mockRejectedValueOnce(
    new Error("Set Low below Medium, and Medium below High"),
  );
  render(<DebtGauge data={empty} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Set levels" }));
  fireEvent.change(screen.getByLabelText("Low · up to USD"), {
    target: { value: "900" },
  });
  fireEvent.change(screen.getByLabelText("Medium · up to USD"), {
    target: { value: "500" },
  });
  fireEvent.change(screen.getByLabelText("High · up to USD"), {
    target: { value: "1000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save levels" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Low below Medium",
  );
  expect(screen.getByLabelText("Low · up to USD")).toHaveValue("900");
});

test("debt above the personal danger threshold remains visible in full", () => {
  render(
    <DebtGauge
      data={{
        debt_usd: "100000.00",
        limits: { low: "100", medium: "500", high: "1000" },
        level: "dangerous",
        position: "100.0",
      }}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByRole("img")).toHaveAccessibleName(
    "Consumer Debt Level: Dangerous",
  );
  expect(screen.getByText("$100,000.00")).toBeInTheDocument();
  expect(screen.getAllByText("Dangerous")).toHaveLength(1);
  for (const label of [
    "Consumer debt",
    "Included non-mortgage accounts",
    "Low",
    "Medium",
    "High",
  ]) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
});
