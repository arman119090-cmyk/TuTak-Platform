import { CheckoutGate } from '@/components/CheckoutGate';

/**
 * `/o/<orderId>` — where a partner's website sends the customer after it
 * created the order server-to-server (the API's create response carries this
 * URL as `checkoutUrl` when CHECKOUT_WEB_BASE_URL is configured).
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { orderId } = await params;
  const { lang } = await searchParams;
  return <CheckoutGate orderId={orderId} initialLocale={lang ?? null} />;
}
