'use client';

import { useState } from 'react';
import { Button, Input, Surface } from '@tutak/design/web';
import { checkoutApi, apiErrorMessage } from '@/lib/api/checkoutApi';
import { useAuthStore } from '@/lib/stores/authStore';
import type { SupportedLocale } from '@/lib/i18n';
import { translate } from '@/lib/i18n';

/**
 * Sign-in for an existing TuTak customer: phone → one-time SMS code, the same
 * OTP login the app offers. No registration and no guest checkout here (Q12):
 * an order is always confirmed by a known TuTak account.
 */
export function LoginPanel({ locale }: { locale: SupportedLocale }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
  const { deviceId, setSession } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await checkoutApi.requestLoginOtp(phone.trim());
      setCodeSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, t('common.somethingWentWrong')));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await checkoutApi.verifyLoginOtp(phone.trim(), code.trim(), deviceId);
      setSession(session.user, session.tokens);
    } catch (err) {
      setError(apiErrorMessage(err, t('common.somethingWentWrong')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface>
      <h2 className="text-[18px] font-semibold text-ink">{t('partnerOrder.webSignInTitle')}</h2>
      <p className="mt-1 text-[13px] text-muted">{t('partnerOrder.webSignInHint')}</p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-[13px] text-muted">
          {t('auth.phoneNumber')}
          <Input aria-label={t('auth.phoneNumber')} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+374…" inputMode="tel" />
        </label>
        {codeSent ? (
          <label className="grid gap-1 text-[13px] text-muted">
            {t('partnerOrder.webCodeLabel')}
            <Input aria-label={t('partnerOrder.webCodeLabel')} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
          </label>
        ) : null}
        {error ? <div className="text-[13px] text-danger-text">{error}</div> : null}
        {codeSent ? (
          <Button loading={busy} disabled={code.trim().length !== 6} onClick={() => void verify()}>
            {t('partnerOrder.webVerify')}
          </Button>
        ) : (
          <Button loading={busy} disabled={phone.trim().length < 8} onClick={() => void send()}>
            {t('partnerOrder.webSendCode')}
          </Button>
        )}
      </div>
    </Surface>
  );
}
