import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { routeAfterSignIn } from '../../src/navigation/route-for';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, OtpField, Screen, Text } from '../../src/ui';

export default function OtpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    challengeId: string;
    phone: string;
    codeLength: string;
    resendAfter: string;
  }>();
  const { api, deviceId, signIn } = useAuth();
  const { t, locale } = useI18n();
  const describeError = useErrorMessage();

  const codeLength = Number(params.codeLength ?? 6);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challengeId, setChallengeId] = useState(params.challengeId ?? '');
  const [cooldown, setCooldown] = useState(Number(params.resendAfter ?? 60));

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Submitting as soon as the last digit arrives removes a tap from the flow,
  // and the SMS autofill on both platforms fills the whole code at once.
  useEffect(() => {
    if (code.length === codeLength && !busy) void submit(code);
    // Intentionally keyed on the code alone: `submit` is recreated every render,
    // and re-running this on each render would resubmit a code mid-flight.
  }, [code]);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const tokens = await endpoints.verifyOtp(api, {
        challengeId,
        code: value,
        deviceId,
      });
      const profile = await signIn(tokens);
      router.replace(routeAfterSignIn(profile));
    } catch (caught) {
      setError(describeError(caught));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const challenge = await endpoints.requestOtp(api, {
        phone: params.phone ?? '',
        deviceId,
        locale,
      });
      setChallengeId(challenge.challengeId);
      setCooldown(challenge.resendAfterSeconds);
      setCode('');
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <Screen
      footer={
        <Button
          label={cooldown > 0 ? t('auth.otpResendIn', { seconds: cooldown }) : t('auth.otpResend')}
          variant="ghost"
          disabled={cooldown > 0}
          onPress={resend}
        />
      }
    >
      <View style={{ paddingTop: theme.spacing.xxl }}>
        <Text variant="titleLarge">{t('auth.otpTitle')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
          {t('auth.otpSubtitle', { length: codeLength, phone: params.phone ?? '' })}
        </Text>

        <View style={{ marginTop: theme.spacing.xxl }}>
          <OtpField
            value={code}
            onChange={(next) => {
              setCode(next);
              setError(null);
            }}
            length={codeLength}
            error={error}
            disabled={busy}
          />
        </View>

        {busy ? (
          <Text
            variant="caption"
            tone="tertiary"
            align="center"
            style={{ marginTop: theme.spacing.base }}
          >
            {t('common.loading')}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
