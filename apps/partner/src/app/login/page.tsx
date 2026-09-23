'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { AuthShell, Button, Field, Input, PasswordInput } from '@tutak/design/web';
import { normalizeArmenianPhone, type AuthResponseDto } from '@tutak/shared-types';
import { acceptInvitation, authApi } from '@/lib/api/authApi';
import { PARTNER_ROLES, useAuthStore } from '@/lib/stores/authStore';

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'response' in error
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;

const isPartnerSession = (result: AuthResponseDto) =>
  result.user.roles.some((r) => (PARTNER_ROLES as readonly string[]).includes(r));

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { deviceId, setSession } = useAuthStore();
  const [phone, setPhone] = useState('+374');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /*
   * A signed-in account that belongs to no business yet. Kept only in this
   * component — never in the store — because it is not a panel session: it
   * exists so that a person who was invited can accept the invitation and
   * then sign in for real.
   */
  const [pending, setPending] = useState<AuthResponseDto | null>(null);
  const [invitationCode, setInvitationCode] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  /*
   * The placeholder shows "+374 00 000 000", with spaces, and the API accepts
   * only "+374XXXXXXXX". A number typed the way the placeholder shows it came
   * back as a 400 — which the branch below used to read as "cannot reach the
   * API", sending an owner to check a deployment for a space in a phone
   * number.
   */
  const normalizedPhone = normalizeArmenianPhone(phone);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(null);
    if (!normalizedPhone) {
      setError(t('partnerPanel.login.phoneInvalid'));
      return;
    }
    setLoading(true);
    try {
      const result = await authApi.login(normalizedPhone, password, deviceId);
      if (!isPartnerSession(result)) {
        setPending(result);
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
      const status = statusOf(error);
      if (status === 401 || status === 400) setError(t('partnerPanel.login.wrongCredentials'));
      else if (status === 429) setError(t('partnerPanel.login.throttled'));
      else setError(t('partnerPanel.login.unreachable'));
    } finally {
      setLoading(false);
    }
  };

  /*
   * The invited person's half of an invitation. The code came to their
   * phone by SMS; the first sign-in proved they hold that phone; the API
   * checks the two match. The role only exists in a token issued after it
   * was granted, so a successful acceptance signs in once more.
   */
  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending || !normalizedPhone) return;
    setInviteError(null);
    setAccepting(true);
    try {
      await acceptInvitation(invitationCode.trim(), pending.tokens.accessToken);
    } catch (error) {
      const status = statusOf(error);
      if (status === 400) setInviteError(t('partnerPanel.login.inviteInvalid'));
      else if (status === 429) setInviteError(t('partnerPanel.login.throttled'));
      else setInviteError(t('partnerPanel.login.unreachable'));
      setAccepting(false);
      return;
    }
    try {
      const again = await authApi.login(normalizedPhone, password, deviceId);
      if (!isPartnerSession(again)) {
        setInviteError(t('partnerPanel.login.inviteAcceptedSignInAgain'));
        return;
      }
      setSession(again.user, again.tokens);
      router.push('/');
    } catch {
      setInviteError(t('partnerPanel.login.inviteAcceptedSignInAgain'));
    } finally {
      setAccepting(false);
    }
  };

  if (pending) {
    return (
      <AuthShell
        title={t('partnerPanel.login.inviteTitle')}
        description={t('partnerPanel.login.notAPartner')}
        footer={t('partnerPanel.login.footer')}
      >
        <form onSubmit={handleAccept} className="space-y-4">
          <p className="text-[14px] text-muted">{t('partnerPanel.login.inviteHint')}</p>
          <Field label={t('partnerPanel.login.inviteCode')} error={inviteError ?? undefined}>
            <Input
              value={invitationCode}
              onChange={(e) => setInvitationCode(e.target.value)}
              autoComplete="one-time-code"
              spellCheck={false}
            />
          </Field>
          <Button
            type="submit"
            size="lg"
            loading={accepting}
            disabled={invitationCode.trim().length === 0}
            className="w-full"
          >
            {t('partnerPanel.login.inviteAccept')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              setPending(null);
              setInvitationCode('');
              setInviteError(null);
            }}
          >
            {t('partnerPanel.login.inviteBack')}
          </Button>
        </form>
      </AuthShell>
    );
  }

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


