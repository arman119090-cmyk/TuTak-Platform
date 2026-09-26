'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Surface } from '@tutak/design/web';
import { computeCheckoutSplit, parseCheckoutAmount } from '@tutak/shared-types';
import { apiErrorMessage, appCheckoutUrl, checkoutApi } from '@/lib/api/checkoutApi';
import type { SupportedLocale } from '@/lib/i18n';
import { translate } from '@/lib/i18n';

const amd = (v: string | number) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }).replace(/,/g, ' ')} ֏`;

/**
 * Order review → how to pay → explicit «Подтвердить заказ», against the very
 * endpoints the app uses (Q12). Nothing is charged before that tap; the
 * idempotency key is the same shape as the app's, so a retried confirmation
 * — from here or from the app — is one order and one charge. The discount
 * and TuTak money stay two separate balances; only TuTak money covers a
 * required prepayment (Q13).
 */
export function CheckoutView({ orderId, locale }: { orderId: string; locale: SupportedLocale }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
  const queryClient = useQueryClient();
  const [discount, setDiscount] = useState('');
  const [money, setMoney] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: checkout, isLoading, isError } = useQuery({
    queryKey: ['checkout', orderId],
    queryFn: () => checkoutApi.getCheckout(orderId),
    retry: false,
  });

  const split = computeCheckoutSplit({
    total: Number(checkout?.order.totalAmount ?? 0),
    discountAvailable: Number(checkout?.balances.discountAvailable ?? 0),
    maxDiscountAmount: Number(checkout?.limits.maxDiscountAmount ?? 0),
    moneyBalance: Number(checkout?.balances.tutakMoney ?? 0),
    prepaymentRequired: Number(checkout?.limits.prepaymentRequiredAmount ?? 0),
    discountInput: parseCheckoutAmount(discount),
    moneyInput: parseCheckoutAmount(money),
  });

  const submit = useMutation({
    mutationFn: () =>
      checkoutApi.submit(orderId, {
        discountAmount: split.discount ? String(split.discount) : undefined,
        tutakMoneyAmount: split.money ? String(split.money) : undefined,
        // Same key shape as the app: the same choice retried is the same request.
        idempotencyKey: `checkout-${orderId}-${split.discount}-${split.money}`,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['checkout', orderId] });
    },
    onError: (err) => setError(apiErrorMessage(err, t('common.somethingWentWrong'))),
  });

  if (isLoading) return <Surface>{t('common.loading')}</Surface>;
  if (isError || !checkout) return <Surface>{t('partnerOrder.webOrderUnavailable')}</Surface>;

  const { order } = checkout;
  const prepayment = Number(checkout.limits.prepaymentRequiredAmount);
  const confirmed = order.submittedAt !== null;

  return (
    <div className="grid gap-4">
      <Surface>
        <div className="flex items-center justify-between text-[13px] text-muted">
          <span>{t('partnerOrder.fromPartner')}: {checkout.partner.displayName}</span>
          <span>
            {t('partnerOrder.orderNumberLabel')} #{order.orderNumber}
          </span>
        </div>
        <ul className="mt-3 grid gap-1 text-[14px] text-ink">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>
                {item.quantity}× {item.name}
              </span>
              <span>{amd(item.totalPrice)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between text-[18px] font-semibold text-ink">
          <span>{t('partnerOrder.totalLabel')}</span>
          <span data-testid="total">{amd(order.totalAmount)}</span>
        </div>
      </Surface>

      {confirmed ? (
        <Surface>
          <div className="text-[15px] text-ink" data-testid="confirmed">
            {t('partnerOrder.confirmedNotice')}
          </div>
        </Surface>
      ) : (
        <>
          {prepayment > 0 ? (
            <Surface>
              <div className="text-[14px] text-ink">{t('partnerOrder.prepaymentNotice', { amount: amd(prepayment) })}</div>
              <div className="mt-1 text-[12px] text-muted">{t('partnerOrder.prepaymentMoneyOnly')}</div>
            </Surface>
          ) : null}
          {checkout.cancellationTerms ? (
            <Surface>
              <div className="text-[13px] text-muted">{t('partnerOrder.cancellationTerms', { terms: checkout.cancellationTerms })}</div>
            </Surface>
          ) : null}
          <Surface>
            <div className="text-[15px] font-semibold text-ink">{t('partnerOrder.howToPay')}</div>
            <label className="mt-3 grid gap-1 text-[13px] text-muted">
              {t('partnerOrder.discountLabel')}
              <Input aria-label={t('partnerOrder.discountLabel')} value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" placeholder="0" />
              <span className="text-[12px]">
                {t('partnerOrder.discountHint', {
                  amount: amd(checkout.balances.discountAvailable),
                  max: amd(Math.min(Number(checkout.limits.maxDiscountAmount), Number(checkout.balances.discountAvailable), Number(order.totalAmount))),
                })}
              </span>
            </label>
            <label className="mt-3 grid gap-1 text-[13px] text-muted">
              {t('partnerOrder.moneyLabel')}
              <Input aria-label={t('partnerOrder.moneyLabel')} value={money} onChange={(e) => setMoney(e.target.value)} inputMode="numeric" placeholder="0" />
              <span className="text-[12px]">{t('partnerOrder.moneyHint', { amount: amd(checkout.balances.tutakMoney) })}</span>
            </label>
            <div className="mt-3 flex justify-between text-[14px] text-ink">
              <span>{t('partnerOrder.externalLabel')}</span>
              <span data-testid="external">{amd(split.external)}</span>
            </div>
            <div className="text-[12px] text-muted">{t('partnerOrder.externalHint')}</div>
          </Surface>

          {split.missingMoney > 0 ? (
            <div className="text-[13px] text-danger-text">{t('partnerOrder.missingMoney', { amount: amd(split.missingMoney) })}</div>
          ) : null}
          {split.prepaymentShort > 0 ? (
            <div className="text-[13px] text-danger-text" data-testid="prepayment-short">
              {t('partnerOrder.prepaymentShort', { amount: amd(split.prepaymentShort) })}
            </div>
          ) : null}
          {error ? <div className="text-[13px] text-danger-text">{error}</div> : null}

          <div className="text-[12px] text-muted">{t('partnerOrder.loginIsNotConsent')}</div>
          <Button disabled={!split.canConfirm} loading={submit.isPending} onClick={() => submit.mutate()}>
            {t('partnerOrder.confirmButton')}
          </Button>
        </>
      )}

      <Surface>
        <div className="text-[12px] text-muted">{t('partnerOrder.webAppOptional')}</div>
        <a className="mt-2 inline-block text-[14px] font-medium text-primary underline" href={appCheckoutUrl(orderId)}>
          {t('partnerOrder.webOpenInApp')}
        </a>
      </Surface>
    </div>
  );
}
