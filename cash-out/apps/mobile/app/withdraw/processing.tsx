import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useWithdrawalStatus } from '../../src/hooks/useWithdrawalStatus';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Screen, Text } from '../../src/ui';

/**
 * The waiting screen.
 *
 * It says the driver may close the app, and that is true: the withdrawal is
 * driven by a server-side worker keyed on a database row, not by this screen
 * staying open. Saying so removes the anxiety that makes people tap Withdraw a
 * second time.
 */
export default function ProcessingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { withdrawal } = useWithdrawalStatus(id);

  useEffect(() => {
    if (!withdrawal) return;
    if (withdrawal.status === 'SENT') {
      router.replace({ pathname: '/withdraw/success', params: { id: withdrawal.id } });
    } else if (withdrawal.status === 'FAILED' || withdrawal.status === 'UNDER_REVIEW') {
      router.replace({ pathname: '/withdraw/failure', params: { id: withdrawal.id } });
    }
  }, [withdrawal, router]);

  return (
    <Screen
      footer={
        <Button
          label={t('common.close')}
          variant="ghost"
          onPress={() => router.replace('/(tabs)')}
        />
      }
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text variant="title" align="center" style={{ marginTop: theme.spacing.xl }}>
          {t('withdraw.processingTitle')}
        </Text>
        <Text
          variant="body"
          tone="secondary"
          align="center"
          style={{ marginTop: theme.spacing.sm }}
        >
          {t('withdraw.processingBody')}
        </Text>
        {withdrawal ? (
          <Text variant="caption" tone="tertiary" style={{ marginTop: theme.spacing.xl }}>
            {t('history.reference')}: {withdrawal.reference}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
