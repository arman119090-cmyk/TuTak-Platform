'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { AuthShell, Button, Field, Input, PasswordInput } from '@tutak/design/web';
import { authApi } from '@/lib/api/authApi';
import { PARTNER_ROLES, useAuthStore } from '@/lib/stores/authStore';

export default function LoginPage() {
  const { t } = useTranslation();
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
        setError(t('partnerPanel.login.notAPartner'));
        return;
      }
      setSession(result.user, result.tokens);
      router.push('/');
    } catch (error) {
      // A wrong password and an unreachable API produce the same blank
      // screen to whoever is typing — but they call for a completely
      // different next step, and collapsing them into one message sent a
      // real CORS misconfiguration through several rounds of "are you sure
      // you typed the password right" before anyone thought to check the
      // network response. Mirrors apps/admin's login page, which already
      // makes this distinction.
      const status =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 401) setError(t('partnerPanel.login.wrongCredentials'));
      else if (status === 429) setError(t('partnerPanel.login.throttled'));
      else setError(t('partnerPanel.login.unreachable'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('partnerPanel.login.title')}
      description={t('partnerPanel.login.description')}
      footer={t('partnerPanel.login.footer')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label={t('partnerPanel.login.phone')}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="+374 00 000 000"
          />
        </Field>

        <Field label={t('partnerPanel.login.password')} error={error ?? undefined}>
          {/* This screen had the only eye in the panels, built inline. It is
              the shared one now, so the admin panel's four password boxes get
              the same control rather than a second copy of this code. */}
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </Field>

        <Button type="submit" size="lg" loading={loading} className="w-full">
          {t('partnerPanel.login.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}


