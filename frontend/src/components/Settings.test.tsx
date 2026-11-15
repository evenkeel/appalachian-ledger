import { expect, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Settings } from "./Settings";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
vi.mock("../lib/api", () => ({
  api: vi.fn().mockResolvedValue([]),
  download: vi.fn(),
  setCsrf: vi.fn(),
}));

test("settings saves category payment methods and lets the owner remove a default", async () => {
  const onRefresh = vi.fn();
  const card = {
    id: 7,
    name: "Gemini Card",
    kind: "credit_card",
    currency: "USD",
    archived: false,
  } as Account;
  const { unmount } = render(
    <Settings
      preferences={{
        theme: "dark",
        denomination: "USD",
        rate_source: "manual",
      }}
      accounts={[card, { ...card, id: 8, name: "Old Card", archived: true }]}
      categories={[
        { id: 5, name: "Groceries", kind: "expense" },
        { id: 6, name: "Salary", kind: "income" },
      ]}
      rates={[]}
      onRefresh={onRefresh}
      onRate={vi.fn()}
      onNotice={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  const selector = screen.getByLabelText("Groceries");
  expect(within(selector).queryByText(/Old Card/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Salary")).not.toBeInTheDocument();
  fireEvent.change(selector, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save payment defaults" }),
  );
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith("/settings/payment-defaults", "PUT", {
    category_payment_defaults: { "5": 7 },
  });
  unmount();
  render(
    <Settings
      preferences={{
        theme: "dark",
        denomination: "USD",
        rate_source: "manual",
        category_payment_defaults: { "5": 7 },
      }}
      accounts={[card]}
      categories={[{ id: 5, name: "Groceries", kind: "expense" }]}
      rates={[]}
      onRefresh={onRefresh}
      onRate={vi.fn()}
      onNotice={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Groceries")).toHaveValue("7");
  fireEvent.change(screen.getByLabelText("Groceries"), {
    target: { value: "" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save payment defaults" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/settings/payment-defaults", "PUT", {
      category_payment_defaults: {},
    }),
  );
});
