"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";
import { IconGlobe } from "@/components/ui/icons";

/** Same page in another locale. Plain <a> so the root layout (html lang) is re-rendered cleanly. */
export function localizedHref(pathname: string, search: string, target: Locale): string {
  const parts = pathname.split("/");
  parts[1] = target;
  return `${parts.join("/") || `/${target}`}${search ? `?${search}` : ""}`;
}

export function LanguageSwitcher({ locale, variant = "compact" }: { locale: Locale; variant?: "compact" | "list" }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { m } = useI18n();

  if (variant === "list") {
    return (
      <ul className="grid grid-cols-2 gap-2" aria-label={m.nav.language}>
        {locales.map((l) => (
          <li key={l}>
            <a
              href={localizedHref(pathname, search, l)}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? "true" : undefined}
              className="chip w-full justify-center"
              data-active={l === locale}
            >
              {localeNames[l]}
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <details className="group relative">
      <summary className="tap flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3 text-sm font-semibold uppercase hover:bg-mist [&::-webkit-details-marker]:hidden">
        <IconGlobe width={18} height={18} />
        <span>{locale}</span>
        <span className="sr-only">{m.nav.language}</span>
      </summary>
      <ul className="absolute right-0 top-full mt-2 min-w-44 overflow-hidden rounded-2xl bg-card p-1.5 shadow-[var(--shadow-float)] ring-1 ring-line">
        {locales.map((l) => (
          <li key={l}>
            <a
              href={localizedHref(pathname, search, l)}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? "true" : undefined}
              className="tap flex items-center justify-between rounded-xl px-3 text-sm hover:bg-mist aria-[current=true]:font-bold"
            >
              {localeNames[l]}
              <span className="text-xs uppercase text-muted">{l}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
