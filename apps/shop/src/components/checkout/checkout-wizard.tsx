'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CreditCard, Loader2, Store, Truck, Wallet } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { fill } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { DELIVERY_SLOTS, PICKUP_POINTS, REGIONS, SERVICES } from '@/config/site';
import { isDemoMode } from '@/config/brand';
import type { Quote } from '@/lib/pricing/types';
import { Alert, Button, Checkbox, EmptyState, Field, Input, LinkButton, Select, Textarea } from '@/components/ui';
import { useStore } from '@/components/providers/store-provider';
import { cn } from '@/lib/utils';

type StepKey = 'contacts' | 'address' | 'delivery' | 'services' | 'payment' | 'review';

type Form = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  region: string;
  city: string;
  street: string;
  building: string;
  apartment: string;
  entrance: string;
  floor: string;
  hasLift: boolean;
  method: 'DELIVERY' | 'PICKUP';
  pickupPoint: string;
  slot: string;
  comment: string;
  lift: boolean;
  assembly: boolean;
  doorInstall: boolean;
  payment: 'CARD' | 'CASH' | 'CASH_ON_DELIVERY';
  cardNumber: string;
  cardHolder: string;
  cardExpiry: string;
  cardCvc: string;
};

const PHONE_RE = /^(\+374|0)\d{8}$/;

/**
 * Seven-step checkout.
 *
 * Each step validates before it lets the customer move on, the order summary
 * re-quotes from the server whenever delivery or services change, and the final
 * POST is re-priced server-side again — the numbers on this screen are a
 * preview of the server's answer, never the input to it.
 */
