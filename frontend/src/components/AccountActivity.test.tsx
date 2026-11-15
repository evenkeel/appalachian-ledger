import { expect, test, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { AccountActivity, type AccountActivityData } from "./AccountActivity";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const data: AccountActivityData = {
  account_id: 1,
  currency: "USD",
  role: "asset",
  as_of: "2026-11-11",
  balance: "1164.04",
  rows: [
    {
      id: 2,
      date: "2026-11-11",
      kind: "transfer",
      description: "Payment to Prime Card",
      counterparty: "Prime Card",
      category: null,
      notes: "",
      change: "-835.96",
      change_minor: "-83596",
      balance: "1164.04",
      reverses_id: null,
      reversed: false,
    },
    {
      id: 1,
      date: "2026-11-01",
      kind: "opening",
      description: "Opening balance",
      counterparty: null,
      category: null,
      notes: "",
      change: "2000.00",
      change_minor: "200000",
      balance: "2000.00",
      reverses_id: null,
      reversed: false,
    },
  ],
};

test("account register displays card payments and opening balances with running balances", async () => {
  vi.mocked(api).mockResolvedValue(data);
  render(<AccountActivity accountId={1} revision={0} />);
  const table = await screen.findByRole("table", {
    name: "Account balance changes",
  });
  const payment = within(table).getByRole("row", {
    name: /Payment to Prime Card/,
  });
  expect(
    within(table).queryByRole("columnheader", { name: "Type" }),
  ).not.toBeInTheDocument();
  expect(payment).toHaveTextContent("−$835.96");
  expect(payment).toHaveTextContent("$1,164.04");
  expect(
    within(table).getByRole("row", { name: /Opening balance/ }),
  ).toHaveTextContent("+$2,000.00");
  expect(api).toHaveBeenCalledWith("/accounts/1/activity");
});

test("native bitcoin amounts remain exact and a refresh fetches the new account activity", async () => {
  vi.mocked(api).mockResolvedValue({
    ...data,
    currency: "BITCOIN",
    balance: "9007199254740993",
    rows: [
      {
        ...data.rows[0],
        change: "9007199254740993",
        change_minor: "9007199254740993",
        balance: "9007199254740993",
      },
    ],
  });
  const { rerender } = render(<AccountActivity accountId={1} revision={0} />);
  const table = await screen.findByRole("table", {
    name: "Account balance changes",
  });
  expect(table).toHaveTextContent("₿9,007,199,254,740,993");
  vi.mocked(api).mockResolvedValue({ ...data, role: "liability", rows: [] });
  rerender(<AccountActivity accountId={2} revision={1} />);
  await screen.findByText("No posted activity for this account.");
  expect(screen.getByText(/Balance owed/)).toBeInTheDocument();
  expect(api).toHaveBeenLastCalledWith("/accounts/2/activity");
});

test("activity request errors are visible and retryable", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValue(data);
  render(<AccountActivity accountId={1} revision={0} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Connection interrupted",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry activity" }));
  await screen.findByRole("table", { name: "Account balance changes" });
});

test("cancelled corrections are available on demand without crowding the statement", async () => {
  vi.mocked(api).mockResolvedValue({
    ...data,
    rows: [
      ...data.rows,
      {
        ...data.rows[0],
        id: 20,
        kind: "reversal",
        description: "Reversal of old paycheck",
        change: "-1720.00",
        change_minor: "-172000",
        reverses_id: 19,
      },
      {
        ...data.rows[0],
        id: 19,
        kind: "income",
        description: "Old paycheck",
        change: "1720.00",
        change_minor: "172000",
        reversed: true,
      },
    ],
  });
  render(<AccountActivity accountId={1} revision={0} />);
  const table = await screen.findByRole("table", {
    name: "Account balance changes",
  });
  expect(table).not.toHaveTextContent("Old paycheck");
  expect(table).not.toHaveTextContent("Reversal");
  const disclosure = screen.getByText("Corrections & reversals (2)");
  expect(disclosure.closest("details")).not.toHaveAttribute("open");
  fireEvent.click(disclosure);
  expect(
    screen.getByRole("table", { name: "Corrections and reversals" }),
  ).toHaveTextContent("Old paycheck");
});
