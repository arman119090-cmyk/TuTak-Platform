import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDictionary, isLocale } from '@/lib/i18n';
import { Breadcrumbs } from '@/components/ui';
import { CompareView } from '@/components/catalog/compare-view';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return { title: dict.compare.title, robots: { index: false, follow: true } };
};

const ComparePage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs
        items={[{ label: dict.common.home, href: `/${locale}` }, { label: dict.compare.title }]}
      />
      <h1 className="mb-6 text-[30px] md:text-[40px]">{dict.compare.title}</h1>
      <CompareView locale={locale} dict={dict} />
    </div>
  );
};

export default ComparePage;
