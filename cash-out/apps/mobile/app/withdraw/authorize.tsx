import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { QuoteDto, SecurityStatusDto } from '@cashout/contracts';
import { ApiError } from '../../src/api/client';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { biometric } from '../../src/security/biometric';
import { useTheme } from '../../src/theme/theme';
import { Button, PinPad, Screen, Text } from '../../src/ui';

/**
 * Step three of a withdrawal: prove it is you.
 *
 * Biometrics first when enrolled on this device — the OS prompt releases the
 * device secret, the server checks it — and the PIN pad otherwise, or when
 * the driver cancels the prompt. Either way the result is a single-use
 * authorization token bound to this quote; the confirmation screen spends it.
 * A driver with no PIN yet is sent to set one and comes back here.
 */
export default function WithdrawAuthorizeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ quote: string }>();
  const { api } = useAuth();
  const { t, money } = useI18n();
  const describeError = useErrorMessage();

  const quote = (() => {
    try {
      return params.quote ? (JSON.parse(params.quote) as QuoteDto) : null;
    } catch {
      return null;
    }
  })();

  const [status, setStatus] = useState<SecurityStatusDto | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [biometricTried, setBiometricTried] = useState(false);

  const proceed = useCallback(
    (authorizationToken: string) => {
      router.replace({
        pathname: '/withdraw/review',
        params: { quote: params.quote, authorizationToken },
      });
    },
    [params.quote, router],
  );

  const tryBiometric = useCallback(async () => {
    setBiometricTried(true);
    const secret = await biometric.unlock(t('security.biometricPrompt'));
    if (!secret) return; // cancelled → the PIN pad is already on screen
    setBusy(true);
    try {
      const result = await endpoints.authorize(api, {
        method: 'BIOMETRIC',
        deviceSecret: secret,
        purpose: 'WITHDRAWAL',
        quoteId: quote?.quoteId,
      });
      proceed(result.authorizationToken);
    } catch (caught) {
      // Not enrolled server-side any more, or the secret is stale: the PIN
      // is always the fallback and the message says so.
      setError(
        caught instanceof ApiError && caught.code === 'BIOMETRIC_NOT_ENROLLED'
          ? t('security.biometricsFallback')
          : describeError(caught),
      );
    } finally {
      setBusy(false);
    }
  }, [api, describeError, proceed, quote?.quoteId, t]);

  useEffect(() => {
    void (async () => {
      try {
        const next = await endpoints.securityStatus(api);
        setStatus(next);
        if (!next.pinSet) {
          router.replace({
            pathname: '/security/pin-set',
            params: {
              returnTo: `/withdraw/authorize?quote=${encodeURIComponent(params.quote ?? '')}`,
            },
          });
          return;
        }
        if (next.biometricEnabledOnThisDevice && !biometricTried) void tryBiometric();
      } catch (caught) {
        setError(describeError(caught));
      }
    })();
    // Keyed on the client alone: status is read once per mount, and the
    // biometric prompt must not fire again on every re-render.
  }, [api]);

  const submitPin = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await endpoints.authorize(api, {
        method: 'PIN',
        pin: value,
        purpose: 'WITHDRAWAL',
        quoteId: quote?.quoteId,
      });
      proceed(result.authorizationToken);
    } catch (caught) {
      setError(describeError(caught));
      setShake((n) => n + 1);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll={false}
      footer={<Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
        <Text variant="titleLarge" align="center">
          {t('security.confirmTitle')}
        </Text>
        {quote ? (
          <Text
            variant="body"
            tone="secondary"
            align="center"
            style={{ marginTop: theme.spacing.xs }}
          >
            {t('security.confirmBody', { amount: money(quote.net) })}
          </Text>
        ) : null}
      </View>

      <PinPad
        value={pin}
        onChange={(next) => {
          setPin(next);
          setError(null);
        }}
        onComplete={(value) => void submitPin(value)}
        disabled={busy || !status?.pinSet}
        error={error}
        shake={shake}
        extraKey={
          status?.biometricEnabledOnThisDevice
            ? { label: t('security.useBiometrics'), onPress: () => void tryBiometric() }
            : undefined
        }
      />
    </Screen>
  );
}
