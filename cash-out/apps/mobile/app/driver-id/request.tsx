import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { DriverIdChangeRequestDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Input, Screen, StatusPill, Text } from '../../src/ui';

/**
 * Asking for a new Driver ID, then the result: approved on the spot when the
 * fleet confirms it under the driver's own number, otherwise pending with the
 * finding shown, so the driver knows whether to wait or to call the park.
 */
export default function DriverIdRequestScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api, refreshProfile } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DriverIdChangeRequestDto | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const request = await endpoints.requestDriverIdChange(api, value.trim());
      setResult(request);
      if (request.status === 'APPROVED') await refreshProfile();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const approved = result.status === 'APPROVED';
    return (
      <Screen footer={<Button label={t('common.done')} onPress={() => router.back()} />}>
        <View style={{ flex: 1, justifyContent: 'center', paddingVertical: theme.spacing.xxxl }}>
          <Text variant="amountLarge" align="center">
            {approved ? '✓' : '⏳'}
          </Text>
          <Text variant="titleLarge" align="center" style={{ marginTop: theme.spacing.xl }}>
            {approved ? t('driverId.resultApprovedTitle') : t('driverId.resultPendingTitle')}
          </Text>
          <Card tone="muted" style={{ marginTop: theme.spacing.xl, alignItems: 'center' }}>
            <StatusPill
              tone={approved ? 'success' : 'warning'}
              label={approved ? t('driverId.statusApproved') : t('driverId.statusPending')}
            />
            <Text variant="amountMedium" tabular style={{ marginTop: theme.spacing.md }}>
              {result.requestedDriverId}
            </Text>
            <Text
              variant="body"
              tone="secondary"
              align="center"
              style={{ marginTop: theme.spacing.sm }}
            >
              {approved ? t('driverId.resultApprovedBody') : t('driverId.resultPendingBody')}
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('driverId.submit')}
            onPress={() => void submit()}
            loading={busy}
            disabled={value.trim().length < 2}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('driverId.requestTitle')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('driverId.requestBody')}
        </Text>
      </View>

      <Input
        label={t('driverId.newId')}
        value={value}
        onChangeText={(next) => {
          setValue(next);
          setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        error={error}
      />

      <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
        <Text variant="caption" tone="secondary">
          {t('driverId.verificationNote')}
        </Text>
      </Card>
    </Screen>
  );
}
