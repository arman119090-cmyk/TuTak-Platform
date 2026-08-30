'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, Button, Field, Input } from '@tutak/design/web';
import { authApi } from '@/lib/api/authApi';
import { ADMIN_ROLES, useAuthStore } from '@/lib/stores/authStore';

export default function LoginPage() {
  const router = useRouter();
  const { deviceId, setSession } = useAuthStore();
  const [phone, setPhone] = useState('+37400000000');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await authApi.login(phone, password, deviceId);
      const isAdmin = result.user.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
      if (!isAdmin) {
        setError('This account does not have admin access.');
        return;
      }
      setSession(result.user, result.tokens);
      router.push('/');
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 401) setError('Incorrect phone number or password.');
      else if (status === 429) setError('Too many attempts. Please wait a minute and try again.');
      else setError('Cannot reach the staging API. This is a deployment configuration issue, not a password error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Sign in to Admin"
      description="Manage users, partners and the bonus ledger."
      footer="TuTak Admin · Authorised personnel only"
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
