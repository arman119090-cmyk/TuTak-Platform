import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getCollectionProducts, getProduct, getSimilarProducts } from '@/lib/catalog/queries';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n';
import { getSession } from '@/lib/auth/session';
import { breadcrumbJsonLd, JsonLd, productJsonLd } from '@/lib/seo';
import { Badge, Breadcrumbs } from '@/components/ui';
import { Gallery } from '@/components/product/gallery';
import { BuyBox } from '@/components/product/buy-box';
import { SpecsTable } from '@/components/product/specs-table';
import { ReviewsBlock } from '@/components/product/reviews-block';
import { DoorConfigurator } from '@/components/product/door-configurator';
import { ProductRail } from '@/components/catalog/product-rail';
import { RecentlyViewed } from '@/components/home/recently-viewed';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> => {
  const { locale, slug } = await params;
  const current = isLocale(locale) ? locale : 'ru';
  const product = await getProduct(slug, current);
  if (!product) return {};

  return {
    title: product.metaTitle ?? product.name,
    description: product.metaDescription ?? product.shortDescription,
    alternates: {
      canonical: `/${current}/product/${slug}`,
      languages: Object.fromEntries(LOCALES.map((item) => [item, `/${item}/product/${slug}`])),
    },
    openGraph: {
      type: 'website',
      title: product.name,
      description: product.shortDescription,
      images: product.images.slice(0, 1).map((image) => ({ url: image.url })),
    },
  };
};

const ProductPage = async ({ params }: { params: Promise<{ locale: string; slug: string }> }) => {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  const product = await getProduct(slug, locale);
  if (!product) notFound();

  const isDoor = (product.parentCategory?.slug ?? product.category.slug) === 'doors';
  const [similar, collection, doorOptions, session] = await Promise.all([
    getSimilarProducts(product, locale),
    getCollectionProducts(product.collectionId, product.id, locale),
    isDoor
      ? prisma.doorConfigOption.findMany({
          where: { isActive: true },
          orderBy: [{ groupKey: 'asc' }, { sort: 'asc' }],
        })
      : Promise.resolve([]),
    getSession(),
  ]);

  const crumbs = [
    { label: dict.common.home, href: `/${locale}` },
    { label: dict.nav.catalog, href: `/${locale}/catalog` },
    ...(product.parentCategory
      ? [
          {
            label: product.parentCategory.name,
            href: `/${locale}/catalog/${product.parentCategory.slug}`,
          },
        ]
      : []),
    { label: product.categoryName, href: `/${locale}/catalog/${product.category.slug}` },
    { label: product.name, href: `/${locale}/product/${product.slug}` },
  ];

  const buyBoxProduct = {
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    image: product.images[0]?.url ?? '',
    brandName: product.brandName,
    collectionName: product.collectionName,
    categorySlug: product.category.slug,
    priceMinor: product.priceMinor,
    oldPriceMinor: product.oldPriceMinor,
    discountPct: product.discountPct,
    ratingAvg: product.ratingAvg,
    reviewCount: product.reviewCount,
    stockStatus: product.stockStatus,
    stockQty: product.stockQty,
    productionDays: product.productionDays,
    warrantyMonths: product.warrantyMonths,
    isNew: product.isNew,
    isHit: product.isHit,
    isPremium: product.isPremium,
    options: product.options.map((option) => ({
      kind: option.kind,
      valueKey: option.valueKey,
      label: option.label,
      priceDeltaMinor: option.priceDeltaMinor,
    })),
  };

  return (
    <div className="container-page py-6 md:py-8">
      <JsonLd
        data={breadcrumbJsonLd(crumbs.map((crumb) => ({ name: crumb.label, url: crumb.href })))}
      />
      <JsonLd
        data={productJsonLd({
          name: product.name,
          description: product.shortDescription,
          sku: product.sku,
          brandName: product.brandName,
          images: product.images.map((image) => image.url),
          priceMinor: product.priceMinor,
          currency: product.currency,
          inStock: product.stockStatus === 'IN_STOCK',
          ratingAvg: product.ratingAvg,
          reviewCount: product.reviewCount,
          url: `/${locale}/product/${product.slug}`,
        })}
      />
      <Breadcrumbs items={crumbs} />

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <Gallery
          images={product.images.map((image) => image.url)}
          alt={product.name}
          dict={dict}
          badges={
            <>
              {product.discountPct > 0 ? <Badge tone="sale">−{product.discountPct}%</Badge> : null}
              {product.stockStatus === 'IN_STOCK' ? (
                <Badge tone="stock">{dict.badges.inStock}</Badge>
              ) : null}
            </>
          }
        />
        <BuyBox product={buyBoxProduct} locale={locale} dict={dict} hidePurchase={isDoor} />
      </div>

      {isDoor && doorOptions.length > 0 ? (
        <div className="mt-10 max-w-3xl">
          <DoorConfigurator
            product={{
              id: product.id,
              sku: product.sku,
              slug: product.slug,
              name: product.name,
              image: product.images[0]?.url ?? '',
              priceMinor: product.priceMinor,
            }}
            options={doorOptions.map((option) => ({
              groupKey: option.groupKey,
              optionKey: option.optionKey,
              priceMinor: option.priceMinor,
              labels: (option.labels ?? {}) as Record<string, string>,
            }))}
            locale={locale}
            dict={dict}
          />
        </div>
      ) : null}

      <section className="mt-12 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div>
          <h2 className="mb-3 text-[22px]">{dict.product.description}</h2>
          <p className="max-w-3xl text-[15px] leading-relaxed text-ink-soft">
            {product.description}
          </p>

          <div className="mt-10">
            <SpecsTable
              product={{
                specs: product.specs,
                colorKeys: product.colorKeys,
                materialKeys: product.materialKeys,
                styleKey: product.styleKey,
                roomKey: product.roomKey,
                purposeKey: product.purposeKey,
                widthMm: product.widthMm,
                depthMm: product.depthMm,
                heightMm: product.heightMm,
                weightGram: product.weightGram,
                country: product.country,
                warrantyMonths: product.warrantyMonths,
                sku: product.sku,
                brandName: product.brandName,
                collectionName: product.collectionName,
                productionDays: product.productionDays,
              }}
              locale={locale}
              dict={dict}
            />
          </div>
        </div>

        <aside className="lg:sticky lg:top-[170px] lg:self-start">
          <div className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
            <h3 className="text-[17px]">{product.brandName}</h3>
            <p className="mt-2 text-[13px] text-muted">{product.brandTagline}</p>
          </div>
        </aside>
      </section>

      <section id="reviews" className="mt-12">
        <h2 className="mb-5 text-[22px]">{dict.product.reviews}</h2>
        <ReviewsBlock
          productId={product.id}
          ratingAvg={product.ratingAvg}
          isAuthenticated={Boolean(session)}
          reviews={product.reviews.map((review) => ({
            id: review.id,
            authorName: review.authorName,
            rating: review.rating,
            title: review.title,
            body: review.body,
            createdAt: review.createdAt.toISOString(),
          }))}
          locale={locale}
          dict={dict}
        />
      </section>

      <div className="-mx-4 md:mx-0">
        <ProductRail title={dict.product.similar} products={similar} locale={locale} dict={dict} />
        {collection.length > 0 ? (
          <ProductRail
            title={dict.product.sameCollection}
            products={collection}
            locale={locale}
            dict={dict}
          />
        ) : null}
        <RecentlyViewed locale={locale} dict={dict} excludeId={product.id} />
      </div>
    </div>
  );
};

export default ProductPage;
