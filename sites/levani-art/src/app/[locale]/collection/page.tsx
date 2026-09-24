import type { Metadata } from 'next';
import { CollectionView } from '@/components/CollectionView';
import { getArtworks } from '@/content/catalog';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/collection'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return pageMetadata({
    locale,
    path: '/collection',
    title: dict.meta.collection,
    description: dict.meta.collectionDescription,
  });
}

export default async function CollectionPage({ params }: PageProps<'/[locale]/collection'>) {
  const { locale, dict } = await resolveLocale(params);
  return <CollectionView locale={locale} dict={dict} active="all" items={getArtworks()} />;
}
