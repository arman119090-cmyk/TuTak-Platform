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
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </Field>

        <Button type="submit" size="lg" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
