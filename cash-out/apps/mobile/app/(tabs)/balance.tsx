import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/auth-context';
import { useBalance } from '../../src/hooks/useBalance';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { BalanceCard, Button, Card, ErrorState, ListRow, Screen, Text } from '../../src/ui';

/**
 * The Balance screen: every figure the server holds, the park it is for, when
 * it was read, and a way to read it again. This is the screen a driver opens
 * when the home number looks wrong.
 */
export default function BalanceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const { t, money, locale } = useI18n();
  const describeError = useErrorMessage();
  const { balance, loading, error, refresh, refreshFresh } = useBalance({ immediate: false });

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const unavailable =
    error instanceof ApiError &&
    (error.code === 'BALANCE_UNAVAILABLE' || error.code === 'YANDEX_UNAVAILABLE');

  if (error && !balance) {
    return (
      <Screen>
        <ErrorState
          title={unavailable ? t('balance.unavailableTitle') : t('common.error')}
          body={unavailable ? t('balance.unavailableBody') : describeError(error)}
          retryLabel={t('balance.refresh')}
          onRetry={() => void refreshFresh()}
        />
      </Screen>
    );
  }

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <Screen
      onRefresh={() => void refreshFresh()}
      refreshing={loading && balance !== null}
      footer={
        <Button
          label={loading ? t('balance.refreshing') : t('balance.refresh')}
          variant="secondary"
          loading={loading && balance !== null}
          onPress={() => void refreshFresh()}
        />
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('balance.title')}</Text>
      </View>

      <BalanceCard balance={balance} loading={loading} />

      <Card padded={false} style={{ marginTop: theme.spacing.base }}>
        <ListRow
          label={t('balance.current')}
          value={balance ? money(balance.available) : '—'}
          first
        />
        <ListRow
          label={t('balance.available')}
          value={balance ? money(balance.withdrawable) : '—'}
        />
        <ListRow
          label={t('balance.processing')}
          value={balance ? money(balance.reservedByPendingWithdrawals) : '—'}
        />
        <ListRow
          label={t('balance.park')}
          value={balance?.park.name ?? profile?.activePark?.name ?? '—'}
          onPress={
            (profile?.membershipCount ?? 0) > 1 ? () => router.push('/park/select') : undefined
          }
        />
        <ListRow
          label={t('balance.updatedAt', { time: '' }).trim()}
          value={balance ? format(balance.asOf) : '—'}
          last
        />
      </Card>

      {balance && !balance.fresh ? (
        <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
          <Text variant="body" tone="warning">
            {t('balance.stale')}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
