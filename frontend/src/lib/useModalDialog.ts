import { useLayoutEffect, type RefObject } from "react";

const openDialogs: HTMLDialogElement[] = [];
let restorePage: (() => void) | undefined;

function lockPage(dialog: HTMLDialogElement) {
  if (!openDialogs.length) {
    const { documentElement: root, body } = document;
    const x = window.scrollX,
      y = window.scrollY;
    const properties: [HTMLElement, string][] = [
      [root, "overflow"],
      [body, "overflow"],
      [body, "position"],
      [body, "top"],
      [body, "left"],
      [body, "right"],
      [body, "width"],
      [body, "padding-right"],
    ];
    const previous = properties.map(([element, property]) => ({
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    }));
    const gutter = root.clientWidth ? window.innerWidth - root.clientWidth : 0;
    const padding = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `${-y}px`;
    body.style.left = `${-x}px`;
    body.style.right = "0";
    body.style.width = "100%";
    if (gutter > 0) body.style.paddingRight = `${padding + gutter}px`;
    const preventBackgroundScroll = (event: Event) => {
      const active = openDialogs.at(-1);
      if (
        active &&
        (!(event.target instanceof Node) ||
          !active.contains(event.target) ||
          event.target === active)
      ) {
        event.preventDefault();
      }
    };
    document.addEventListener("wheel", preventBackgroundScroll, {
      capture: true,
      passive: false,
    });
    document.addEventListener("touchmove", preventBackgroundScroll, {
      capture: true,
      passive: false,
    });
    restorePage = () => {
      document.removeEventListener("wheel", preventBackgroundScroll, true);
      document.removeEventListener("touchmove", preventBackgroundScroll, true);
      previous.forEach(({ element, property, value, priority }) => {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      });
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
    };
  }
  openDialogs.push(dialog);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = openDialogs.indexOf(dialog);
    if (index >= 0) openDialogs.splice(index, 1);
    if (!openDialogs.length) {
      restorePage?.();
      restorePage = undefined;
    }
  };
}

function draftState(dialog: HTMLDialogElement) {
  return JSON.stringify(
    Array.from(
      dialog.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("form input, form select, form textarea"),
    )
      .filter((field) => field.closest("dialog") === dialog)
      .map((field) => [
        field.name,
        field.type,
        field.value,
        field instanceof HTMLInputElement ? field.checked : null,
        field instanceof HTMLInputElement && field.files
          ? Array.from(field.files, (file) => [
              file.name,
              file.size,
              file.lastModified,
            ])
          : null,
      ]),
  );
}

/** Native modal lifecycle, nested scroll locks, and safe backdrop dismissal. */
export function useModalDialog(
  ref: RefObject<HTMLDialogElement | null>,
  open = true,
) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const unlock = lockPage(dialog);
    try {
      dialog.showModal();
    } catch (error) {
      unlock();
      throw error;
    }
    const initialDraft = draftState(dialog);
    let beganOutside = false;
    const outside = (event: MouseEvent) => {
      if (event.target !== dialog) return false;
      const bounds = dialog.getBoundingClientRect();
      return (
        event.clientX < bounds.left ||
        event.clientX >= bounds.right ||
        event.clientY < bounds.top ||
        event.clientY >= bounds.bottom
      );
    };
    const pointerDown = (event: PointerEvent) => {
      beganOutside = event.button === 0 && outside(event);
    };
    const pointerCancel = () => {
      beganOutside = false;
    };
    const click = (event: MouseEvent) => {
      const dismiss = beganOutside && outside(event);
      beganOutside = false;
      if (
        !dismiss ||
        openDialogs.at(-1) !== dialog ||
        draftState(dialog) !== initialDraft
      )
        return;
      // Use each dialog's existing Escape handler, including its saving guard.
      if (dialog.dispatchEvent(new Event("cancel", { cancelable: true })))
        dialog.close();
    };
    dialog.addEventListener("pointerdown", pointerDown);
    dialog.addEventListener("pointercancel", pointerCancel);
    dialog.addEventListener("click", click);
    dialog.addEventListener("close", unlock);
    return () => {
      dialog.removeEventListener("pointerdown", pointerDown);
      dialog.removeEventListener("pointercancel", pointerCancel);
      dialog.removeEventListener("click", click);
      dialog.removeEventListener("close", unlock);
      dialog.close();
      unlock();
    };
  }, [ref, open]);
}
