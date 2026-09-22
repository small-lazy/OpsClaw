import { useEffect, useRef } from "react";
export function useModalFocus(active: boolean, close: () => void) {
  const closer = useRef(close);
  closer.current = close;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    );
    const elements = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
        ) || [],
      ).filter((e) => e.offsetParent !== null);
    elements()[0]?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closer.current();
      }
      if (e.key === "Tab") {
        const targets = elements(),
          first = targets[0],
          last = targets[targets.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [active]);
}
