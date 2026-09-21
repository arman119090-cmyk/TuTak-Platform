'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Alert, Button, Field, Input } from '@/components/ui';

export const RegisterForm = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    passwordRepeat: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, phone: form.phone || undefined, locale }),
    });
    setLoading(false);
    if (response.ok) {
      router.push(`/${locale}/account`);
      router.refresh();
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(data.error === 'email_taken' ? dict.auth.emailTaken : dict.forms.errorText);
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-[30px]">{dict.auth.registerTitle}</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={dict.auth.firstName} required>
            <Input
              required
              minLength={2}
              value={form.firstName}
              onChange={(event) => set('firstName', event.target.value)}
            />
          </Field>
          <Field label={dict.auth.lastName}>
            <Input
              value={form.lastName}
              onChange={(event) => set('lastName', event.target.value)}
            />
          </Field>
        </div>
        <Field label={dict.auth.email} required>
          <Input
            type="email"
            required
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </Field>
        <Field label={dict.auth.phone} hint="+374 XX XXX XXX">
          <Input
            type="tel"
            value={form.phone}
            onChange={(event) => set('phone', event.target.value)}
          />
        </Field>
        <Field label={dict.auth.password} required hint="min. 8">
          <Input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => set('password', event.target.value)}
          />
        </Field>
        <Field label={dict.auth.passwordRepeat} required>
          <Input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.passwordRepeat}
            onChange={(event) => set('passwordRepeat', event.target.value)}
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
          {dict.auth.registerCta}
        </Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">
        {dict.auth.hasAccount}{' '}
        <Link href={`/${locale}/login`} className="text-accent hover:underline">
          {dict.auth.loginCta}
        </Link>
      </p>
    </div>
  );
};
