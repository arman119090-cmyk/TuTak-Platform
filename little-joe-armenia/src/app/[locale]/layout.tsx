import "../globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { localeTags, locales, ogLocales, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/provider";
import { resolveLocale } from "@/i18n/server";
import { env } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { shopper } from "@/lib/security/session";
import { cartCount } from "@/lib/domain/cart";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { DemoBanner } from "@/components/layout/demo-banner";
import { CartUIProvider } from "@/components/cart/cart-ui";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { Analytics } from "@/components/analytics/analytics";
import { JsonLd } from "@/components/ui/json-ld";
import { organizationLd, websiteLd } from "@/lib/seo/jsonld";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbfbf9",
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const seo = await getSetting("seo");
  const e = env();
  return {
    metadataBase: new URL(e.APP_URL),
    title: { default: `${m.meta.homeTitle} · ${seo.titleSuffix}`, template: `%s · ${seo.titleSuffix}` },
    description: m.meta.siteDescription,
    applicationName: e.STORE_NAME,
    openGraph: {
      type: "website",
      siteName: e.STORE_NAME,
      locale: ogLocales[locale],
      alternateLocale: locales.filter((l) => l !== locale).map((l) => ogLocales[l]),
      ...(seo.ogImageUrl ? { images: [{ url: seo.ogImageUrl }] } : {}),
    },
    twitter: { card: "summary_large_image" },
    verification: e.GOOGLE_SITE_VERIFICATION ? { google: e.GOOGLE_SITE_VERIFICATION } : undefined,
    formatDetection: { telephone: false },
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale: Locale = await resolveLocale(params);
  const m = getMessages(locale);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const [owner, analytics] = await Promise.all([shopper(), getSetting("analytics")]);
  const count = await cartCount(owner);
  const e = env();

  return (
    <html lang={localeTags[locale]} dir="ltr">
      <body className="min-h-dvh flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-4 focus:py-3 focus:text-white"
        >
          {m.common.skipToContent}
        </a>
        <I18nProvider locale={locale} messages={m}>
          <CartUIProvider initialCount={count}>
            {e.DEMO_MODE ? <DemoBanner text={m.common.demoBanner} /> : null}
            <SiteHeader locale={locale} />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter locale={locale} />
            <CartDrawer />
          </CartUIProvider>
          <Analytics
            nonce={nonce}
            ga4Id={analytics.ga4Id || undefined}
            metaPixelId={analytics.metaPixelId || undefined}
            tiktokPixelId={analytics.tiktokPixelId || undefined}
          />
        </I18nProvider>
        <JsonLd data={[organizationLd(), websiteLd(locale)]} />
      </body>
    </html>
  );
}
