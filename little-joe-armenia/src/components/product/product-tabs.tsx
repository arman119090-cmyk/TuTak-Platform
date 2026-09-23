"use client";

import { useId, useState, type ReactNode } from "react";

/** Accessible tabs (WAI-ARIA tabs pattern, arrow-key navigation). Panels are server-rendered. */
export function ProductTabs({ tabs }: { tabs: { id: string; label: string; content: ReactNode }[] }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const focusTab = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(n);
    document.getElementById(`${base}-tab-${n}`)?.focus();
  };
  return (
    <div className="card overflow-hidden">
      <div role="tablist" className="no-scrollbar flex gap-1 overflow-x-auto bg-sky-2 p-1.5">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`${base}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`${base}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") focusTab(i + 1);
              if (e.key === "ArrowLeft") focusTab(i - 1);
            }}
            className="min-h-12 flex-1 whitespace-nowrap rounded-xl px-4 text-sm font-semibold text-ink-2 transition aria-selected:bg-white aria-selected:text-ink aria-selected:shadow-sm"
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          id={`${base}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${i}`}
          hidden={i !== active}
          className="p-5 md:p-8"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
