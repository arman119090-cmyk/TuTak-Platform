import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n';
import { getHomeSections } from '@/lib/catalog/queries';
import { artworkUrl } from '@/lib/media/artwork';
import { Breadcrumbs } from '@/components/ui';
import { KitchenCalculator } from '@/components/forms/kitchen-calculator';
import { MeasureCta } from '@/components/forms/measure-cta';
import { ProductRail } from '@/components/catalog/product-rail';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return {
    title: dict.kitchen.calcTitle,
    description: dict.home.kitchensSubtitle,
    alternates: {
      canonical: `/${locale}/kitchens`,
      languages: Object.fromEntries(LOCALES.map((item) => [item, `/${item}/kitchens`])),
    },
  };
};

const KitchensPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const sections = await getHomeSections(locale);

  return (
    <div>
      <div className="container-page pt-6">
        <Breadcrumbs
          items={[{ label: dict.common.home, href: `/${locale}` }, { label: dict.home.kitchens }]}
        />
      </div>

      <section className="container-page grid items-center gap-8 pb-10 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-3">{dict.home.kitchens}</p>
          <h1 className="text-[32px] leading-tight md:text-[46px]">{dict.kitchen.calcTitle}</h1>
          <p className="mt-4 max-w-lg text-[15px] text-ink-soft">{dict.kitchen.calcSubtitle}</p>
          <ul className="mt-6 space-y-2 text-[14px] text-muted">
            {[dict.advantages.measureText, dict.advantages.assemblyText, dict.advantages.warrantyText].map(
              (item) => (
                <li key={item} className="flex gap-2.5">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {item}
                </li>
              ),
            )}
          </ul>
          <div className="mt-7">
            <MeasureCta locale={locale} dict={dict} />
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={artworkUrl('kitchen-island', 'olive', 3, 12)}
          alt=""
          className="aspect-[4/3] w-full rounded-[var(--radius-lg)] object-cover shadow-[var(--shadow-card)]"
        />
      </section>

      <section className="container-page pb-12">
        <KitchenCalculator locale={locale} dict={dict} />
      </section>

      <ProductRail
        title={dict.home.kitchens}
        subtitle={dict.home.kitchensSubtitle}
        href={`/${locale}/catalog/kitchens`}
        products={sections.kitchens}
        locale={locale}
        dict={dict}
      />
    </div>
  );
};

export default KitchensPage;
