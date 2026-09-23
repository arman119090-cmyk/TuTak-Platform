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
    <footer className="mt-24 bg-navy pb-[var(--safe-bottom)] text-white">
      <div className="container-lj grid gap-10 py-14 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div>
          <Wordmark tagline="Put a smile in the air!" light />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">{authorised ? m.footer.officialPartner : m.footer.notOfficial}</p>
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
            <h2 className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-white/45">{c.title}</h2>
            <ul className="space-y-0.5">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-10 items-center text-[0.95rem] text-white/80 transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container-lj flex flex-col gap-6 border-t border-white/10 py-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-md">
          <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-white/45">{m.nav.language}</p>
          <Suspense fallback={null}>
            <LanguageSwitcher locale={locale} variant="list" />
          </Suspense>
        </div>
        {socialLinks.length > 0 ? (
          <div>
            <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-white/45">{m.footer.social}</p>
            <ul className="flex gap-2">
              {socialLinks.map((s) => (
                <li key={s.label}>
                  <a href={s.href} rel="noopener noreferrer me" target="_blank" className="chip">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-white/50">
          © {new Date().getFullYear()} {business.legalName || env().STORE_NAME}. {m.footer.rights} {m.footer.currencyNote}
        </p>
      </div>
    </footer>
  );
}
