import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CardOrderProvider, SortableCards, orderCards } from "./SortableCards";
import { api } from "../lib/api";
import type { CardOrders } from "../lib/types";
vi.mock("../lib/api", () => ({ api: vi.fn() }));
const cards = [
  { id: "1", name: "Condo" },
  { id: "2", name: "Loan" },
  { id: "3", name: "Car" },
];
function Board({
  orders = {},
  items = cards,
  saved = vi.fn(),
}: {
  orders?: CardOrders;
  items?: typeof cards;
  saved?: (orders: CardOrders) => void;
}) {
  return (
    <CardOrderProvider orders={orders} onSaved={saved}>
      <SortableCards
        scope="assets"
        className="asset-grid"
        items={items}
        itemId={(item) => item.id}
        itemLabel={(item) => item.name}
        renderItem={(item, handle) => (
          <section className="panel">
            <h2>{item.name}</h2>
            {handle}
          </section>
        )}
      />
    </CardOrderProvider>
  );
}
const names = () =>
  screen.getAllByRole("heading").map((element) => element.textContent);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (_path, _method, body) => ({
    card_orders: { assets: (body as { ids: string[] }).ids },
  }));
});

test("saved ordering survives remounts and newly created cards append", () => {
  const { unmount } = render(<Board orders={{ assets: ["2", "1", "gone"] }} />);
  expect(names()).toEqual(["Loan", "Condo", "Car"]);
  unmount();
  render(<Board orders={{ assets: ["2", "1"] }} />);
  expect(names()).toEqual(["Loan", "Condo", "Car"]);
  expect(orderCards(cards, ["2", "1"], (item) => item.id)).toEqual([
    cards[1],
    cards[0],
    cards[2],
  ]);
});

test("keyboard reorders optimistically and saves the actual sequence", async () => {
  const saved = vi.fn();
  render(<Board saved={saved} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Condo" }), {
    key: "End",
  });
  expect(names()).toEqual(["Loan", "Car", "Condo"]);
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith({ assets: ["2", "3", "1"] }),
  );
  expect(api).toHaveBeenCalledWith("/card-order", "PUT", {
    scope: "assets",
    ids: ["2", "3", "1"],
  });
  expect(screen.getByRole("status")).toHaveTextContent("position 3 of 3");
  expect(screen.getByRole("button", { name: "Reorder Condo" })).toHaveFocus();
});

test("a failed save restores the original order and offers a retry", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Offline"));
  render(<Board />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Condo" }), {
    key: "ArrowRight",
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Previous order restored",
  );
  expect(names()).toEqual(["Condo", "Loan", "Car"]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(names()).toEqual(["Loan", "Condo", "Car"]));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

test("reordering filtered cards preserves saved hidden cards and reset restores defaults", async () => {
  render(
    <Board orders={{ assets: ["1", "2", "3"] }} items={[cards[0], cards[1]]} />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Condo" }), {
    key: "ArrowDown",
  });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/card-order", "PUT", {
      scope: "assets",
      ids: ["2", "1", "3"],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reset order" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset order" }));
  await waitFor(() => expect(names()).toEqual(["Condo", "Loan"]));
  expect(api).toHaveBeenLastCalledWith("/card-order", "PUT", {
    scope: "assets",
    ids: [],
  });
});

test("pointer dragging drops a card at the target without opening card actions", async () => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.pointerId = props.pointerId ?? 1;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  const original = document.elementFromPoint;
  try {
    render(<Board />);
    const target = screen
      .getByRole("heading", { name: "Loan" })
      .closest("[data-sortable-id]")!;
    document.elementFromPoint = vi.fn().mockReturnValue(target);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Reorder Condo" }),
      { button: 0, pointerId: 1, clientX: 10, clientY: 100 },
    );
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 250, clientY: 200 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 250, clientY: 200 });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/card-order", "PUT", {
        scope: "assets",
        ids: ["2", "1", "3"],
      }),
    );
  } finally {
    document.elementFromPoint = original;
    vi.unstubAllGlobals();
  }
});
