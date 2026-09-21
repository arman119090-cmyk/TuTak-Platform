import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CONTENT_PAGES, getContentPage } from '@/data/content-pages';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n';
import { brand } from '@/config/brand';
import { Alert, Breadcrumbs } from '@/components/ui';
import { MeasureCta } from '@/components/forms/measure-cta';

export const generateStaticParams = () =>
  LOCALES.flatMap((locale) => CONTENT_PAGES.map((page) => ({ locale, slug: page.slug })));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> => {
  const { locale, slug } = await params;
  const current = isLocale(locale) ? locale : 'ru';
  const page = getContentPage(slug);
  if (!page) return {};
  return {
    title: page.title[current],
    description: page.intro[current],
    alternates: {
      canonical: `/${current}/pages/${slug}`,
      languages: Object.fromEntries(LOCALES.map((item) => [item, `/${item}/pages/${slug}`])),
    },
  };
};

const ContentPageView = async ({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) => {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const page = getContentPage(slug);
  if (!page) notFound();

  return (
    <div className="container-page py-6 md:py-10">
      <Breadcrumbs
        items={[{ label: dict.common.home, href: `/${locale}` }, { label: page.title[locale] }]}
      />
      <article className="max-w-3xl">
        <h1 className="text-[32px] md:text-[42px]">{page.title[locale]}</h1>
        <p className="mt-4 text-[16px] text-ink-soft">{page.intro[locale]}</p>

        {page.legal ? (
          <div className="mt-6">
            <Alert tone="warning" title={dict.common.demoBadge}>
              {dict.footer.demoNotice}
            </Alert>
          </div>
        ) : null}

        <div className="mt-8 space-y-8">
          {page.sections.map((section) => (
            <section key={section.heading[locale]}>
              <h2 className="text-[22px]">{section.heading[locale]}</h2>
              {section.body.map((paragraph) => (
                <p
                  key={paragraph[locale]}
                  className="mt-3 text-[15px] leading-relaxed text-ink-soft"
                >
                  {paragraph[locale]}
                </p>
              ))}
            </section>
          ))}
        </div>

        {slug === 'measurement' || slug === 'assembly' ? (
          <div className="mt-10">
            <MeasureCta locale={locale} dict={dict} variant="primary" />
          </div>
        ) : null}

        {slug === 'contacts' ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {brand.contacts.phones.map((phone) => (
              <a
                key={phone.dial}
                href={`tel:${phone.dial}`}
                className="rounded-[var(--radius-md)] border border-line bg-surface p-5 hover:border-ink"
              >
                <span className="eyebrow">{dict.forms.phone}</span>
                <span className="mt-2 block text-[18px]">{phone.display}</span>
              </a>
            ))}
            <a
              href={`mailto:${brand.contacts.email}`}
              className="rounded-[var(--radius-md)] border border-line bg-surface p-5 hover:border-ink"
            >
              <span className="eyebrow">{dict.forms.email}</span>
              <span className="mt-2 block text-[18px]">{brand.contacts.email}</span>
            </a>
          </div>
        ) : null}
      </article>
    </div>
  );
};

export default ContentPageView;
