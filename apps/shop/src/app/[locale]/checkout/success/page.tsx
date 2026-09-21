import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Package } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getDictionary, isLocale, fill } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { getSession } from '@/lib/auth/session';
import { LinkButton } from '@/components/ui';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return { title: dict.checkout.stepDone, robots: { index: false, follow: false } };
};

const SuccessPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ number?: string }>;
}) => {
  const [{ locale }, { number }] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  if (!number) notFound();

  const order = await prisma.order.findUnique({
    where: { number },
    include: { items: true },
  });
  if (!order) notFound();

  const session = await getSession();

  return (
    <div className="container-page py-12 md:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <CheckCircle2 width={56} height={56} className="mx-auto text-success" strokeWidth={1.4} />
        <h1 className="mt-5 text-[30px] md:text-[38px]">
          {fill(dict.checkout.successTitle, { number: order.number })}
        </h1>
        <p className="mt-3 text-[15px] text-muted">
          {fill(dict.checkout.successText, { email: order.customerEmail })}
        </p>

        <div className="mt-8 rounded-[var(--radius-md)] border border-line bg-surface p-5 text-left">
          <ul className="space-y-3">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="h-14 w-20 rounded-[var(--radius-xs)] bg-surface-2 object-cover"
                  />
                ) : (
                  <Package width={20} height={20} />
                )}
                <span className="flex-1 text-[14px]">
                  <Link
                    href={`/${locale}/product/${item.slugSnapshot}`}
                    className="hover:text-accent"
                  >
                    {item.nameSnapshot}
                  </Link>
                  <span className="block text-[12px] text-muted">
                    {dict.common.sku}: {item.sku} · × {item.quantity}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{formatMoney(item.lineTotalMinor)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-muted">{dict.cart.delivery}</dt>
              <dd className="tabular-nums">
                {order.deliveryMinor === 0
                  ? dict.cart.freeDelivery
                  : formatMoney(order.deliveryMinor)}
              </dd>
            </div>
            {order.servicesMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted">{dict.cart.services}</dt>
                <dd className="tabular-nums">{formatMoney(order.servicesMinor)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between pt-2">
              <dt className="font-medium">{dict.cart.total}</dt>
              <dd className="text-[22px] font-semibold tabular-nums">
                {formatMoney(order.totalMinor)}
              </dd>
            </div>
            <div className="flex justify-between pt-1 text-[13px] text-muted">
              <dt>{dict.checkout.paymentMethod}</dt>
              <dd>
                {order.paymentMethod === 'CARD'
                  ? dict.checkout.card
                  : order.paymentMethod === 'CASH'
                    ? dict.checkout.cash
                    : dict.checkout.cashOnDelivery}{' '}
                · {dict.paymentStatus[order.paymentStatus]}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <LinkButton href={session ? `/${locale}/account/orders` : `/${locale}/login`}>
            {dict.checkout.successToAccount}
          </LinkButton>
          <LinkButton href={`/${locale}/catalog`} variant="outline">
            {dict.checkout.successToCatalog}
          </LinkButton>
        </div>
      </div>
    </div>
  );
};

export default SuccessPage;
