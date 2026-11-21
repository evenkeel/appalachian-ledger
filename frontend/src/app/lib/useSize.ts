import { useLayoutEffect, useRef, useState } from "react";

/** Measured size of an element, so charts draw at real pixels and text never scales. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setSize((previous) => {
        const width = element.clientWidth,
          height = element.clientHeight;
        return previous.width === width && previous.height === height ? previous : { width, height };
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
