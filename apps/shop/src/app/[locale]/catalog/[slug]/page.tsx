import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategory } from '@/lib/catalog/queries';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n';
import { CatalogPageView } from '@/components/catalog/catalog-page';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> => {
  const { locale, slug } = await params;
  const current = isLocale(locale) ? locale : 'ru';
  const category = await getCategory(slug, current);
  if (!category) return {};
  return {
    title: category.metaTitle ?? category.name,
    description: category.metaDescription ?? category.description,
    alternates: {
      canonical: `/${current}/catalog/${slug}`,
      languages: Object.fromEntries(LOCALES.map((item) => [item, `/${item}/catalog/${slug}`])),
    },
    openGraph: {
      title: category.name,
      description: category.description,
      type: 'website',
    },
  };
};

const CategoryPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [{ locale, slug }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const category = await getCategory(slug, locale);
  if (!category) notFound();

  return <CatalogPageView locale={locale} dict={dict} searchParams={query} category={category} />;
};

export default CategoryPage;
