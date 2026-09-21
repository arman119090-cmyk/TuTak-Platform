'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { STYLES, COLORS, SPEC_VALUES } from '@/data/attributes';
import type { Dictionary, Locale } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import {
  estimateKitchen,
  MAX_KITCHEN_LENGTH_M,
  MIN_KITCHEN_LENGTH_M,
  type KitchenFacade,
  type KitchenShape,
} from '@/lib/pricing/kitchen';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useStore } from '@/components/providers/store-provider';

const FACADES: KitchenFacade[] = ['plasticHpl', 'frameMdf', 'matteLacquer', 'glossLacquer', 'veneer'];
const COLOR_KEYS = ['white', 'ivory', 'beige', 'olive', 'graphite', 'anthracite', 'oak', 'navy'];
const STYLE_KEYS = ['modern', 'minimal', 'scandi', 'classic', 'neoclassic', 'loft'];
const BUDGETS = ['до 1 000 000 ֏', '1 000 000 — 1 500 000 ֏', '1 500 000 — 2 500 000 ֏', 'от 2 500 000 ֏'];

/** The "Рассчитать кухню" flow: seven answers, a live estimate and a lead. */
export const KitchenCalculator = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const { toast } = useStore();
  const [form, setForm] = useState({
    length: '3.5',
    shape: 'lShaped' as KitchenShape,
    style: 'modern',
    color: 'white',
    facade: 'matteLacquer' as KitchenFacade,
    budget: BUDGETS[1]!,
    comment: '',
    name: '',
    phone: '',
  });
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const estimate = useMemo(
    () =>
      estimateKitchen({
        lengthM: Number(form.length) || MIN_KITCHEN_LENGTH_M,
        shape: form.shape,
        facade: form.facade,
      }),
    [form.length, form.shape, form.facade],
  );

  const shapes: { key: KitchenShape; label: string }[] = [
    { key: 'straight', label: dict.kitchen.shapeStraight },
    { key: 'lShaped', label: dict.kitchen.shapeL },
    { key: 'uShaped', label: dict.kitchen.shapeU },
    { key: 'island', label: dict.kitchen.shapeIsland },
  ];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('loading');
    setError(null);
    const response = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'KITCHEN',
        name: form.name,
        phone: form.phone,
        comment: form.comment,
        locale,
        payload: {
          length: Number(form.length),
          shape: form.shape,
          style: form.style,
          color: form.color,
          facade: form.facade,
          budget: form.budget,
          estimateFromMinor: estimate.fromMinor,
          estimateToMinor: estimate.toMinor,
        },
      }),
    });
    if (response.ok) {
      setState('done');
      toast(dict.toast.requestSent);
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(data.error === 'invalid_phone' ? dict.forms.invalidPhone : dict.forms.errorText);
    setState('idle');
  };

  if (state === 'done') {
    return (
      <div className="rounded-[var(--radius-md)] border border-line bg-surface p-8 text-center">
        <CheckCircle2 width={48} height={48} className="mx-auto text-success" strokeWidth={1.4} />
        <h2 className="mt-4 text-[24px]">{dict.kitchen.successTitle}</h2>
        <p className="mt-2 text-sm text-muted">{dict.kitchen.successText}</p>
        <p className="mt-5 text-[15px]">
          {dict.kitchen.estimateTitle}:{' '}
          <span className="font-semibold">
            {formatMoney(estimate.fromMinor)} — {formatMoney(estimate.toMinor)}
          </span>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5 rounded-[var(--radius-md)] border border-line bg-surface p-5 md:p-6">
        <Field label={dict.kitchen.length} required hint={`${MIN_KITCHEN_LENGTH_M} — ${MAX_KITCHEN_LENGTH_M} м`}>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={MIN_KITCHEN_LENGTH_M}
              max={MAX_KITCHEN_LENGTH_M}
              step={0.1}
              value={form.length}
              onChange={(event) => setForm({ ...form, length: event.target.value })}
              className="h-2 flex-1 accent-[var(--color-ink)]"
              aria-label={dict.kitchen.length}
            />
            <Input
              inputMode="decimal"
              value={form.length}
              onChange={(event) => setForm({ ...form, length: event.target.value.replace(',', '.') })}
              className="w-24 text-center"
            />
          </div>
        </Field>

        <div>
          <span className="mb-2 block text-[13px] font-medium text-ink-soft">{dict.kitchen.shape} *</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {shapes.map((shape) => (
              <button
                key={shape.key}
                type="button"
                onClick={() => setForm({ ...form, shape: shape.key })}
                className={cn(
                  'h-11 rounded-[var(--radius-sm)] border text-[13px] transition-colors',
                  form.shape === shape.key ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink',
                )}
              >
                {shape.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={dict.kitchen.style}>
            <Select value={form.style} onChange={(event) => setForm({ ...form, style: event.target.value })}>
              {STYLE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {STYLES[key]?.[locale] ?? key}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={dict.kitchen.facade}>
            <Select
              value={form.facade}
              onChange={(event) => setForm({ ...form, facade: event.target.value as KitchenFacade })}
            >
              {FACADES.map((key) => (
                <option key={key} value={key}>
                  {SPEC_VALUES[`facadeType.${key}`]?.[locale] ?? key}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <span className="mb-2 block text-[13px] font-medium text-ink-soft">{dict.kitchen.color}</span>
          <div className="flex flex-wrap gap-2">
            {COLOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setForm({ ...form, color: key })}
                title={COLORS[key]?.label[locale]}
                aria-label={COLORS[key]?.label[locale]}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border-2',
                  form.color === key ? 'border-ink' : 'border-transparent hover:border-line-strong',
                )}
              >
                <span className="h-7 w-7 rounded-full border border-line" style={{ background: COLORS[key]?.hex }} />
              </button>
            ))}
          </div>
        </div>

        <Field label={dict.kitchen.budget}>
          <Select value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })}>
            {BUDGETS.map((budget) => (
              <option key={budget} value={budget}>
                {budget}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={dict.kitchen.comment}>
          <Textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={dict.kitchen.name} required>
            <Input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label={dict.kitchen.phone} required hint="+374 XX XXX XXX">
            <Input
              required
              type="tel"
              placeholder="+374 XX XXX XXX"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" className="w-full" disabled={state === 'loading'}>
          {state === 'loading' ? <Loader2 width={17} height={17} className="animate-spin" /> : null}
          {dict.kitchen.submit}
        </Button>
      </div>

      <aside className="lg:sticky lg:top-[170px] lg:self-start">
        <div className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
          <h2 className="text-[18px]">{dict.kitchen.estimateTitle}</h2>
          <p className="mt-4 text-[28px] font-semibold leading-tight tabular-nums">
            {formatMoney(estimate.fromMinor)}
          </p>
          <p className="text-[13px] text-muted">
            — {formatMoney(estimate.toMinor)}
          </p>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted">{dict.kitchen.length}</dt>
              <dd className="tabular-nums">{form.length} м</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{dict.kitchen.shape}</dt>
              <dd>{shapes.find((shape) => shape.key === form.shape)?.label}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{dict.kitchen.facade}</dt>
              <dd>{SPEC_VALUES[`facadeType.${form.facade}`]?.[locale]}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] text-muted">{dict.kitchen.estimateNote}</p>
        </div>
      </aside>
    </form>
  );
};
