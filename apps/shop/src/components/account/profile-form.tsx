'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { LOCALES } from '@/lib/i18n';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { useStore } from '@/components/providers/store-provider';

export const ProfileForm = ({
  locale,
  dict,
  profile,
}: {
  locale: Locale;
  dict: Dictionary;
  profile: { firstName: string; lastName: string; phone: string; email: string; locale: Locale };
}) => {
  const { toast } = useStore();
  const [form, setForm] = useState(profile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch('/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || null,
        locale: form.locale,
      }),
    });
    setLoading(false);
    if (response.ok) toast(dict.account.profileSaved);
    else setError(dict.forms.errorText);
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4 rounded-[var(--radius-md)] border border-line bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={dict.auth.firstName} required>
          <Input
            required
            value={form.firstName}
            onChange={(event) => setForm({ ...form, firstName: event.target.value })}
          />
        </Field>
        <Field label={dict.auth.lastName}>
          <Input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
        </Field>
      </div>
      <Field label={dict.auth.email} hint={dict.common.demoBadge}>
        <Input value={form.email} disabled />
      </Field>
      <Field label={dict.auth.phone} hint="+374 XX XXX XXX">
        <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      </Field>
      <Field label={dict.account.preferredLocale}>
        <Select
          value={form.locale}
          onChange={(event) => setForm({ ...form, locale: event.target.value as Locale })}
        >
          {LOCALES.map((item) => (
            <option key={item} value={item}>
              {dict.locale[item]}
            </option>
          ))}
        </Select>
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" disabled={loading}>
        {loading ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
        {dict.account.saveProfile}
      </Button>
      <p className="text-[12px] text-muted">{locale === 'ru' ? 'DEMO: e-mail изменить нельзя.' : 'DEMO: e-mail is fixed.'}</p>
    </form>
  );
};
