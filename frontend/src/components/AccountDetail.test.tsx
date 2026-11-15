import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountDetail } from "./AccountDetail";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));

test("opening Prime Card shows its bills and preselects it for a new bill", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith("/activity")
      ? {
          account_id: 2,
          currency: "USD",
          role: "liability",
          as_of: "2026-11-11",
          balance: "0.00",
          rows: [],
        }
      : [
          {
            id: 1,
            account_id: 2,
            category_id: 3,
            description: "Spotify",
            notes: "",
            amount: "12.00",
            frequency: "monthly",
            next_due: "2026-11-10",
            account: "Prime Card",
            category: "Subscriptions",
            currency: "USD",
            account_archived: false,
          },
        ],
  );
  const account = {
    id: 2,
    name: "Prime Card",
    kind: "credit_card",
    role: "liability",
    archived: false,
  } as Account;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const add = vi.fn();
  const back = vi.fn();
  render(
    <AccountDetail
      account={account}
      revision={0}
      notice=""
      onDismiss={vi.fn()}
      onClose={back}
      onAdd={add}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Planned bills"));
  expect(await screen.findByText("Spotify")).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Prime Card" }),
  ).toBeInTheDocument();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(back).toHaveBeenCalledOnce();
  back.mockClear();
  expect(
    screen.getByRole("table", { name: "Bills paid with this account" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("rowheader", { name: "Spotify" }),
  ).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/recurring-bills?account_id=2");
  expect(api).toHaveBeenCalledWith(
    "/recurring-bills/reconcile?account_id=2",
    "POST",
  );
  expect(api).toHaveBeenCalledWith("/accounts/2/activity");
  expect(api).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  expect(add).toHaveBeenCalledWith({
    type: "transaction",
    kind: "expense",
    recurring: true,
    oneTime: true,
    account,
  });
  fireEvent.click(screen.getByRole("button", { name: "Close account bills" }));
  expect(back).toHaveBeenCalledOnce();
});
