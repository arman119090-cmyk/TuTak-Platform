import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useWithdrawalStatus } from '../../src/hooks/useWithdrawalStatus';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Screen, Text } from '../../src/ui';

export default function SuccessScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, money } = useI18n();
  const { withdrawal } = useWithdrawalStatus(id);

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button label={t('common.done')} onPress={() => router.replace('/(tabs)')} />
          <Button
            label={t('history.detailsTitle')}
            variant="ghost"
            onPress={() =>
              router.replace({ pathname: '/withdrawal/[id]', params: { id: id ?? '' } })
            }
          />
        </View>
      }
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={[
            styles.badge,
            { backgroundColor: theme.colors.successSoft, borderRadius: theme.radius.pill },
          ]}
        >
          <Text variant="amountMedium" tone="success">
            ✓
          </Text>
        </View>

        <Text variant="titleLarge" align="center" style={{ marginTop: theme.spacing.xl }}>
          {t('withdraw.successTitle')}
        </Text>

        {withdrawal ? (
          <>
            <Text variant="amountLarge" tabular style={{ marginTop: theme.spacing.base }}>
              {money(withdrawal.net)}
            </Text>
            <Text
              variant="body"
              tone="secondary"
              align="center"
              style={{ marginTop: theme.spacing.sm }}
            >
              {t('withdraw.successBody', {
                amount: money(withdrawal.net),
                method: withdrawal.payoutMethod.maskedIdentifier,
              })}
            </Text>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
});
