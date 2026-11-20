import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, transactions } from "../test/fixture";

const calls: { path: string; method: string; body?: unknown }[] = [];
const accounts = [
  // A bitcoin wallet created first must not become the default place an expense is paid from.
  { id: 1, name: "Spending wallet", kind: "bitcoin_wallet", role: "asset", currency: "BITCOIN", archived: false },
  { id: 3, name: "Everyday checking", kind: "checking", role: "asset", currency: "USD", archived: false },
  { id: 8, name: "Ridgeline Visa", kind: "credit_card", role: "liability", currency: "USD", archived: false },
  { id: 5, name: "Cold storage", kind: "bitcoin_wallet", role: "asset", currency: "BITCOIN", archived: false },
  { id: 6, name: "Old account", kind: "checking", role: "asset", currency: "USD", archived: true },
];
vi.mock("../../lib/api", () => ({
  api: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path === "/transactions" && method === "GET") return transactions;
    if (path === "/accounts") return accounts;
    if (path === "/categories") return categories;
    return { ...transactions[0], ...(body as object), description: (body as { description?: string })?.description ?? "x", purchase_cost: null };
  }),
}));

import { Activity } from "./Activity";

const show = async () => {
  render(<Activity />);
  await screen.findByText("7 in the ledger");
};
const form = () => screen.getByLabelText("New entry");
const set = (label: string | RegExp, value: string) => fireEvent.change(within(form()).getByLabelText(label), { target: { value } });
const writes = () => calls.filter((call) => call.method !== "GET");

beforeEach(() => {
  calls.length = 0;
  window.scrollTo = vi.fn();
});

describe("transactions", () => {
  it("records an expense with the exact amount typed and keeps the form open", async () => {
    await show();
    set("Payee or note", "Mountain Market");
    set("Amount", "$1,042.18");
    set("Date", "2026-11-18");
    fireEvent.click(within(form()).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/transactions",
      method: "POST",
      body: { date: "2026-11-18", kind: "expense", account_id: 3, amount: "1042.18", description: "Mountain Market", category_id: 2 },
    });
    // No price was saved for that date: say so, and never guess one later.
    expect(await screen.findByRole("status")).toHaveTextContent("No bitcoin price was saved");
    expect(within(form()).getByLabelText("Payee or note")).toHaveValue("");
  });

  it("records a bitcoin buy as a transfer with the bitcoin actually received", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Bitcoin buy" }));
    set("Dollars paid", "400");
    set("Bitcoin received (₿)", "₿334,300");
    fireEvent.click(within(form()).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ kind: "transfer", account_id: 3, destination_id: 1, amount: "400", destination_amount: "334300", description: "Bitcoin buy" });
    expect(writes()[0].body).not.toHaveProperty("category_id");
  });

  it("never offers an archived account", async () => {
    await show();
    const paidFrom = within(form()).getByLabelText("Paid from");
    expect(within(paidFrom).queryByText("Old account")).toBeNull();
    expect(within(paidFrom).getByText("Ridgeline Visa")).toBeInTheDocument();
  });

  it("corrects an entry by replacing it, not editing it", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Correct Groceries 21, 2026-11-03" }));
    const correcting = screen.getByLabelText("Correct entry");
    expect(within(correcting).getByLabelText("Amount")).toHaveValue("91.80");
    fireEvent.change(within(correcting).getByLabelText("Amount"), { target: { value: "95.00" } });
    fireEvent.click(within(correcting).getByRole("button", { name: /^Save correction/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ path: "/transactions/21", method: "PUT", body: { amount: "95.00", date: "2026-11-03", category_id: 2 } });
    expect(await screen.findByRole("status")).toHaveTextContent("The original was reversed and replaced");
  });

  it("removes an entry only after a confirm step", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Remove Dining 20, 2026-11-02" }));
    expect(writes()).toHaveLength(0);
    const sheet = screen.getByRole("dialog", { name: "Remove Dining 20" });
    expect(sheet).toHaveTextContent("removed by a reversal entry");
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(writes()).toEqual([{ path: "/transactions/20", method: "DELETE", body: undefined }]));
  });

  it("searches, and moves and corrects with the keyboard", async () => {
    await show();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dining" } });
    expect(screen.getByText("2 of 7")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "e" });
    expect(screen.getByLabelText("Correct entry")).toHaveTextContent("replaces “Dining 20”");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByLabelText("New entry")).toBeInTheDocument();
  });

  it("marks an expense with no saved price as missing", async () => {
    await show();
    expect(screen.queryByText("no price saved")).toBeNull();
    expect(screen.getAllByText("₿77,300").length).toBeGreaterThan(0);
  });
});
