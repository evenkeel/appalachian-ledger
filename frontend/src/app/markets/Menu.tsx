import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** A small pop-up under a button. Closes on a click elsewhere or Escape; a choice can close it too. */
export function Menu({
  label,
  className = "btn sm",
  align = "left",
  children,
}: {
  label: ReactNode;
  className?: string;
  /** Which edge of the button the pop-up lines up with. */
  align?: "left" | "right";
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className={`mk-menu${open ? " mk-menu-open" : ""}`}>
      <button className={className} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={`mk-pop${align === "right" ? " right" : ""}`} role="group" aria-label={typeof label === "string" ? label : undefined}>
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
