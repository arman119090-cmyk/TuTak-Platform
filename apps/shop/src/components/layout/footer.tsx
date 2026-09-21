import Link from 'next/link';
import { Mail, MapPin, Phone, Send, MessageCircle } from 'lucide-react';
import { brand } from '@/config/brand';
import { CONTENT_PAGES } from '@/data/content-pages';
import type { Dictionary, Locale } from '@/lib/i18n';
import { fill } from '@/lib/i18n';
import type { CategoryTree } from '@/lib/catalog/queries';
import { NewsletterForm } from '@/components/forms/newsletter-form';

export const Footer = ({
  locale,
  dict,
  tree,
}: {
  locale: Locale;
  dict: Dictionary;
  tree: CategoryTree;
}) => {
  const company = CONTENT_PAGES.filter((page) => page.group === 'company');
  const help = CONTENT_PAGES.filter((page) => page.group === 'help');
  const legal = CONTENT_PAGES.filter((page) => page.group === 'legal');

  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="container-page grid gap-10 py-14 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Link href={`/${locale}`} className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-ink font-display text-lg text-white">
              {brand.monogram}
            </span>
            <span className="font-display text-xl uppercase tracking-[0.12em]">{brand.name}</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm text-muted">{brand.tagline[locale]}</p>
          <div className="mt-5 space-y-2.5 text-sm">
            {brand.contacts.phones.map((phone) => (
              <a
                key={phone.dial}
                href={`tel:${phone.dial}`}
                className="flex items-center gap-2.5 hover:text-accent"
              >
                <Phone width={16} height={16} className="text-muted" /> {phone.display}
              </a>
            ))}
            <a href={`mailto:${brand.contacts.email}`} className="flex items-center gap-2.5 hover:text-accent">
              <Mail width={16} height={16} className="text-muted" /> {brand.contacts.email}
            </a>
            <p className="flex items-start gap-2.5 text-muted">
              <MapPin width={16} height={16} className="mt-0.5 shrink-0" /> {brand.address[locale]}
            </p>
            <p className="text-[13px] text-muted">
              {fill(dict.footer.workHours, { weekdays: brand.hours.weekdays, weekend: brand.hours.weekend })}
            </p>
          </div>
          <div className="mt-5 flex gap-2">
            <a
              href={`https://wa.me/${brand.contacts.whatsapp.replace(/\D/g, '')}`}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line hover:border-ink"
              aria-label="WhatsApp"
              rel="noreferrer noopener"
              target="_blank"
            >
              <MessageCircle width={18} height={18} />
            </a>
            <a
              href={`https://t.me/${brand.contacts.telegram}`}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line hover:border-ink"
              aria-label="Telegram"
              rel="noreferrer noopener"
              target="_blank"
            >
              <Send width={18} height={18} />
            </a>
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
            {dict.footer.catalogTitle}
          </h3>
          <ul className="space-y-2.5 text-sm">
            {tree.slice(0, 9).map((root) => (
              <li key={root.slug}>
                <Link href={`/${locale}/catalog/${root.slug}`} className="text-ink-soft hover:text-accent">
                  {root.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href={`/${locale}/catalog`} className="text-accent hover:underline">
                {dict.common.showAll} →
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
            {dict.footer.helpTitle}
          </h3>
          <ul className="space-y-2.5 text-sm">
            {help.map((page) => (
              <li key={page.slug}>
                <Link href={`/${locale}/pages/${page.slug}`} className="text-ink-soft hover:text-accent">
                  {page.title[locale]}
                </Link>
              </li>
            ))}
          </ul>
          <h3 className="mb-4 mt-7 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
            {dict.footer.companyTitle}
          </h3>
          <ul className="space-y-2.5 text-sm">
            {company.map((page) => (
              <li key={page.slug}>
                <Link href={`/${locale}/pages/${page.slug}`} className="text-ink-soft hover:text-accent">
                  {page.title[locale]}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-3 text-[17px]">{dict.home.newsletterTitle}</h3>
          <p className="mb-4 text-sm text-muted">{dict.home.newsletterText}</p>
          <NewsletterForm locale={locale} dict={dict} />
          <div className="mt-7 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-muted">
            {legal.map((page) => (
              <Link key={page.slug} href={`/${locale}/pages/${page.slug}`} className="hover:text-ink">
                {page.title[locale]}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-3 py-5 text-[12px] text-muted md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {brand.legalName}. {dict.footer.rights}.
          </p>
          <p className="max-w-2xl md:text-right">{dict.footer.demoNotice}</p>
        </div>
      </div>
    </footer>
  );
};
