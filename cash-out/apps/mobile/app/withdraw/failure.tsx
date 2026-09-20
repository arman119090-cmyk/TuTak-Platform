import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useWithdrawalStatus } from '../../src/hooks/useWithdrawalStatus';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Screen, Text } from '../../src/ui';

/**
 * The failure screen's job is to remove fear, in this order: what happened to
 * the money, what happens next, and only then what the driver may do. A driver
 * whose payout failed wants to know their balance is intact before they want an
 * explanation.
 */
export default function FailureScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, money } = useI18n();
  const { withdrawal } = useWithdrawalStatus(id);

  const underReview = withdrawal?.status === 'UNDER_REVIEW';
  // The history vocabulary decides the words: a cancelled payout kept the
  // money, a rejected one was refused by the rail or the park.
  const variant: 'review' | 'cancelled' | 'rejected' | 'failed' = underReview
    ? 'review'
    : withdrawal?.userStatus === 'CANCELLED'
      ? 'cancelled'
      : withdrawal?.userStatus === 'REJECTED'
        ? 'rejected'
        : 'failed';
  const title =
    variant === 'review'
      ? t('withdraw.underReviewTitle')
      : variant === 'cancelled'
        ? t('withdraw.cancelledTitle')
        : variant === 'rejected'
          ? t('withdraw.rejectedTitle')
          : t('withdraw.failureTitle');
  const body =
    variant === 'review'
      ? t('withdraw.underReviewBody')
      : variant === 'cancelled'
        ? withdrawal
          ? t('withdraw.reversedBody', { amount: money(withdrawal.gross) })
          : t('withdraw.cancelledBody')
        : variant === 'rejected'
          ? t('withdraw.rejectedBody')
          : t('withdraw.failureBody');

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button label={t('common.done')} onPress={() => router.replace('/(tabs)')} />
          <Button
            label={t('support.title')}
            variant="ghost"
            onPress={() => router.replace('/support')}
          />
        </View>
      }
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: underReview ? theme.colors.warningSoft : theme.colors.dangerSoft,
              borderRadius: theme.radius.pill,
            },
          ]}
        >
          <Text variant="amountMedium" tone={underReview ? 'warning' : 'danger'}>
            {underReview ? '!' : '✕'}
          </Text>
        </View>

        <Text variant="titleLarge" align="center" style={{ marginTop: theme.spacing.xl }}>
          {title}
        </Text>

        <Card tone="muted" style={{ marginTop: theme.spacing.xl, width: '100%' }}>
          <Text variant="bodyLarge" align="center">
            {body}
          </Text>
        </Card>

        {withdrawal ? (
          <Text variant="caption" tone="tertiary" style={{ marginTop: theme.spacing.base }}>
            {t('history.reference')}: {withdrawal.reference}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
});
