import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDictionary, isLocale } from '@/lib/i18n';
import { Breadcrumbs } from '@/components/ui';
import { CartView } from '@/components/cart/cart-view';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return { title: dict.cart.title, robots: { index: false, follow: false } };
};

const CartPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs
        items={[{ label: dict.common.home, href: `/${locale}` }, { label: dict.cart.title }]}
      />
      <h1 className="mb-6 text-[30px] md:text-[40px]">{dict.cart.title}</h1>
      <CartView locale={locale} dict={dict} />
    </div>
  );
};

export default CartPage;
