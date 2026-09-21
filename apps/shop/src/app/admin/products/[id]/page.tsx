import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { loadProductFormRefs } from '@/lib/admin/form-data';
import { AdminHeading } from '@/components/admin/ui';
import { ProductForm } from '@/components/admin/product-form';

export const dynamic = 'force-dynamic';

const AdminProductEdit = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const [product, refs] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: { translations: true, options: { orderBy: { sort: 'asc' } }, images: { orderBy: { sort: 'asc' } } },
    }),
    loadProductFormRefs(),
  ]);
  if (!product) notFound();

  return (
    <>
      <AdminHeading
        title={product.translations.find((item) => item.locale === 'ru')?.name ?? product.sku}
        subtitle={`Артикул ${product.sku}`}
        action={
          <Link href={`/ru/product/${product.slug}`} className="text-[13px] text-accent hover:underline">
            Открыть в магазине →
          </Link>
        }
      />
      <ProductForm
        categories={refs.categories}
        brands={refs.brands}
        collections={refs.collections}
        value={{
          id: product.id,
          sku: product.sku,
          slug: product.slug,
          categoryId: product.categoryId,
          brandId: product.brandId,
          collectionId: product.collectionId,
          priceMinor: product.priceMinor,
          oldPriceMinor: product.oldPriceMinor,
          stockStatus: product.stockStatus,
          stockQty: product.stockQty,
          productionDays: product.productionDays,
          widthMm: product.widthMm,
          heightMm: product.heightMm,
          depthMm: product.depthMm,
          weightGram: product.weightGram,
          country: product.country,
          warrantyMonths: product.warrantyMonths,
          styleKey: product.styleKey,
          purposeKey: product.purposeKey,
          roomKey: product.roomKey,
          colorKeys: product.colorKeys,
          materialKeys: product.materialKeys,
          specs: (product.specs ?? {}) as Record<string, string | number | boolean>,
          isNew: product.isNew,
          isHit: product.isHit,
          isPremium: product.isPremium,
          isFeatured: product.isFeatured,
          smallSpace: product.smallSpace,
          isActive: product.isActive,
          translations: product.translations.map((translation) => ({
            locale: translation.locale,
            name: translation.name,
            shortDescription: translation.shortDescription,
            description: translation.description,
          })),
          options: product.options.map((option) => ({
            kind: option.kind,
            valueKey: option.valueKey,
            label: option.label,
            priceDeltaMinor: option.priceDeltaMinor,
            isDefault: option.isDefault,
          })),
        }}
      />
    </>
  );
};

export default AdminProductEdit;
