"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";

/** Same page in another locale. Plain <a> so the root layout (html lang) is re-rendered cleanly. */
export function localizedHref(pathname: string, search: string, target: Locale): string {
  const parts = pathname.split("/");
  parts[1] = target;
  return `${parts.join("/") || `/${target}`}${search ? `?${search}` : ""}`;
}

const SHORT: Record<Locale, string> = { hy: "Հայ", ru: "Рус", it: "Ita", en: "Eng" };

export function LanguageSwitcher({ locale, variant = "compact", tone = "dark" }: { locale: Locale; variant?: "compact" | "list"; tone?: "dark" | "light" }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { m } = useI18n();

  // Quiet inline links: «Հայերեն · Русский · Italiano · English».
  if (variant === "list") {
    const light = tone === "light";
    return (
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1" aria-label={m.nav.language}>
        {locales.map((l, i) => (
          <li key={l} className="flex items-center">
            {i > 0 ? (
              <span className={`mx-1.5 size-[3px] rounded-full ${light ? "bg-[#ffffff]/30" : "bg-line-strong"}`} aria-hidden="true" />
            ) : null}
            <a
              href={localizedHref(pathname, search, l)}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? "true" : undefined}
              className={`inline-flex min-h-10 items-center text-[0.85rem] transition-colors aria-[current=true]:font-semibold aria-[current=true]:underline aria-[current=true]:decoration-[var(--color-hairline)] aria-[current=true]:underline-offset-[6px] ${
                light ? "text-[#ffffff]/60 hover:text-[#ffffff] aria-[current=true]:text-[#ffffff]" : "text-ink-2 hover:text-ink aria-[current=true]:text-ink"
              }`}
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
      <summary className="tap flex cursor-pointer list-none items-center gap-1 px-2 text-[0.8rem] font-semibold tracking-[0.04em] text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span lang={locale}>{SHORT[locale]}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="transition-transform group-open:rotate-180">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span className="sr-only">{m.nav.language}</span>
      </summary>
      <ul className="absolute right-0 top-full mt-2 min-w-40 overflow-hidden rounded-2xl bg-card p-1.5 shadow-[var(--shadow-float)] ring-1 ring-line">
        {locales.map((l) => (
          <li key={l}>
            <a
              href={localizedHref(pathname, search, l)}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? "true" : undefined}
              className="flex min-h-10 items-center justify-between rounded-xl px-3 text-[0.85rem] text-ink-2 hover:bg-mist hover:text-ink aria-[current=true]:font-semibold aria-[current=true]:text-ink"
            >
              {localeNames[l]}
              {l === locale ? <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" /> : null}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
