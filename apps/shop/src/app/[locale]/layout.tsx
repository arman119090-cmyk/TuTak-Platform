import type { Metadata } from 'next';
import type { Viewport } from 'next';
import { notFound } from 'next/navigation';
import '../globals.css';
import { brand, brandName, siteUrl } from '@/config/brand';
import { getDictionary, htmlLang, isLocale, LOCALES, type Locale } from '@/lib/i18n';
import { getCategoryTree } from '@/lib/catalog/queries';
import { getSession } from '@/lib/auth/session';
import { StoreProvider } from '@/components/providers/store-provider';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { ToastViewport } from '@/components/layout/toast-viewport';
import { FloatingContact } from '@/components/layout/floating-contact';
import { JsonLd, organizationJsonLd } from '@/lib/seo';

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1C1A17',
};

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : 'ru';
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: `${brandName(current)} — ${brand.tagline[current]}`,
      template: `%s — ${brandName(current)}`,
    },
    description: brand.tagline[current],
    alternates: {
      canonical: `/${current}`,
      languages: Object.fromEntries(LOCALES.map((item) => [htmlLang(item), `/${item}`])),
    },
    openGraph: {
      type: 'website',
      siteName: brandName(current),
      title: `${brandName(current)} — ${brand.tagline[current]}`,
      description: brand.tagline[current],
      locale: htmlLang(current),
      url: `${siteUrl}/${current}`,
    },
    robots: { index: true, follow: true },
  };
};

const LocaleLayout = async ({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dict = getDictionary(locale);
  const [tree, session] = await Promise.all([getCategoryTree(locale), getSession()]);

  return (
    <html lang={htmlLang(locale)}>
      <body>
        {/* The shop itself, named in the language of the page, on every page. */}
        <JsonLd data={organizationJsonLd(locale)} />
        <StoreProvider isAuthenticated={Boolean(session)}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[80] focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
          >
            {dict.common.home}
          </a>
          <Header
            locale={locale}
            dict={dict}
            tree={tree}
            session={session ? { name: session.name, role: session.role } : null}
          />
          <main id="main" className="min-h-[60vh]">
            {children}
          </main>
          <Footer locale={locale} dict={dict} tree={tree} />
          <ToastViewport />
          <FloatingContact locale={locale} dict={dict} />
        </StoreProvider>
      </body>
    </html>
  );
};

export default LocaleLayout;
