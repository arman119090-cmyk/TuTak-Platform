'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Button, Field, Input, Textarea } from '@/components/ui';
import { Modal } from '@/components/ui/modal';
import { useStore } from '@/components/providers/store-provider';

export type RequestType =
  | 'CALLBACK'
  | 'MEASUREMENT'
  | 'CUSTOM_SIZE'
  | 'PRICE_REQUEST'
  | 'CONSULTATION'
  | 'KITCHEN'
  | 'DOOR';

/**
 * One dialog for every "leave your phone" flow in the shop. Each variant only
 * changes its copy and the extra fields; all of them create a Request row that
 * shows up in the admin inbox.
 */
export const RequestDialog = ({
  type,
  title,
  text,
  locale,
  dict,
  productId,
  extraFields,
  payload,
  onClose,
}: {
  type: RequestType;
  title: string;
  text?: string;
  locale: Locale;
  dict: Dictionary;
  productId?: string;
  extraFields?: { name: string; label: string; placeholder?: string }[];
  payload?: Record<string, string | number | boolean>;
  onClose: () => void;
}) => {
  const { toast } = useStore();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ name: '', phone: '', email: '', comment: '' });

  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('loading');
    setError(null);
    const extras = Object.fromEntries(
      (extraFields ?? []).map((field) => [field.name, form[field.name] ?? '']),
    );
    try {
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          comment: form.comment,
          locale,
          productId: productId ?? null,
          payload: { ...(payload ?? {}), ...extras },
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error === 'invalid_phone' ? dict.forms.invalidPhone : dict.forms.errorText);
        setState('idle');
        return;
      }
      setState('done');
      toast(dict.toast.requestSent);
    } catch {
      setError(dict.forms.errorText);
      setState('idle');
    }
  };

  return (
    <Modal title={title} subtitle={text} onClose={onClose}>
      {state === 'done' ? (
        <div className="py-6 text-center">
          <CheckCircle2 width={44} height={44} className="mx-auto text-success" />
          <h3 className="mt-4 text-xl">{dict.forms.successTitle}</h3>
          <p className="mt-2 text-sm text-muted">{dict.forms.successText}</p>
          <Button className="mt-6" onClick={onClose}>
            {dict.common.close}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={dict.forms.name} required>
            <Input required minLength={2} value={form.name} onChange={(event) => set('name', event.target.value)} />
          </Field>
          <Field label={dict.forms.phone} required hint="+374 XX XXX XXX">
            <Input
              required
              type="tel"
              placeholder="+374 XX XXX XXX"
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          </Field>
          <Field label={dict.forms.email}>
            <Input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
          </Field>
          {(extraFields ?? []).map((field) => (
            <Field key={field.name} label={field.label}>
              <Input
                value={form[field.name] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => set(field.name, event.target.value)}
              />
            </Field>
          ))}
          <Field label={dict.forms.comment}>
            <Textarea value={form.comment} onChange={(event) => set('comment', event.target.value)} />
          </Field>
          {error ? <p className="text-[13px] text-sale">{error}</p> : null}
          <p className="text-[12px] text-muted">{dict.forms.agree}</p>
          <Button type="submit" size="lg" className="w-full" disabled={state === 'loading'}>
            {state === 'loading' ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
            {state === 'loading' ? dict.forms.sending : dict.forms.submit}
          </Button>
        </form>
      )}
    </Modal>
  );
};

export const CallbackDialog = ({
  locale,
  dict,
  onClose,
}: {
  locale: Locale;
  dict: Dictionary;
  onClose: () => void;
}) => (
  <RequestDialog
    type="CALLBACK"
    title={dict.forms.callbackTitle}
    text={dict.forms.callbackText}
    locale={locale}
    dict={dict}
    extraFields={[{ name: 'preferredTime', label: dict.forms.preferredTime, placeholder: '10:00 — 14:00' }]}
    onClose={onClose}
  />
);

export const MeasurementDialog = ({
  locale,
  dict,
  onClose,
}: {
  locale: Locale;
  dict: Dictionary;
  onClose: () => void;
}) => (
  <RequestDialog
    type="MEASUREMENT"
    title={dict.forms.measureTitle}
    text={dict.forms.measureText}
    locale={locale}
    dict={dict}
    extraFields={[
      { name: 'address', label: dict.forms.address },
      { name: 'preferredTime', label: dict.forms.preferredTime },
    ]}
    onClose={onClose}
  />
);
