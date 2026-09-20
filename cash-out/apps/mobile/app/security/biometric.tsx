import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { biometric } from '../../src/security/biometric';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, PinPad, Screen, Text } from '../../src/ui';

/**
 * Enabling biometrics: the PIN approves it, the server issues a device
 * secret, the phone locks that secret behind the OS prompt. The prompt fires
 * here, once, as part of storing the secret, so a driver whose phone refuses
 * (no enrolment, cancelled) leaves with biometrics still off — and the server
 * is told so, rather than left believing a device it cannot reach is enrolled.
 */
export default function BiometricEnableScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string }>();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const complete = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      const { deviceSecret } = await endpoints.enableBiometric(api, pin);
      try {
        await biometric.enrol(deviceSecret, t('security.biometricPrompt'));
        setDone(true);
      } catch {
        // The keystore refused (no enrolment, or the driver cancelled the
        // prompt). Revoke server-side so the two sides agree.
        await endpoints.disableBiometric(api).catch(() => undefined);
        setError(t('security.biometricsEnrolFailed'));
        setShake((n) => n + 1);
      }
    } catch (caught) {
      setError(describeError(caught));
      setShake((n) => n + 1);
    } finally {
      setValue('');
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen
        footer={<Button label={t('common.done')} onPress={() => router.back()} />}
        scroll={false}
      >
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text variant="amountLarge" align="center">
            ✓
          </Text>
          <Text variant="titleLarge" align="center" style={{ marginTop: theme.spacing.xl }}>
            {t('security.biometricsEnabledTitle')}
          </Text>
          <Card tone="muted" style={{ marginTop: theme.spacing.xl }}>
            <Text variant="body" tone="secondary" align="center">
              {t('security.biometricsNote')}
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      scroll={false}
      footer={<Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
        <Text variant="titleLarge" align="center">
          {params.intent === 'enable'
            ? t('security.biometricsEnableTitle')
            : t('security.biometrics')}
        </Text>
        <Text
          variant="body"
          tone="secondary"
          align="center"
          style={{ marginTop: theme.spacing.xs }}
        >
          {t('security.biometricsEnableBody')}
        </Text>
      </View>
      <PinPad
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
        onComplete={(pin) => void complete(pin)}
        disabled={busy}
        error={error}
        shake={shake}
      />
    </Screen>
  );
}
