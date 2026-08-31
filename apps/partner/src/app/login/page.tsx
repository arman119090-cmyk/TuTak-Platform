'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, Button, Field, Input } from '@tutak/design/web';
import { authApi } from '@/lib/api/authApi';
import { PARTNER_ROLES, useAuthStore } from '@/lib/stores/authStore';

export default function LoginPage() {
  const router = useRouter();
  const { deviceId, setSession } = useAuthStore();
  const [phone, setPhone] = useState('+374');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await authApi.login(phone, password, deviceId);
      const isPartner = result.user.roles.some((r) =>
        (PARTNER_ROLES as readonly string[]).includes(r),
      );
      if (!isPartner) {
        setError('This account is not linked to a partner business.');
        return;
      }
      setSession(result.user, result.tokens);
      router.push('/');
    } catch {
      setError('Incorrect phone number or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Sign in to Partner"
      description="Track your sales, bonuses and charging stations."
      footer="Need access? Ask your TuTak account manager."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Phone">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="+374 00 000 000"
          />
        </Field>

        <Field label="Password" error={error ?? undefined}>
          <div className="relative">
            <Input
              type={passwordVisible ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setPasswordVisible((visible) => !visible)}
              // The label says what pressing it does, not the current state — a
              // screen reader user gets no benefit from being told about pixels
              // they cannot see.
              aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              title={passwordVisible ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-secondary hover:text-ink"
            >
              {passwordVisible ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </Field>

        <Button type="submit" size="lg" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 5.2C11.05 5.1 11.51 5 12 5c6.4 0 10 7 10 7-.63 1.2-1.6 2.6-2.9 3.9M6.5 6.6C4 8.3 2 12 2 12s3.6 7 10 7c1.36 0 2.56-.31 3.6-.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
