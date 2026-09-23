"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconClose } from "@/components/ui/icons";

// Modal sheet built on the native <dialog> element: focus is trapped, Esc
// closes, the page behind becomes inert and focus returns to the opener —
// all provided by the browser, no ARIA re-implementation needed.

type Side = "right" | "left" | "bottom";

export function Sheet({
  open,
  onClose,
  label,
  side = "right",
  closeLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  side?: Side;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!open && d.open) {
      d.close();
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  const position =
    side === "bottom"
      ? "mt-auto mb-0 w-full max-w-none rounded-t-[1.5rem] max-h-[88dvh] sheet-bottom"
      : side === "left"
        ? "mr-auto ml-0 h-dvh max-h-dvh w-[min(24rem,92vw)] sheet-left"
        : "ml-auto mr-0 h-dvh max-h-dvh w-[min(28rem,100vw)] sheet-right";

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={() => {
        document.documentElement.style.overflow = "";
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose();
      }}
      className={`${position} flex-col bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/35 backdrop:backdrop-blur-[2px] open:flex`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-base font-bold">{label}</h2>
        <button type="button" onClick={onClose} className="tap -mr-2 inline-flex items-center justify-center rounded-full hover:bg-mist" aria-label={closeLabel}>
          <IconClose />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {footer ? <div className="border-t border-line px-5 pt-4 pb-[calc(1rem+var(--safe-bottom))]">{footer}</div> : null}
    </dialog>
  );
}
