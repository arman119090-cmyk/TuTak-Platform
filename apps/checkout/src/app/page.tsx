import { translate } from '@/lib/i18n';

/** Without an order id there is nothing to confirm — the partner's website links to /o/<orderId>. */
export default function Home() {
  return (
    <main className="mx-auto grid max-w-[560px] gap-3 px-4 py-12">
      <h1 className="text-[22px] font-semibold">{translate('hy', 'partnerOrder.webCheckoutTitle')}</h1>
      <p className="text-[14px] text-muted">{translate('hy', 'partnerOrder.webNoOrder')}</p>
      <p className="text-[14px] text-muted">{translate('ru', 'partnerOrder.webNoOrder')}</p>
      <p className="text-[14px] text-muted">{translate('en', 'partnerOrder.webNoOrder')}</p>
    </main>
  );
}
