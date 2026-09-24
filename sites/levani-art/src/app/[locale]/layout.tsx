import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import '@fontsource-variable/manrope';
import '@fontsource-variable/noto-serif-armenian';
import '@fontsource-variable/noto-sans-armenian';
import '../globals.css';

import type { Metadata, Viewport } from 'next';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { RevealObserver } from '@/components/RevealObserver';
import { localeMeta } from '@/i18n/config';
import { buildSearchIndex, localeParams, resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';
import { siteUrl } from '@/lib/site-url';
import { site } from '@/content/site';

export const dynamicParams = false;
export const generateStaticParams = localeParams;

export const viewport: Viewport = {
  themeColor: '#0b0a09',
  colorScheme: 'dark light',
};

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return {
    metadataBase: new URL(siteUrl()),
    ...pageMetadata({
      locale,
      path: '',
      title: site.brandName,
      description: dict.meta.siteDescription,
    }),
    icons: { icon: '/icon.svg' },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <html lang={localeMeta[locale].htmlLang} data-locale={locale}>
      <head>
        {/* Marks JS as available before first paint, so reveal-on-scroll
            never hides content from visitors without JavaScript. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          {dict.nav.skipToContent}
        </a>
        <Header
          locale={locale}
          labels={{ nav: dict.nav, language: dict.language, search: dict.search, a11y: dict.a11y }}
          searchIndex={buildSearchIndex(locale)}
        />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <Footer locale={locale} dict={dict} />
        <RevealObserver />
      </body>
    </html>
  );
}
