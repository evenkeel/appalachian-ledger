import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CategoryManager } from "./CategoryManager";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const categories = [
  { id: 20, name: "Underwriting", kind: "income" as const },
  { id: 21, name: "Dining", kind: "expense" as const },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ ok: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});

test("income categories can be deleted with explicit confirmation", async () => {
  const onSaved = vi.fn();
  render(
    <CategoryManager
      categories={categories}
      onSaved={onSaved}
      onClose={vi.fn()}
      initialKind="income"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete Underwriting" }));
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith("Category “Underwriting” deleted."),
  );
  expect(api).toHaveBeenCalledWith("/categories/20", "DELETE");
});

test("cancel preserves the category and blocked deletion explains why", async () => {
  const onSaved = vi.fn();
  render(
    <CategoryManager
      categories={categories}
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete Dining" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api).not.toHaveBeenCalled();
  vi.mocked(api).mockRejectedValueOnce(
    new Error("This category is used by transactions and cannot be deleted."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete Dining" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "used by transactions",
  );
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByText("Dining")).toBeInTheDocument();
});

test("income entry point defaults creation to income", async () => {
  const onSaved = vi.fn();
  render(
    <CategoryManager
      categories={categories}
      onSaved={onSaved}
      onClose={vi.fn()}
      initialKind="income"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add category" }));
  expect(screen.getByLabelText("Category type")).toHaveValue("income");
  fireEvent.change(screen.getByLabelText("Category name"), {
    target: { value: "Consulting" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create category" }));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith("Category created."),
  );
  expect(api).toHaveBeenCalledWith("/categories", "POST", {
    name: "Consulting",
    kind: "income",
  });
});

test("classification saves the selected spending type and refreshes the categories", async () => {
  const onSaved = vi.fn();
  const { rerender } = render(
    <CategoryManager
      categories={categories}
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Spending type for Dining"), {
    target: { value: "discretionary" },
  });
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith("Spending classification saved."),
  );
  expect(api).toHaveBeenCalledWith("/categories/21/spending-type", "PUT", {
    spending_type: "discretionary",
  });
  rerender(
    <CategoryManager
      categories={categories.map((c) =>
        c.id === 21 ? { ...c, spending_type: "discretionary" } : c,
      )}
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Spending type for Dining")).toHaveValue(
    "discretionary",
  );
});

test("a failed classification keeps the original selection and shows the server error", async () => {
  vi.mocked(api).mockRejectedValueOnce(
    new Error("Restart the ledger with the latest code"),
  );
  const onSaved = vi.fn();
  render(
    <CategoryManager
      categories={categories}
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Spending type for Dining"), {
    target: { value: "fixed" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Restart the ledger",
  );
  expect(screen.getByLabelText("Spending type for Dining")).toHaveValue(
    "unclassified",
  );
  expect(onSaved).not.toHaveBeenCalled();
});
