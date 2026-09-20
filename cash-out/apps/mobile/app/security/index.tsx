import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SecurityStatusDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { biometric } from '../../src/security/biometric';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, ListRow, Screen, Text, Toggle } from '../../src/ui';

/**
 * Settings → Security: the PIN and biometrics.
 *
 * Turning biometrics on asks for the PIN (the thing being supplemented must
 * approve it), then stores the server's device secret behind the OS prompt.
 * Turning it off forgets the secret here and revokes it on the server, so a
 * copy of the phone's keystore is worthless afterwards.
 */
export default function SecurityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [status, setStatus] = useState<SecurityStatusDto | null>(null);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await endpoints.securityStatus(api));
      setAvailable(await biometric.isAvailable());
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [api, describeError]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const biometricOn = !!status?.biometricEnabledOnThisDevice;

  const toggleBiometric = async (next: boolean) => {
    if (next) {
      router.push({ pathname: '/security/biometric', params: { intent: 'enable' } });
      return;
    }
    try {
      await endpoints.disableBiometric(api);
      await biometric.forget();
      await load();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <Screen
      footer={<Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('security.title')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('security.subtitle')}
        </Text>
      </View>

      <Card padded={false}>
        <ListRow
          label={t('security.pin')}
          value={status ? (status.pinSet ? t('security.pinSet') : t('security.pinNotSet')) : '—'}
          onPress={() => router.push(status?.pinSet ? '/security/pin-change' : '/security/pin-set')}
          first
        />
        <View
          style={{
            paddingHorizontal: theme.spacing.base,
            paddingVertical: theme.spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1, marginRight: theme.spacing.md }}>
            <Text variant="body">{t('security.biometrics')}</Text>
            <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
              {!available
                ? t('security.biometricsUnavailable')
                : biometricOn
                  ? t('security.biometricsOn')
                  : t('security.biometricsOff')}
            </Text>
          </View>
          <Toggle
            value={biometricOn}
            onValueChange={(next) => void toggleBiometric(next)}
            disabled={!available || !status?.pinSet}
            accessibilityLabel={t('security.biometrics')}
          />
        </View>
      </Card>

      <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
        <Text variant="caption" tone="secondary">
          {t('security.biometricsNote')}
        </Text>
      </Card>

      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.base }}>
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
