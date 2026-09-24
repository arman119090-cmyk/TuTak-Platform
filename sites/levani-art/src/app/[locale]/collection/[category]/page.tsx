import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CollectionView } from '@/components/CollectionView';
import { getArtworksByCategory, getPopulatedCategories } from '@/content/catalog';
import { categories, type Category } from '@/content/types';
import { locales } from '@/i18n/config';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.flatMap((locale) => getPopulatedCategories().map((category) => ({ locale, category })));
}

async function resolve(params: PageProps<'/[locale]/collection/[category]'>['params']) {
  const { category } = await params;
  const { locale, dict } = await resolveLocale(params);
  if (!(categories as readonly string[]).includes(category)) notFound();
  return { locale, dict, category: category as Category };
}

export async function generateMetadata({ params }: PageProps<'/[locale]/collection/[category]'>): Promise<Metadata> {
  const { locale, dict, category } = await resolve(params);
  return pageMetadata({
    locale,
    path: `/collection/${category}`,
    title: dict.categories[category],
    description: dict.categoryIntro[category],
  });
}

export default async function CategoryPage({ params }: PageProps<'/[locale]/collection/[category]'>) {
  const { locale, dict, category } = await resolve(params);
  return (
    <CollectionView locale={locale} dict={dict} active={category} items={getArtworksByCategory(category)} />
  );
}
