import Link from "next/link";
import { Suspense } from "react";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { env } from "@/lib/env";
import { paths } from "@/lib/paths";
import { getSetting } from "@/lib/settings";
import { visibleCollections } from "@/lib/catalog";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Wordmark } from "@/components/layout/wordmark";

export async function SiteFooter({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const [social, contacts, business, collections] = await Promise.all([
    getSetting("social"),
    getSetting("contacts"),
    getSetting("business"),
    visibleCollections(locale),
  ]);
  // "Authorised" wording requires BOTH the env flag and the admin setting.
  const authorised = env().BRAND_AUTHORIZED && business.brandAuthorizationConfirmed;
  const socialLinks = [
    { href: social.instagram, label: "Instagram" },
    { href: social.facebook, label: "Facebook" },
    { href: social.tiktok, label: "TikTok" },
    { href: social.telegram, label: "Telegram" },
  ].filter((s) => /^https:\/\//.test(s.href));

  const cols = [
    {
      title: m.footer.shop,
      links: [
        { href: paths.shop(locale), label: m.footer.catalog },
        { href: paths.finder(locale), label: m.nav.scentFinder },
        ...collections.slice(0, 6).map((c) => ({ href: paths.collection(locale, c.slug), label: c.name })),
      ],
    },
    {
      title: m.footer.help,
      links: [
        { href: paths.page(locale, "delivery"), label: m.footer.delivery },
        { href: paths.page(locale, "payment"), label: m.footer.payment },
        { href: paths.page(locale, "returns"), label: m.footer.returns },
        { href: paths.page(locale, "faq"), label: m.footer.faq },
        { href: paths.page(locale, "contact"), label: m.footer.contact },
      ],
    },
    {
      title: m.footer.company,
      links: [
        { href: paths.page(locale, "about"), label: m.footer.about },
        { href: paths.page(locale, "privacy"), label: m.footer.privacy },
        { href: paths.page(locale, "terms"), label: m.footer.terms },
      ],
    },
  ];

  return (
    <footer className="relative mt-24 overflow-hidden bg-navy pb-[var(--safe-bottom)] text-[#ffffff]">
      <p className="hand pointer-events-none absolute -right-4 bottom-24 hidden -rotate-6 text-[5rem] leading-none text-white/[0.06] md:block" aria-hidden="true">{m.brand.slogan}</p>
      <div className="container-lj relative grid gap-10 pt-16 pb-12 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div>
          <Wordmark tagline={m.brand.country} light />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-[#ffffff]/55">{authorised ? m.footer.officialPartner : m.footer.notOfficial}</p>
          {contacts.phone || contacts.email ? (
            <address className="mt-4 space-y-1 text-sm not-italic">
              {contacts.phone ? (
                <a className="block hover:underline" href={`tel:${contacts.phone.replace(/[^\d+]/g, "")}`}>
                  {contacts.phone}
                </a>
              ) : null}
              {contacts.email ? (
                <a className="block hover:underline" href={`mailto:${contacts.email}`}>
                  {contacts.email}
                </a>
              ) : null}
            </address>
          ) : null}
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="mb-3 text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-hairline)]">{c.title}</h2>
            <ul className="space-y-0.5">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-10 items-center text-[0.9rem] text-[#ffffff]/75 transition-colors hover:text-[#ffffff]">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container-lj relative flex flex-col gap-5 border-t border-[#ffffff]/10 py-7 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="sr-only">{m.nav.language}</span>
          <Suspense fallback={null}>
            <LanguageSwitcher locale={locale} variant="list" tone="light" />
          </Suspense>
        </div>
        {socialLinks.length > 0 ? (
          <div>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-hairline)]">{m.footer.social}</p>
            <ul className="flex gap-2">
              {socialLinks.map((s) => (
                <li key={s.label}>
                  <a href={s.href} rel="noopener noreferrer me" target="_blank" className="inline-flex min-h-10 items-center text-sm text-[#ffffff]/75 underline decoration-[var(--color-hairline)] underline-offset-4 hover:text-[#ffffff]">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-[0.72rem] text-[#ffffff]/45">
          © {new Date().getFullYear()} {business.legalName || env().STORE_NAME}. {m.footer.rights} {m.footer.currencyNote}
        </p>
      </div>
    </footer>
  );
}
