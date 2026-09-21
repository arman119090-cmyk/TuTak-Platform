import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDictionary, isLocale } from '@/lib/i18n';
import { Breadcrumbs } from '@/components/ui';
import { CatalogPageView } from '@/components/catalog/catalog-page';

export const generateMetadata = async ({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> => {
  const [{ locale }, { q }] = await Promise.all([params, searchParams]);
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return {
    title: q ? `${dict.search.resultsFor} «${q}»` : dict.search.title,
    robots: { index: false, follow: true },
  };
};

const SearchPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const term = typeof query.q === 'string' ? query.q : '';

  return (
    <div>
      <div className="container-page pt-6">
        <Breadcrumbs items={[{ label: dict.common.home, href: `/${locale}` }, { label: dict.search.title }]} />
      </div>
      <CatalogPageView
        locale={locale}
        dict={dict}
        searchParams={query}
        title={term ? `${dict.search.resultsFor} «${term}»` : dict.search.title}
      />
    </div>
  );
};

export default SearchPage;
