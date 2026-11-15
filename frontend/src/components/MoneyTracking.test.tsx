import { beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MoneyTracking } from "./MoneyTracking";
import { api } from "../lib/api";
import type { TrackingMonth } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
vi.mock("./TrackingChart", () => ({ TrackingChart: () => <div>Chart</div> }));
const month: TrackingMonth = {
  month: "2026-01",
  date: "2026-01-31",
  planned_usd: "100",
  spent_usd: "25",
  remaining_usd: "75",
  unbudgeted_usd: "0",
  estimated: false,
  savings_net_usd: "0",
  savings_balance_usd: "0",
  investing_net_usd: "0",
  investing_balance_usd: "0",
  bitcoin_bought: "0",
  bitcoin_paid_usd: "0",
  bitcoin_balance: "0",
  purchase_count: 0,
  average_price_usd: null,
};
const props = {
  budgetMode: true,
  month: "2026-01",
  revision: 0,
  accounts: [],
  categories: [{ id: 5, name: "Dining", kind: "expense" as const }],
  transactions: [],
  budgets: [],
  onAdd: vi.fn(),
  onSaved: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ history: [month] });
});

test("changing the reporting month hides stale totals until the new response arrives", async () => {
  let resolve!: (value: unknown) => void;
  const { rerender } = render(<MoneyTracking {...props} />);
  expect((await screen.findAllByText("$25.00"))[0]).toBeInTheDocument();
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  rerender(<MoneyTracking {...props} month="2026-02" />);
  expect(screen.queryAllByText("$25.00")).toHaveLength(0);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading tracking history",
  );
  await act(async () =>
    resolve({
      history: [
        { ...month, month: "2026-02", date: "2026-02-28", spent_usd: "40" },
      ],
    }),
  );
  expect(screen.getAllByText("$40.00")[0]).toBeInTheDocument();
});

test("category and history filters request matching data and preserve unavailable conversions", async () => {
  render(<MoneyTracking {...props} />);
  await screen.findAllByText("$25.00");
  vi.mocked(api).mockResolvedValue({
    history: [
      {
        ...month,
        planned_usd: null,
        spent_usd: null,
        remaining_usd: null,
        unbudgeted_usd: null,
      },
    ],
  });
  fireEvent.change(screen.getByLabelText("Spending category"), {
    target: { value: "5" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      "/tracking?month=2026-01&months=6&category_id=5",
    ),
  );
  expect((await screen.findAllByText("Unavailable"))[0]).toBeInTheDocument();
  expect(screen.queryAllByText("$0.00")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Chart history"), {
    target: { value: "24" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      "/tracking?month=2026-01&months=24&category_id=5",
    ),
  );
});

test("copying budgets uses the selected month and reports what was copied", async () => {
  render(<MoneyTracking {...props} />);
  await screen.findAllByText("$25.00");
  vi.mocked(api).mockResolvedValueOnce({ copied: 2, from: "2025-12" });
  fireEvent.click(screen.getByRole("button", { name: "Copy previous month" }));
  await waitFor(() =>
    expect(props.onSaved).toHaveBeenCalledWith(
      "Copied 2 budgets from 2025-12. Existing plans were kept.",
    ),
  );
  expect(api).toHaveBeenCalledWith("/budgets/copy-previous", "POST", {
    month: "2026-01",
  });
});
