import { useRef, useState, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useModalDialog } from "./useModalDialog";

function Modal({
  label,
  onClose,
  children,
  busy = false,
}: {
  label: string;
  onClose: () => void;
  children?: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div>{children}</div>
      <button onClick={onClose}>Close {label}</button>
    </dialog>
  );
}
function Example({
  form = false,
  busy = false,
}: {
  form?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [child, setChild] = useState(false);
  return open ? (
    <Modal label="Parent" busy={busy} onClose={() => setOpen(false)}>
      {form && (
        <form>
          <input aria-label="Description" name="description" defaultValue="" />
        </form>
      )}
      <button onClick={() => setChild(true)}>Open child</button>
      {child && (
        <Modal label="Child" onClose={() => setChild(false)}>
          <p>Child contents</p>
        </Modal>
      )}
    </Modal>
  ) : null;
}
function backdrop(dialog: HTMLElement, start = [20, 20], end = [20, 20]) {
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    right: 500,
    bottom: 500,
  } as DOMRect);
  fireEvent(
    dialog,
    new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: start[0],
      clientY: start[1],
    }),
  );
  fireEvent.click(dialog, { button: 0, clientX: end[0], clientY: end[1] });
}
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
});

test("opening a modal freezes the page and closing restores its position and previous inline styles", () => {
  Object.defineProperty(window, "scrollY", { configurable: true, value: 380 });
  document.body.style.paddingRight = "3px";
  document.body.style.overflow = "scroll";
  document.documentElement.style.overflow = "auto";
  const original = document.body.style.cssText;
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(<Example />);
  expect(document.body.style.position).toBe("fixed");
  expect(document.body.style.top).toBe("-380px");
  expect(document.documentElement.style.overflow).toBe("hidden");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Close Parent" }));
  expect(document.body.style.cssText).toBe(original);
  expect(document.documentElement.style.overflow).toBe("auto");
  expect(scroll).toHaveBeenCalledWith(0, 380);
});

test("backdrop click dismisses read-only popups, but inside clicks and drags from inside do not", () => {
  render(<Example />);
  const dialog = screen.getByRole("dialog");
  backdrop(dialog, [200, 200], [200, 200]);
  expect(dialog).toBeInTheDocument();
  backdrop(dialog, [200, 200], [20, 20]);
  expect(dialog).toBeInTheDocument();
  backdrop(dialog);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.position).toBe("");
});

test("outside clicks preserve an edited form; explicit Close still dismisses it", () => {
  render(<Example form />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Keep my draft" },
  });
  backdrop(screen.getByRole("dialog"));
  expect(screen.getByRole("textbox")).toHaveValue("Keep my draft");
  expect(document.body.style.position).toBe("fixed");
  fireEvent.click(screen.getByRole("button", { name: "Close Parent" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.position).toBe("");
});

test("unchanged forms dismiss from the backdrop and pending saves use their existing cancellation guard", () => {
  const { rerender } = render(<Example form busy />);
  backdrop(screen.getByRole("dialog"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  rerender(<Example form />);
  backdrop(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("closing a nested popup keeps the outer popup and background scroll lock active", () => {
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "Open child" }));
  backdrop(screen.getByRole("dialog", { name: "Parent" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  backdrop(screen.getByRole("dialog", { name: "Child" }));
  expect(
    screen.queryByRole("dialog", { name: "Child" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Parent" })).toBeInTheDocument();
  expect(document.body.style.position).toBe("fixed");
  backdrop(screen.getByRole("dialog", { name: "Parent" }));
  expect(document.body.style.position).toBe("");
});

test("wheel and touch scroll outside the top popup are blocked, while its contents remain scrollable", () => {
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "Open child" }));
  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });
  screen.getByRole("dialog", { name: "Parent" }).dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  const inside = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });
  screen.getByText("Child contents").dispatchEvent(inside);
  expect(inside.defaultPrevented).toBe(false);
  const touch = new Event("touchmove", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(touch);
  expect(touch.defaultPrevented).toBe(true);
});

test("unmounting an open popup releases scroll locks", () => {
  const { unmount } = render(<Example />);
  expect(document.body.style.overflow).toBe("hidden");
  unmount();
  expect(document.body.style.overflow).toBe("");
  expect(document.documentElement.style.overflow).toBe("");
});
