import { prisma } from '@/lib/prisma';
import { AdminHeading } from '@/components/admin/ui';
import { TaxonomyManager } from '@/components/admin/taxonomy-manager';

export const dynamic = 'force-dynamic';

const AdminTaxonomy = async () => {
  const [categories, brands, collections] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ sort: 'asc' }],
      include: {
        translations: { where: { locale: 'ru' } },
        parent: { include: { translations: { where: { locale: 'ru' } } } },
        _count: { select: { products: true } },
      },
    }),
    prisma.brand.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } }),
    prisma.collection.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } }),
  ]);

  return (
    <>
      <AdminHeading title="Категории, бренды и коллекции" subtitle="Структура каталога" />
      <TaxonomyManager
        categories={categories.map((category) => ({
          id: category.id,
          slug: category.slug,
          name: category.translations[0]?.name ?? category.slug,
          parentName: category.parent?.translations[0]?.name ?? null,
          productCount: category._count.products,
          isActive: category.isActive,
        }))}
        brands={brands.map((brand) => ({
          id: brand.id,
          slug: brand.slug,
          name: brand.name,
          country: brand.country,
          productCount: brand._count.products,
        }))}
        collections={collections.map((collection) => ({
          id: collection.id,
          slug: collection.slug,
          name: collection.name,
          productCount: collection._count.products,
        }))}
      />
    </>
  );
};

export default AdminTaxonomy;
