import { beforeEach, expect, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CostHistory } from "./CostHistory";
import { RecurringBills } from "./RecurringBills";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const data = {
  months: [
    {
      month: "2026-02",
      payments: 1,
      usd: "22.00",
      bitcoin: "20000",
      change_usd: "10.00",
      change_bitcoin: "0.00",
      missing_usd: 0,
      missing_bitcoin: 0,
    },
    {
      month: "2026-01",
      payments: 1,
      usd: "20.00",
      bitcoin: "20000",
      change_usd: null,
      change_bitcoin: null,
      missing_usd: 0,
      missing_bitcoin: 0,
    },
  ],
  payments: [
    {
      id: 1,
      date: "2026-02-05",
      recorded_at: "2026-02-08T12:00:00Z",
      description: "HBO Max",
      account: "Prime Card",
      usd: "22.00",
      bitcoin: "20000",
      rate: "110000",
      source: "Coinbase",
      method: "daily_close",
      quote_at: "2026-02-06T00:00:00Z",
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue(data);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
test("bill cost history shows dollar price changes and saved bitcoin costs with provenance", async () => {
  render(<CostHistory revision={0} billId={2} />);
  const table = await screen.findByRole("table", {
    name: "Monthly cost history",
  });
  expect(within(table).getByText("$20.00")).toBeInTheDocument();
  expect(within(table).getByText("$22.00")).toBeInTheDocument();
  expect(within(table).getByText("10.00%")).toBeInTheDocument();
  expect(within(table).getByText("0.00%")).toBeInTheDocument();
  expect(screen.getByText(/Coinbase/)).toBeInTheDocument();
  expect(screen.getByText(/2026-02-06T00:00:00Z/)).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/expense-costs?bill_id=2");
});
test("monthly expenses can be filtered by category or description and missing equivalents remain unavailable", async () => {
  vi.mocked(api).mockResolvedValue({
    ...data,
    months: [
      {
        ...data.months[0],
        bitcoin: null,
        missing_bitcoin: 1,
        change_bitcoin: null,
      },
    ],
  });
  render(
    <CostHistory
      revision={0}
      categories={[{ id: 3, name: "Groceries", kind: "expense" }]}
    />,
  );
  expect(await screen.findByText("1 missing reference")).toBeInTheDocument();
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Cost history category"), {
    target: { value: "3" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/expense-costs?category_id=3"),
  );
  fireEvent.change(screen.getByLabelText("Search cost history"), {
    target: { value: "HBO" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/expense-costs?category_id=3&search=HBO"),
  );
});
test("bill history opens a modal using the bill identity", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/recurring-bills")
      ? [
          {
            id: 2,
            description: "HBO",
            amount: "22.00",
            frequency: "monthly",
            next_due: "2026-11-10",
            account: "Prime Card",
            currency: "USD",
            account_archived: false,
          },
        ]
      : data,
  );
  render(<RecurringBills revision={0} onAdd={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Cost history for HBO" }),
  );
  expect(
    screen.getByRole("dialog", { name: "HBO · cost history" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("table", { name: "Monthly cost history" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close cost history" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
test("cost history failures can be retried", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Offline"));
  render(<CostHistory revision={0} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("table", { name: "Monthly cost history" }),
  ).toBeInTheDocument();
});
