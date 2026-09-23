"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Desktop nav: quiet links, the active one underlined with a gold hairline. */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-1">
      {items.map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              aria-current={active ? "page" : undefined}
              className="tap relative inline-flex items-center px-3 text-[0.85rem] font-medium tracking-[0.01em] text-ink-2 transition-colors hover:text-ink aria-[current=page]:text-ink aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-2 aria-[current=page]:after:h-px aria-[current=page]:after:bg-[var(--color-gold)]"
            >
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
