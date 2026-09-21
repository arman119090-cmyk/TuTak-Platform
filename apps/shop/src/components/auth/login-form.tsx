'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Phone, Mail } from 'lucide-react';
import { demoCredentials, isDemoMode } from '@/config/brand';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Alert, Button, Field, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Sign-in.
 *
 * Two modes: e-mail + password, and a DEMO phone/OTP flow whose code is always
 * 111111 (clearly labelled, and refused by the API unless demo mode is on).
 */
export const LoginForm = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const finish = () => {
    router.push(next && next.startsWith('/') ? next : `/${locale}/account`);
    router.refresh();
  };

  const loginByEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (response.ok) {
      finish();
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(
      data.error === 'rate_limited' ? dict.auth.tooManyAttempts : dict.auth.invalidCredentials,
    );
  };

  const requestOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch('/api/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    setLoading(false);
    if (response.ok) setOtpSent(true);
    else setError(dict.forms.invalidPhone);
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    setLoading(false);
    if (response.ok) finish();
    else setError(dict.auth.invalidCredentials);
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-[30px]">{dict.auth.loginTitle}</h1>

      <div className="mt-6 flex rounded-[var(--radius-sm)] border border-line p-1">
        {(
          [
            { key: 'email', label: dict.auth.byEmail, icon: Mail },
            { key: 'phone', label: dict.auth.byPhone, icon: Phone },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={cn(
              'flex h-10 flex-1 items-center justify-center gap-2 rounded-[var(--radius-xs)] text-[13px]',
              mode === tab.key ? 'bg-ink text-white' : 'text-muted hover:bg-surface-2',
            )}
          >
            <tab.icon width={15} height={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'email' ? (
        <form onSubmit={loginByEmail} className="mt-6 space-y-4">
          <Field label={dict.auth.email} required>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={dict.auth.password} required>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
            {dict.auth.loginCta}
          </Button>
        </form>
      ) : (
        <form onSubmit={otpSent ? verifyOtp : requestOtp} className="mt-6 space-y-4">
          <Field label={dict.auth.phone} required hint="+374 XX XXX XXX">
            <Input
              type="tel"
              required
              placeholder="+374 XX XXX XXX"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={otpSent}
            />
          </Field>
          {otpSent ? (
            <Field
              label={dict.auth.otpTitle}
              hint={isDemoMode ? dict.auth.otpDemoHint : undefined}
              required
            >
              <Input
                inputMode="numeric"
                required
                maxLength={6}
                placeholder="111111"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
            {otpSent ? dict.auth.otpConfirm : dict.auth.otpSend}
          </Button>
        </form>
      )}

      <p className="mt-5 text-center text-[13px] text-muted">
        {dict.auth.noAccount}{' '}
        <Link href={`/${locale}/register`} className="text-accent hover:underline">
          {dict.auth.registerCta}
        </Link>
      </p>

      {isDemoMode ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface-2 p-4">
          <p className="text-[13px] font-semibold">{dict.auth.demoTitle}</p>
          <ul className="mt-3 space-y-2 text-[12px]">
            {[
              { role: dict.auth.demoCustomer, ...demoCredentials.customer },
              { role: dict.auth.demoAdmin, ...demoCredentials.admin },
            ].map((item) => (
              <li key={item.email} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-muted">{item.role}</span>
                <code className="rounded bg-surface px-1.5 py-0.5">{item.email}</code>
                <code className="rounded bg-surface px-1.5 py-0.5">{item.password}</code>
                <button
                  type="button"
                  onClick={() => {
                    setMode('email');
                    setEmail(item.email);
                    setPassword(item.password);
                  }}
                  className="text-accent hover:underline"
                >
                  {dict.auth.demoFill}
                </button>
              </li>
            ))}
            <li className="text-muted">OTP: {demoCredentials.otp}</li>
          </ul>
        </div>
      ) : null}
    </div>
  );
};
