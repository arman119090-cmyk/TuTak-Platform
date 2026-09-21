import { loadProductFormRefs } from '@/lib/admin/form-data';
import { AdminHeading } from '@/components/admin/ui';
import { ProductForm } from '@/components/admin/product-form';

export const dynamic = 'force-dynamic';

const AdminProductCreate = async () => {
  const refs = await loadProductFormRefs();
  const suffix = Date.now().toString(36).toUpperCase().slice(-5);

  return (
    <>
      <AdminHeading
        title="Новый товар"
        subtitle="Заполните карточку — изображения сгенерируются автоматически"
      />
      <ProductForm
        categories={refs.categories}
        brands={refs.brands}
        collections={refs.collections}
        value={{
          sku: `NEW-${suffix}`,
          slug: `new-product-${suffix.toLowerCase()}`,
          categoryId: refs.categories[0]?.id ?? '',
          brandId: refs.brands[0]?.id ?? '',
          collectionId: null,
          priceMinor: 100_000,
          oldPriceMinor: null,
          stockStatus: 'IN_STOCK',
          stockQty: 1,
          productionDays: 0,
          widthMm: 1000,
          heightMm: 800,
          depthMm: 600,
          weightGram: 20_000,
          country: 'AM',
          warrantyMonths: 24,
          styleKey: 'modern',
          purposeKey: 'home',
          roomKey: 'living',
          colorKeys: ['beige'],
          materialKeys: ['mdf'],
          specs: {},
          isNew: true,
          isHit: false,
          isPremium: false,
          isFeatured: false,
          smallSpace: false,
          isActive: true,
          translations: [
            { locale: 'ru', name: '', shortDescription: '', description: '' },
            { locale: 'hy', name: '', shortDescription: '', description: '' },
            { locale: 'en', name: '', shortDescription: '', description: '' },
          ],
          options: [],
        }}
      />
    </>
  );
};

export default AdminProductCreate;
