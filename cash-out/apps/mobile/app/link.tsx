import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { endpoints } from '../src/api/endpoints';
import { useAuth } from '../src/auth/auth-context';
import { useErrorMessage } from '../src/hooks/useErrorMessage';
import { useI18n } from '../src/i18n/i18n';
import { useTheme } from '../src/theme/theme';
import { Button, Card, Input, Screen, Text } from '../src/ui';

/**
 * Driver verification: matching this phone number to a Yandex contractor
 * profile inside a fleet.
 *
 * The licence digits are asked for because the phone number alone is not proof.
 * The consequence of a wrong match here is paying one driver another driver's
 * earnings, so the screen says plainly what it is checking rather than
 * pretending to be a formality.
 */
export default function LinkScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api, profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [parkId, setParkId] = useState(profile?.parkId ?? '');
  const [licence, setLicence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await endpoints.link(api, {
        parkId: parkId.trim(),
        ...(licence.length === 4 ? { licenceLast4: licence } : {}),
      });
      await refreshProfile();
      router.replace('/(tabs)');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (profile?.verificationStatus === 'PENDING') {
    return (
      <Screen>
        <View style={{ paddingTop: theme.spacing.xxl }}>
          <Text variant="titleLarge">{t('verification.title')}</Text>
          <Card tone="brand" style={{ marginTop: theme.spacing.xl }}>
            <Text variant="bodyLarge">{t('verification.pending')}</Text>
          </Card>
        </View>
      </Screen>
    );
  }

  if (profile?.verificationStatus === 'BLOCKED') {
    return (
      <Screen>
        <View style={{ paddingTop: theme.spacing.xxl }}>
          <Text variant="titleLarge">{t('verification.title')}</Text>
          <Card style={{ marginTop: theme.spacing.xl }}>
            <Text variant="bodyLarge" tone="danger">
              {t('verification.blocked')}
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label={t('verification.submit')}
          onPress={submit}
          loading={busy}
          disabled={parkId.trim().length === 0}
        />
      }
    >
      <View style={{ paddingTop: theme.spacing.xxl, gap: theme.spacing.base }}>
        <Text variant="titleLarge">{t('verification.title')}</Text>
        <Text variant="body" tone="secondary">
          {t('verification.subtitle')}
        </Text>

        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.base }}>
          <Input
            label={t('verification.parkLabel')}
            value={parkId}
            onChangeText={(text) => {
              setParkId(text);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Input
            label={t('verification.licenceLabel')}
            value={licence}
            onChangeText={(text) => {
              setLicence(text.replace(/\D/g, '').slice(0, 4));
              setError(null);
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
            error={error}
          />
        </View>
      </View>
    </Screen>
  );
}