export const CheckoutWizard = ({
  locale,
  dict,
  profile,
}: {
  locale: Locale;
  dict: Dictionary;
  profile: { firstName: string; lastName: string; email: string; phone: string } | null;
}) => {
  const router = useRouter();
  const { cart, ready, promoCode, clearCart, toast } = useStore();
  const [step, setStep] = useState<StepKey>('contacts');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [demoOutcome, setDemoOutcome] = useState<'SUCCESS' | 'FAILURE'>('SUCCESS');

  const [form, setForm] = useState<Form>({
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    phone: profile?.phone ?? '',
    email: profile?.email ?? '',
    region: 'yerevan',
    city: 'Кентрон',
    street: '',
    building: '',
    apartment: '',
    entrance: '',
    floor: '',
    hasLift: true,
    method: 'DELIVERY',
    pickupPoint: PICKUP_POINTS[0]!.key,
    slot: DELIVERY_SLOTS[0]!.key,
    comment: '',
    lift: false,
    assembly: false,
    doorInstall: false,
    payment: 'CARD',
    cardNumber: '',
    cardHolder: '',
    cardExpiry: '',
    cardCvc: '',
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const steps: { key: StepKey; label: string }[] = useMemo(
    () => [
      { key: 'contacts', label: dict.checkout.stepContacts },
      { key: 'address', label: dict.checkout.stepAddress },
      { key: 'delivery', label: dict.checkout.stepDelivery },
      { key: 'services', label: dict.checkout.stepServices },
      { key: 'payment', label: dict.checkout.stepPayment },
      { key: 'review', label: dict.checkout.stepReview },
    ],
    [dict],
  );
  const stepIndex = steps.findIndex((item) => item.key === step);

  const refreshQuote = useCallback(async () => {
    if (cart.length === 0) return;
    const response = await fetch('/api/cart/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          options: line.options,
          doorConfig: line.doorConfig,
        })),
        promoCode,
        locale,
        delivery: {
          method: form.method,
          regionKey: form.region,
          floor: form.floor ? Number(form.floor) : 0,
          hasLift: form.hasLift,
        },
        services: { lift: form.lift, assembly: form.assembly, doorInstall: form.doorInstall },
      }),
    });
    if (response.ok) setQuote((await response.json()) as Quote);
  }, [cart, promoCode, locale, form.method, form.region, form.floor, form.hasLift, form.lift, form.assembly, form.doorInstall]);

  useEffect(() => {
    if (!ready) return;
    void refreshQuote();
  }, [ready, refreshQuote]);

  const hasDoors = quote?.lines.some((line) => line.isDoor) ?? false;

  const validate = (target: StepKey): boolean => {
    const next: Record<string, string> = {};
    if (target === 'contacts') {
      if (form.firstName.trim().length < 2) next.firstName = dict.forms.tooShort;
      if (!PHONE_RE.test(form.phone.replace(/[\s()-]/g, ''))) next.phone = dict.forms.invalidPhone;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = dict.forms.invalidEmail;
    }
    if (target === 'address' && form.method === 'DELIVERY') {
      if (form.street.trim().length < 2) next.street = dict.forms.tooShort;
      if (form.building.trim().length < 1) next.building = dict.forms.tooShort;
      if (form.city.trim().length < 2) next.city = dict.forms.tooShort;
    }
    if (target === 'payment' && form.payment === 'CARD' && isDemoMode) {
      // Demo card fields are optional on purpose — nothing is transmitted.
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const go = (target: StepKey) => {
    const order: StepKey[] = steps.map((item) => item.key);
    const targetIndex = order.indexOf(target);
    // Validate everything between here and the step the customer jumped to.
    for (let i = 0; i < targetIndex; i += 1) {
      if (!validate(order[i]!)) {
        setStep(order[i]!);
        return;
      }
    }
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    setSubmitting(true);
    setPaymentError(null);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            options: line.options,
            doorConfig: line.doorConfig,
          })),
          promoCode,
          locale,
          contacts: {
            firstName: form.firstName,
            lastName: form.lastName,
            phone: form.phone,
            email: form.email,
          },
          delivery: {
            method: form.method,
            regionKey: form.region,
            city: form.city,
            street: form.street,
            building: form.building,
            apartment: form.apartment,
            entrance: form.entrance,
            floor: form.floor ? Number(form.floor) : null,
            hasLift: form.hasLift,
            pickupPoint: form.method === 'PICKUP' ? form.pickupPoint : null,
            slot: form.slot,
            comment: form.comment,
          },
          services: { lift: form.lift, assembly: form.assembly, doorInstall: form.doorInstall },
          payment: {
            method: form.payment,
            demoOutcome: form.payment === 'CARD' ? demoOutcome : undefined,
          },
        }),
      });

      if (response.status === 402) {
        setPaymentError(dict.checkout.paymentFailed);
        setStep('payment');
        setSubmitting(false);
        return;
      }
      if (!response.ok) {
        toast(dict.forms.errorText, 'error');
        setSubmitting(false);
        return;
      }

      const data = (await response.json()) as { number: string };
      clearCart();
      router.push(`/${locale}/checkout/success?number=${encodeURIComponent(data.number)}`);
    } catch {
      toast(dict.forms.errorText, 'error');
      setSubmitting(false);
    }
  };

  if (ready && cart.length === 0) {
    return (
      <EmptyState
        title={dict.cart.empty}
        text={dict.cart.emptyText}
        action={<LinkButton href={`/${locale}/catalog`}>{dict.cart.toCatalog}</LinkButton>}
      />
    );
  }

  const region = REGIONS.find((item) => item.key === form.region);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div>
        {/* step indicator */}
        <ol className="hide-scrollbar mb-7 flex gap-1 overflow-x-auto pb-1">
          {steps.map((item, index) => (
            <li key={item.key} className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => go(item.key)}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-full px-3 text-[13px] transition-colors',
                  index === stepIndex
                    ? 'bg-ink text-white'
                    : index < stepIndex
                      ? 'bg-success-soft text-success'
                      : 'text-muted hover:bg-surface-2',
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] tabular-nums">
                  {index < stepIndex ? <Check width={12} height={12} /> : index + 1}
                </span>
                {item.label}
              </button>
              {index < steps.length - 1 ? <span className="text-line-strong">·</span> : null}
            </li>
          ))}
        </ol>

        <div className="rounded-[var(--radius-md)] border border-line bg-surface p-5 md:p-6">
          {step === 'contacts' ? (
            <div className="space-y-4">
              <h2 className="text-[20px]">{dict.checkout.stepContacts}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={dict.checkout.firstName} required error={errors.firstName}>
                  <Input value={form.firstName} onChange={(event) => set('firstName', event.target.value)} />
                </Field>
                <Field label={dict.checkout.lastName}>
                  <Input value={form.lastName} onChange={(event) => set('lastName', event.target.value)} />
                </Field>
                <Field label={dict.checkout.phone} required error={errors.phone} hint="+374 XX XXX XXX">
                  <Input
                    type="tel"
                    placeholder="+374 XX XXX XXX"
                    value={form.phone}
                    onChange={(event) => set('phone', event.target.value)}
                  />
                </Field>
                <Field label={dict.checkout.email} required error={errors.email}>
                  <Input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
                </Field>
              </div>
            </div>
          ) : null}

          {step === 'address' ? (
            <div className="space-y-4">
              <h2 className="text-[20px]">{dict.checkout.stepAddress}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['DELIVERY', 'PICKUP'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => set('method', method)}
                    className={cn(
                      'flex items-start gap-3 rounded-[var(--radius-sm)] border p-4 text-left transition-colors',
                      form.method === method ? 'border-ink bg-surface-2' : 'border-line hover:border-ink',
                    )}
                  >
                    {method === 'DELIVERY' ? <Truck width={20} height={20} /> : <Store width={20} height={20} />}
                    <span>
                      <span className="block text-[14px] font-medium">
                        {method === 'DELIVERY' ? dict.checkout.courier : dict.checkout.pickup}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-muted">
                        {method === 'DELIVERY'
                          ? `${formatMoney(region?.deliveryMinor ?? 5000)} · ${region?.deliveryDays ?? 1} ${dict.common.days}`
                          : dict.cart.freeDelivery}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              {form.method === 'DELIVERY' ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={dict.checkout.region} required>
                      <Select value={form.region} onChange={(event) => set('region', event.target.value)}>
                        {REGIONS.map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.names[locale]} · {formatMoney(item.deliveryMinor)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={dict.checkout.city} required error={errors.city}>
                      <Select value={form.city} onChange={(event) => set('city', event.target.value)}>
                        {(REGIONS.find((item) => item.key === form.region)?.cities ?? []).map((city) => (
                          <option key={city.ru} value={city.ru}>
                            {city[locale]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                    <Field label={dict.checkout.street} required error={errors.street}>
                      <Input value={form.street} onChange={(event) => set('street', event.target.value)} />
                    </Field>
                    <Field label={dict.checkout.building} required error={errors.building}>
                      <Input value={form.building} onChange={(event) => set('building', event.target.value)} />
                    </Field>
                    <Field label={dict.checkout.apartment}>
                      <Input value={form.apartment} onChange={(event) => set('apartment', event.target.value)} />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={dict.checkout.entrance}>
                      <Input value={form.entrance} onChange={(event) => set('entrance', event.target.value)} />
                    </Field>
                    <Field label={dict.checkout.floor}>
                      <Input
                        inputMode="numeric"
                        value={form.floor}
                        onChange={(event) => set('floor', event.target.value.replace(/\D/g, ''))}
                      />
                    </Field>
                    <div className="flex items-end pb-1">
                      <Checkbox
                        label={dict.checkout.hasLift}
                        checked={form.hasLift}
                        onChange={(event) => set('hasLift', event.target.checked)}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <Field label={dict.checkout.pickupPoint}>
                  <Select value={form.pickupPoint} onChange={(event) => set('pickupPoint', event.target.value)}>
                    {PICKUP_POINTS.map((point) => (
                      <option key={point.key} value={point.key}>
                        {point.names[locale]} · {point.hours}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          ) : null}

          {step === 'delivery' ? (
            <div className="space-y-4">
              <h2 className="text-[20px]">{dict.checkout.stepDelivery}</h2>
              {form.method === 'DELIVERY' ? (
                <>
                  <Field label={dict.checkout.deliverySlot}>
                    <Select value={form.slot} onChange={(event) => set('slot', event.target.value)}>
                      {DELIVERY_SLOTS.map((slot) => (
                        <option key={slot.key} value={slot.key}>
                          {slot.names[locale]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Alert tone="info">
                    {region?.names[locale]} — {formatMoney(region?.deliveryMinor ?? 0)},{' '}
                    {region?.deliveryDays} {dict.common.days}
                  </Alert>
                </>
              ) : (
                <Alert tone="info">{PICKUP_POINTS.find((point) => point.key === form.pickupPoint)?.names[locale]}</Alert>
              )}
              <Field label={dict.checkout.comment}>
                <Textarea value={form.comment} onChange={(event) => set('comment', event.target.value)} />
              </Field>
            </div>
          ) : null}

          {step === 'services' ? (
            <div className="space-y-3">
              <h2 className="text-[20px]">{dict.checkout.services}</h2>
              <Checkbox
                label={`${SERVICES.lift.names[locale]} — ${formatMoney(SERVICES.lift.priceMinor)}`}
                description={SERVICES.lift.hint[locale]}
                checked={form.lift}
                disabled={form.method === 'PICKUP'}
                onChange={(event) => set('lift', event.target.checked)}
              />
              <Checkbox
                label={`${SERVICES.assembly.names[locale]} — ${formatMoney(SERVICES.assembly.priceMinor)}`}
                description={SERVICES.assembly.hint[locale]}
                checked={form.assembly}
                onChange={(event) => set('assembly', event.target.checked)}
              />
              {hasDoors ? (
                <Checkbox
                  label={`${SERVICES.doorInstall.names[locale]} — ${formatMoney(SERVICES.doorInstall.priceMinor)}`}
                  description={SERVICES.doorInstall.hint[locale]}
                  checked={form.doorInstall}
                  onChange={(event) => set('doorInstall', event.target.checked)}
                />
              ) : null}
            </div>
          ) : null}

          {step === 'payment' ? (
            <div className="space-y-4">
              <h2 className="text-[20px]">{dict.checkout.paymentMethod}</h2>
              <div className="grid gap-3">
                {(
                  [
                    { key: 'CARD', label: dict.checkout.card, icon: CreditCard },
                    { key: 'CASH', label: dict.checkout.cash, icon: Store },
                    { key: 'CASH_ON_DELIVERY', label: dict.checkout.cashOnDelivery, icon: Wallet },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => set('payment', option.key)}
                    className={cn(
                      'flex items-center gap-3 rounded-[var(--radius-sm)] border p-4 text-left transition-colors',
                      form.payment === option.key ? 'border-ink bg-surface-2' : 'border-line hover:border-ink',
                    )}
                  >
                    <option.icon width={20} height={20} />
                    <span className="text-[14px]">{option.label}</span>
                  </button>
                ))}
              </div>

              {form.payment === 'CARD' ? (
                <div className="rounded-[var(--radius-sm)] border border-line p-4">
                  <Alert tone="warning">{dict.checkout.cardDemoNote}</Alert>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label={dict.checkout.cardNumber}>
                      <Input
                        inputMode="numeric"
                        placeholder="4111 1111 1111 1111"
                        value={form.cardNumber}
                        onChange={(event) => set('cardNumber', event.target.value)}
                      />
                    </Field>
                    <Field label={dict.checkout.cardHolder}>
                      <Input value={form.cardHolder} onChange={(event) => set('cardHolder', event.target.value)} />
                    </Field>
                    <Field label={dict.checkout.cardExpiry}>
                      <Input placeholder="12/28" value={form.cardExpiry} onChange={(event) => set('cardExpiry', event.target.value)} />
                    </Field>
                    <Field label={dict.checkout.cardCvc}>
                      <Input placeholder="123" value={form.cardCvc} onChange={(event) => set('cardCvc', event.target.value)} />
                    </Field>
                  </div>
                  {isDemoMode ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(
                        [
                          { key: 'SUCCESS', label: dict.checkout.payDemoSuccess },
                          { key: 'FAILURE', label: dict.checkout.payDemoFail },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setDemoOutcome(option.key)}
                          className={cn(
                            'h-10 rounded-[var(--radius-sm)] border px-3 text-[13px]',
                            demoOutcome === option.key
                              ? option.key === 'SUCCESS'
                                ? 'border-success bg-success-soft text-success'
                                : 'border-sale text-sale'
                              : 'border-line',
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {paymentError ? <Alert tone="error">{paymentError}</Alert> : null}
            </div>
          ) : null}

          {step === 'review' ? (
            <div className="space-y-5">
              <h2 className="text-[20px]">{dict.checkout.review}</h2>
              <Alert tone="warning">{dict.checkout.demoWarning}</Alert>

              <dl className="space-y-3 text-[14px]">
                {[
                  {
                    label: dict.checkout.stepContacts,
                    value: `${form.firstName} ${form.lastName}, ${form.phone}, ${form.email}`,
                    step: 'contacts' as StepKey,
                  },
                  {
                    label: dict.checkout.stepAddress,
                    value:
                      form.method === 'PICKUP'
                        ? PICKUP_POINTS.find((point) => point.key === form.pickupPoint)?.names[locale] ?? ''
                        : `${region?.names[locale]}, ${form.city}, ${form.street} ${form.building}${form.apartment ? `, ${dict.checkout.apartment} ${form.apartment}` : ''}`,
                    step: 'address' as StepKey,
                  },
                  {
                    label: dict.checkout.stepServices,
                    value:
                      [
                        form.lift ? SERVICES.lift.names[locale] : null,
                        form.assembly ? SERVICES.assembly.names[locale] : null,
                        form.doorInstall ? SERVICES.doorInstall.names[locale] : null,
                      ]
                        .filter(Boolean)
                        .join(', ') || '—',
                    step: 'services' as StepKey,
                  },
                  {
                    label: dict.checkout.paymentMethod,
                    value:
                      form.payment === 'CARD'
                        ? dict.checkout.card
                        : form.payment === 'CASH'
                          ? dict.checkout.cash
                          : dict.checkout.cashOnDelivery,
                    step: 'payment' as StepKey,
                  },
                ].map((row) => (
                  <div key={row.label} className="flex flex-wrap items-baseline gap-x-3 border-b border-line pb-3">
                    <dt className="min-w-[130px] text-muted">{row.label}</dt>
                    <dd className="flex-1">{row.value}</dd>
                    <button type="button" onClick={() => setStep(row.step)} className="text-[13px] text-accent hover:underline">
                      {dict.checkout.editStep}
                    </button>
                  </div>
                ))}
              </dl>

              <ul className="space-y-2">
                {(quote?.lines ?? []).map((line) => (
                  <li key={`${line.productId}-${JSON.stringify(line.options)}`} className="flex items-center gap-3 text-[13px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={line.imageUrl} alt="" className="h-12 w-16 rounded-[var(--radius-xs)] bg-surface-2 object-cover" />
                    <span className="flex-1">{line.name}</span>
                    <span className="text-muted tabular-nums">× {line.quantity}</span>
                    <span className="font-medium tabular-nums">{formatMoney(line.lineTotalMinor)}</span>
                  </li>
                ))}
              </ul>

              <p className="text-[12px] text-muted">{dict.checkout.agreeOffer}</p>
              <Button size="lg" className="w-full" onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 width={17} height={17} className="animate-spin" /> : null}
                {submitting ? dict.checkout.processing : dict.checkout.placeOrder}
              </Button>
            </div>
          ) : null}

          {step !== 'review' ? (
            <div className="mt-6 flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                onClick={() => setStep(steps[Math.max(0, stepIndex - 1)]!.key)}
                disabled={stepIndex === 0}
              >
                {dict.common.back}
              </Button>
              <Button
                size="lg"
                onClick={() => {
                  if (validate(step)) go(steps[stepIndex + 1]!.key);
                }}
              >
                {dict.common.next}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <aside className="lg:sticky lg:top-[170px] lg:self-start">
        <div className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
          <h2 className="text-[19px]">{dict.checkout.yourOrder}</h2>
          <dl className="mt-4 space-y-2 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-muted">{dict.cart.subtotal}</dt>
              <dd className="tabular-nums">{quote ? formatMoney(quote.subtotalMinor) : '—'}</dd>
            </div>
            {quote && quote.promoDiscountMinor > 0 ? (
              <div className="flex justify-between text-success">
                <dt>{dict.cart.promoDiscount}</dt>
                <dd className="tabular-nums">−{formatMoney(quote.promoDiscountMinor)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted">{dict.cart.delivery}</dt>
              <dd className="tabular-nums">
                {quote ? (quote.deliveryIsFree ? dict.cart.freeDelivery : formatMoney(quote.deliveryMinor)) : '—'}
              </dd>
            </div>
            {quote && quote.servicesMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted">{dict.cart.services}</dt>
                <dd className="tabular-nums">{formatMoney(quote.servicesMinor)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-medium">{dict.cart.total}</dt>
              <dd className="text-[24px] font-semibold tabular-nums">
                {quote ? formatMoney(quote.totalMinor) : '—'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] text-muted">
            {fill(dict.footer.workHours, { weekdays: '10:00 — 20:00', weekend: '11:00 — 18:00' })}
          </p>
        </div>
      </aside>
    </div>
  );
};
