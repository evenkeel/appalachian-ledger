import { createContext, useContext, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { GripVertical } from "lucide-react";
import { api } from "../lib/api";
import type { CardOrders, CardScope } from "../lib/types";
import { Button } from "./ui/button";

export function orderCards<T>(
  items: T[],
  order: string[],
  id: (item: T) => string,
): T[] {
  const positions = new Map(order.map((key, index) => [key, index]));
  return [...items].sort(
    (a, b) =>
      (positions.get(id(a)) ?? Infinity) - (positions.get(id(b)) ?? Infinity),
  );
}
export function moveCard(ids: string[], from: string, to: string) {
  const target = ids.indexOf(to);
  if (!ids.includes(from) || target < 0) return ids;
  const result = ids.filter((id) => id !== from);
  result.splice(target, 0, from);
  return result;
}
type OrderState = {
  orders: CardOrders;
  pending: boolean;
  error: { scope: CardScope; message: string; ids: string[] } | null;
  save: (scope: CardScope, ids: string[]) => Promise<boolean>;
};
const OrderContext = createContext<OrderState | null>(null);
export function CardOrderProvider({
  orders,
  onSaved,
  children,
}: {
  orders: CardOrders;
  onSaved: (orders: CardOrders) => void;
  children: ReactNode;
}) {
  const [local, setLocal] = useState(orders);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<OrderState["error"]>(null);
  const lock = useRef(false);
  const current = useRef(orders);
  useEffect(() => {
    if (!lock.current) {
      current.current = orders;
      setLocal(orders);
    }
  }, [orders]);
  async function save(scope: CardScope, ids: string[]) {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    setError(null);
    const before = current.current;
    const merged = ids.length
      ? [...ids, ...(before[scope] || []).filter((id) => !ids.includes(id))]
      : [];
    const next = { ...before, [scope]: merged };
    current.current = next;
    setLocal(next);
    try {
      const result = await api<{ card_orders: CardOrders }>(
        "/card-order",
        "PUT",
        { scope, ids: merged },
      );
      current.current = result.card_orders;
      setLocal(result.card_orders);
      onSaved(result.card_orders);
      return true;
    } catch (e) {
      current.current = before;
      setLocal(before);
      setError({
        scope,
        message: `Could not save card order. Previous order restored. ${(e as Error).message}`,
        ids,
      });
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <OrderContext.Provider value={{ orders: local, pending, error, save }}>
      {children}
    </OrderContext.Provider>
  );
}

type Drag = {
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  target: string | null;
  moved: boolean;
  pointer: number;
  scrollX: number;
  scrollY: number;
};
export function SortableCards<T>({
  scope,
  items,
  itemId,
  itemLabel,
  className,
  title,
  renderItem,
}: {
  scope: CardScope;
  items: T[];
  itemId: (item: T) => string;
  itemLabel: (item: T) => string;
  className: string;
  title?: string;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
}) {
  const context = useContext(OrderContext);
  const grid = useRef<HTMLDivElement>(null);
  const keyboardFocus = useRef<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const ordered = orderCards(items, context?.orders[scope] || [], itemId);
  const ids = ordered.map(itemId);
  useEffect(() => {
    if (!keyboardFocus.current) return;
    const card = [
      ...(grid.current?.querySelectorAll<HTMLElement>("[data-sortable-id]") ||
        []),
    ].find((element) => element.dataset.sortableId === keyboardFocus.current);
    card?.querySelector<HTMLButtonElement>(".card-drag-handle")?.focus();
    if (!context?.pending) keyboardFocus.current = null;
  }, [context?.pending, context?.orders]);
  const latest = useRef({ ids, context, ordered, itemId, itemLabel });
  latest.current = { ids, context, ordered, itemId, itemLabel };
  async function commit(from: string, to: string) {
    const state = latest.current;
    const next = moveCard(state.ids, from, to);
    if (
      next === state.ids ||
      next.every((id, index) => id === state.ids[index])
    )
      return;
    const item = state.ordered.find((item) => state.itemId(item) === from);
    const position = next.indexOf(from) + 1;
    const saved = await state.context?.save(scope, next);
    if (saved)
      setAnnouncement(
        `${item ? state.itemLabel(item) : "Card"} moved to position ${position} of ${next.length}. Order saved.`,
      );
  }
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    function move(event: globalThis.PointerEvent) {
      const current = dragRef.current;
      if (!current || current.pointer !== event.pointerId) return;
      const moved =
        current.moved ||
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) > 5;
      if (!moved) return;
      event.preventDefault();
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-sortable-id]");
      const id =
        target && grid.current?.contains(target)
          ? target.dataset.sortableId || null
          : null;
      const next = {
        ...current,
        x: event.clientX,
        y: event.clientY,
        target: id === current.id ? null : id,
        moved,
      };
      dragRef.current = next;
      setDrag(next);
      if (event.clientY < 65) window.scrollBy(0, -18);
      else if (event.clientY > window.innerHeight - 65) window.scrollBy(0, 18);
    }
    function finish(event: globalThis.PointerEvent) {
      const current = dragRef.current;
      if (!current || current.pointer !== event.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      if (current.moved && current.target)
        void commitRef.current(current.id, current.target);
    }
    function cancel() {
      dragRef.current = null;
      setDrag(null);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") cancel();
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || context?.pending) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const value = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      target: null,
      moved: false,
      pointer: event.pointerId,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
    dragRef.current = value;
    setDrag(value);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const index = ids.indexOf(id);
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? ids.length - 1
          : ["ArrowLeft", "ArrowUp"].includes(event.key)
            ? index - 1
            : ["ArrowRight", "ArrowDown"].includes(event.key)
              ? index + 1
              : null;
    if (target === null) return;
    event.preventDefault();
    if (context?.pending) return;
    if (target >= 0 && target < ids.length && target !== index) {
      keyboardFocus.current = id;
      void commit(id, ids[target]);
    }
  }
  const canArrange = Boolean(context) && items.length > 1;
  const error = context?.error?.scope === scope ? context.error : null;
  return (
    <>
      {canArrange && (
        <div className="card-order-help">
          <span>
            Drag the grip to arrange cards. Arrow keys also move a focused grip.
          </span>
          <span role="status" aria-live="polite">
            {context?.pending ? "Saving order…" : announcement}
          </span>
          {(context?.orders[scope]?.length || 0) > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={context?.pending}
              onClick={async () => {
                if (await context?.save(scope, []))
                  setAnnouncement("Default order restored.");
              }}
            >
              Reset order
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error.message}
          <Button
            variant="ghost"
            size="sm"
            disabled={context?.pending}
            onClick={() => void context?.save(scope, error.ids)}
          >
            Retry
          </Button>
        </div>
      )}
      <div ref={grid} className={className} title={title}>
        {ordered.map((item) => {
          const id = itemId(item),
            label = itemLabel(item);
          const moving = drag?.id === id && drag.moved;
          const style: CSSProperties | undefined = moving
            ? {
                transform: `translate(${drag.x - drag.startX + window.scrollX - drag.scrollX}px, ${drag.y - drag.startY + window.scrollY - drag.scrollY}px)`,
              }
            : undefined;
          const handle = canArrange ? (
            <button
              type="button"
              className="card-drag-handle"
              aria-label={`Reorder ${label}`}
              aria-describedby={`card-order-help-${scope}`}
              title="Drag to move. Use arrow keys, Home, or End to reorder."
              aria-disabled={context?.pending}
              onPointerDown={(event) => start(event, id)}
              onKeyDown={(event) => keyboard(event, id)}
            >
              <GripVertical size={17} aria-hidden="true" />
            </button>
          ) : null;
          return (
            <div
              key={id}
              data-sortable-id={id}
              className={`sortable-card ${moving ? "is-dragging" : ""} ${drag?.target === id ? "is-drop-target" : ""}`}
              style={style}
            >
              {renderItem(item, handle)}
            </div>
          );
        })}
      </div>
      {canArrange && (
        <span className="sr-only" id={`card-order-help-${scope}`}>
          Drag this card's grip to another card, or use arrow keys to move one
          place and Home or End to move to the beginning or end.
        </span>
      )}
    </>
  );
}
