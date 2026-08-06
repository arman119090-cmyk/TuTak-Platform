'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
      const isPartner = result.user.roles.some((r) => (PARTNER_ROLES as readonly string[]).includes(r));
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
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold text-brand-green">TuTak Partner</h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in to manage your business.</p>

        <label className="mt-6 block text-sm font-medium text-neutral-600">Phone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
        />

        <label className="mt-4 block text-sm font-medium text-neutral-600">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
        />

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-brand-green py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
