import { notFound } from 'next/navigation';
import { getBanners, getCategoryTree, getHomeSections } from '@/lib/catalog/queries';
import { getDictionary, isLocale } from '@/lib/i18n';
import { Hero } from '@/components/home/hero';
import { Advantages } from '@/components/home/advantages';
import { CategoryGrid } from '@/components/home/category-grid';
import { PromoBlock } from '@/components/home/promo-block';
import { ProductRail } from '@/components/catalog/product-rail';
import { ReviewsSection } from '@/components/home/reviews-section';
import { Gallery } from '@/components/home/gallery';
import { RecentlyViewed } from '@/components/home/recently-viewed';

export const revalidate = 300;

const HomePage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  const [heroBanners, tree, sections] = await Promise.all([
    getBanners(locale, 'HOME_HERO'),
    getCategoryTree(locale),
    getHomeSections(locale),
  ]);

  return (
    <>
      <Hero slides={heroBanners} locale={locale} />
      <Advantages dict={dict} />
      <CategoryGrid tree={tree} locale={locale} dict={dict} />

      <ProductRail
        title={dict.home.popular}
        subtitle={dict.home.popularSubtitle}
        href={`/${locale}/catalog?sort=popular`}
        products={sections.popular}
        locale={locale}
        dict={dict}
      />

      <PromoBlock
        eyebrow={dict.home.kitchens}
        title={dict.home.kitchens}
        text={dict.home.kitchensSubtitle}
        ctaLabel={dict.home.kitchensCta}
        href={`/${locale}/kitchens`}
        secondary={{ label: dict.nav.catalog, href: `/${locale}/catalog/kitchens` }}
        artKey="kitchen"
        tone="olive"
        bullets={[
          dict.kitchen.calcSubtitle,
          dict.advantages.measureText,
          dict.advantages.assemblyText,
        ]}
      />

      <ProductRail
        title={dict.home.newArrivals}
        subtitle={dict.home.newArrivalsSubtitle}
        href={`/${locale}/catalog?sort=new`}
        products={sections.new}
        locale={locale}
        dict={dict}
      />

      <ProductRail
        title={dict.home.discounts}
        subtitle={dict.home.discountsSubtitle}
        href={`/${locale}/catalog?discounted=1&sort=discount`}
        products={sections.discounts}
        locale={locale}
        dict={dict}
      />

      <PromoBlock
        eyebrow={dict.nav.doors}
        title={dict.home.doors}
        text={dict.home.doorsSubtitle}
        ctaLabel={dict.home.doorsCta}
        href={`/${locale}/catalog/doors`}
        artKey="door"
        tone="oak"
        reverse
        dark
        bullets={[dict.door.configuratorSubtitle, dict.checkout.doorInstallService]}
      />

      <ProductRail
        title={dict.home.bedroom}
        subtitle={dict.home.bedroomSubtitle}
        href={`/${locale}/catalog/beds`}
        products={sections.bedroom}
        locale={locale}
        dict={dict}
      />

      <ProductRail
        title={dict.home.living}
        subtitle={dict.home.livingSubtitle}
        href={`/${locale}/catalog/living-room`}
        products={sections.living}
        locale={locale}
        dict={dict}
      />

      <ProductRail
        title={dict.home.tablesChairs}
        subtitle={dict.home.tablesChairsSubtitle}
        href={`/${locale}/catalog/tables`}
        products={sections.tablesChairs}
        locale={locale}
        dict={dict}
      />

      <ProductRail
        title={dict.home.smallSpace}
        subtitle={dict.home.smallSpaceSubtitle}
        href={`/${locale}/catalog?smallSpace=1`}
        products={sections.smallSpace}
        locale={locale}
        dict={dict}
      />

      <PromoBlock
        eyebrow="Premium"
        title={dict.home.premium}
        text={dict.home.premiumSubtitle}
        ctaLabel={dict.common.showAll}
        href={`/${locale}/catalog?premium=1`}
        artKey="sofa-modular"
        tone="anthracite"
        dark
      />

      <ProductRail
        title={dict.home.inStockNow}
        subtitle={dict.home.inStockNowSubtitle}
        href={`/${locale}/catalog?inStock=1`}
        products={sections.inStock}
        locale={locale}
        dict={dict}
      />

      <RecentlyViewed locale={locale} dict={dict} />
      <ReviewsSection dict={dict} locale={locale} />
      <Gallery dict={dict} />
    </>
  );
};

export default HomePage;
