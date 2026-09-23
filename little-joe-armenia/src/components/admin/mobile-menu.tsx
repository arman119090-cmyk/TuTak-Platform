"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Collapsible admin menu for phones; closes itself after navigating. */
export function MobileMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  return (
    <details ref={ref} className="border-b border-line bg-card md:hidden">
      <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 font-semibold">
        <span className="font-[family-name:var(--font-logo)] text-xl">Little Joe</span>
        <span className="rounded-lg px-3 py-1.5 text-sm text-[#1463e6] ring-1 ring-[#1463e6]/30">☰ Меню</span>
      </summary>
      <div className="px-3 pb-4">{children}</div>
    </details>
  );
}
