import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategoryTree } from '@/lib/catalog/queries';
import { getDictionary, isLocale } from '@/lib/i18n';
import { CatalogPageView } from '@/components/catalog/catalog-page';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return {
    title: dict.catalog.title,
    description: dict.home.categoriesSubtitle,
    alternates: { canonical: `/${locale}/catalog` },
  };
};

const CatalogPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const tree = await getCategoryTree(locale);

  return <CatalogPageView locale={locale} dict={dict} searchParams={query} tree={tree} />;
};

export default CatalogPage;
