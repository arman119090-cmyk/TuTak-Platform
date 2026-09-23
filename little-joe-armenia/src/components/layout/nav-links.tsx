"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Desktop nav with the active section underlined in brand blue (as in the mockup). */
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
              className="tap relative inline-flex items-center px-3 text-[0.9rem] font-medium text-ink-2 hover:text-brand aria-[current=page]:text-brand aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-1.5 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-brand"
            >
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
