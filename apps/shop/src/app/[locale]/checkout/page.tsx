import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getSession } from '@/lib/auth/session';
import { Breadcrumbs } from '@/components/ui';
import { CheckoutWizard } from '@/components/checkout/checkout-wizard';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return { title: dict.checkout.title, robots: { index: false, follow: false } };
};

const CheckoutPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  // Signed-in customers get the form pre-filled; guests can still check out.
  const session = await getSession();
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.sub },
        select: { firstName: true, lastName: true, email: true, phone: true },
      })
    : null;

  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs
        items={[
          { label: dict.common.home, href: `/${locale}` },
          { label: dict.cart.title, href: `/${locale}/cart` },
          { label: dict.checkout.title },
        ]}
      />
      <h1 className="mb-6 text-[30px] md:text-[40px]">{dict.checkout.title}</h1>
      <CheckoutWizard
        locale={locale}
        dict={dict}
        profile={
          user
            ? {
                firstName: user.firstName,
                lastName: user.lastName ?? '',
                email: user.email,
                phone: user.phone ?? '',
              }
            : null
        }
      />
    </div>
  );
};

export default CheckoutPage;
