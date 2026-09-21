import { prisma } from '../prisma';

/** Reference lists shared by the product editor screens. */
export const loadProductFormRefs = async () => {
  const [categories, brands, collections] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { sort: 'asc' }],
      select: {
        id: true,
        slug: true,
        parent: { select: { translations: { where: { locale: 'ru' }, select: { name: true } } } },
        translations: { where: { locale: 'ru' }, select: { name: true } },
      },
    }),
    prisma.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.collection.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: category.parent
        ? `${category.parent.translations[0]?.name ?? ''} → ${category.translations[0]?.name ?? category.slug}`
        : (category.translations[0]?.name ?? category.slug),
    })),
    brands,
    collections,
  };
};
