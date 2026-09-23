"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import type { Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";
import { Sheet } from "@/components/ui/sheet";
import { IconChevron, IconMenu } from "@/components/ui/icons";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export function MobileMenu({ locale, items }: { locale: Locale; items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const { m } = useI18n();
  return (
    <div className="lg:hidden">
      <button
        type="button"
        className="tap -ml-2 inline-flex items-center justify-center rounded-full hover:bg-mist"
        aria-label={m.nav.openMenu}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <IconMenu />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label={m.nav.menu} side="left" closeLabel={m.nav.closeMenu}>
        <nav aria-label={m.nav.menu} className="px-3 py-3">
          <ul>
            {items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-14 items-center justify-between rounded-2xl px-3 text-lg font-semibold hover:bg-mist"
                >
                  {i.label}
                  <IconChevron className="text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="px-6 pt-4 pb-8">
          <p className="eyebrow mb-3">{m.nav.language}</p>
          <Suspense fallback={null}>
            <LanguageSwitcher locale={locale} variant="list" />
          </Suspense>
        </div>
      </Sheet>
    </div>
  );
}
