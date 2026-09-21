import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../prisma';
import { discountPercent } from '../money';
import { COLORS, MATERIALS } from '@/data/attributes';
import { artworkUrl, type ArtVariant } from '../media/artwork';
import type { adminProductSchema } from '../validation';

type ProductInput = z.infer<typeof adminProductSchema>;

/**
 * Shared create/update logic for the admin product editor and the bulk import.
 *
 * It keeps derived fields honest: the discount percentage, the search haystack
 * and the generated artwork are recomputed from the submitted values rather
 * than trusted from the client.
 */
export const buildSearchText = (input: {
  sku: string;
  brandName: string;
  categorySlug: string;
  names: string[];
  colorKeys: string[];
  materialKeys: string[];
  styleKey: string;
}): string =>
  [
    input.sku,
    input.brandName,
    input.categorySlug,
    input.styleKey,
    ...input.names,
    ...input.colorKeys.map((key) => Object.values(COLORS[key]?.label ?? {}).join(' ')),
    ...input.materialKeys.map((key) => Object.values(MATERIALS[key]?.label ?? {}).join(' ')),
  ]
    .join(' ')
    .toLowerCase();

const imagesFor = (artKey: string, colorKey: string, seed: number) =>
  ([0, 1, 2, 3] as ArtVariant[]).map((variant) => ({
    url: artworkUrl(artKey, colorKey, variant, seed),
    alt: '',
    sort: variant,
    isPrimary: variant === 0,
  }));

export const upsertProduct = async (
  input: ProductInput,
  productId?: string,
): Promise<{ id: string }> => {
  const [category, brand] = await Promise.all([
    prisma.category.findUniqueOrThrow({
      where: { id: input.categoryId },
      select: { slug: true, artKey: true },
    }),
    prisma.brand.findUniqueOrThrow({ where: { id: input.brandId }, select: { name: true } }),
  ]);

  const searchText = buildSearchText({
    sku: input.sku,
    brandName: brand.name,
    categorySlug: category.slug,
    names: input.translations.map((translation) => translation.name),
    colorKeys: input.colorKeys,
    materialKeys: input.materialKeys,
    styleKey: input.styleKey,
  });

  const data = {
    sku: input.sku,
    slug: input.slug,
    categoryId: input.categoryId,
    brandId: input.brandId,
    collectionId: input.collectionId ?? null,
    priceMinor: input.priceMinor,
    oldPriceMinor: input.oldPriceMinor ?? null,
    discountPct: input.oldPriceMinor ? discountPercent(input.oldPriceMinor, input.priceMinor) : 0,
    stockStatus: input.stockStatus,
    stockQty: input.stockQty,
    productionDays: input.productionDays,
    widthMm: input.widthMm ?? null,
    heightMm: input.heightMm ?? null,
    depthMm: input.depthMm ?? null,
    weightGram: input.weightGram ?? null,
    country: input.country,
    warrantyMonths: input.warrantyMonths,
    styleKey: input.styleKey,
    purposeKey: input.purposeKey,
    roomKey: input.roomKey,
    colorKeys: input.colorKeys,
    materialKeys: input.materialKeys,
    specs: input.specs as Prisma.InputJsonValue,
    isNew: input.isNew,
    isHit: input.isHit,
    isPremium: input.isPremium,
    isFeatured: input.isFeatured,
    smallSpace: input.smallSpace,
    isActive: input.isActive,
    searchText,
  };

  const images =
    input.images.length > 0
      ? input.images.map((image, index) => ({
          url: image.url,
          alt: image.alt,
          sort: index,
          isPrimary: index === 0,
        }))
      : imagesFor(
          category.artKey,
          input.colorKeys[0] ?? 'beige',
          input.sku.length + input.priceMinor,
        );

  const options = input.options.map((option, index) => ({
    kind: option.kind,
    valueKey: option.valueKey,
    label: option.label ?? null,
    priceDeltaMinor: option.priceDeltaMinor,
    isDefault: option.isDefault,
    sort: index,
  }));

  if (productId) {
    // Translations, images and options are replaced wholesale: the editor
    // submits the complete set, so diffing them would only add ways to drift.
    await prisma.$transaction([
      prisma.productTranslation.deleteMany({ where: { productId } }),
      prisma.productImage.deleteMany({ where: { productId } }),
      prisma.productOption.deleteMany({ where: { productId } }),
      prisma.product.update({
        where: { id: productId },
        data: {
          ...data,
          translations: { create: input.translations },
          images: { create: images },
          options: { create: options },
        },
      }),
    ]);
    return { id: productId };
  }

  return prisma.product.create({
    data: {
      ...data,
      translations: { create: input.translations },
      images: { create: images },
      options: { create: options },
    },
    select: { id: true },
  });
};
