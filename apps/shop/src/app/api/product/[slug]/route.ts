import { NextResponse } from 'next/server';
import { getProduct } from '@/lib/catalog/queries';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n';

/** Payload for quick view — deliberately smaller than the product page. */
export const GET = async (
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> => {
  const { slug } = await params;
  const localeParam = new URL(request.url).searchParams.get('locale');
  const locale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;

  const product = await getProduct(slug, locale);
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    shortDescription: product.shortDescription,
    priceMinor: product.priceMinor,
    oldPriceMinor: product.oldPriceMinor,
    ratingAvg: product.ratingAvg,
    reviewCount: product.reviewCount,
    stockStatus: product.stockStatus,
    images: product.images.map((image) => image.url),
    brandName: product.brandName,
    options: product.options.map((option) => ({
      kind: option.kind,
      valueKey: option.valueKey,
      label: option.label,
      priceDeltaMinor: option.priceDeltaMinor,
    })),
  });
};
