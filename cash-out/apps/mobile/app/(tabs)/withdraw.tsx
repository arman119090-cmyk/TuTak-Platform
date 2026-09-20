import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PayoutMethodDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useBalance } from '../../src/hooks/useBalance';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { BalanceCard, Button, Card, ListRow, Screen, Text } from '../../src/ui';

/**
 * The Withdraw tab: a fresh balance, the destination, and the button.
 *
 * Opening the tab reads the balance from the fleet — not the cache — so that
 * the figure the driver is about to act on is the one the server will use.
 * Until that read succeeds the button stays off.
 */
export default function WithdrawTabScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api, profile } = useAuth();
  const { t } = useI18n();
  const { balance, loading, refreshFresh } = useBalance({ immediate: false });
  const [methods, setMethods] = useState<PayoutMethodDto[]>([]);

  useFocusEffect(
    useCallback(() => {
      void refreshFresh();
      void endpoints
        .payoutMethods(api)
        .then((result) => setMethods(result.items))
        .catch(() => setMethods([]));
    }, [api, refreshFresh]),
  );

  const method = methods.find((item) => item.isDefault) ?? methods[0];
  const ready =
    balance !== null && balance.fresh && BigInt(balance.withdrawable.minor) > 0n && !!method;

  return (
    <Screen
      footer={
        <Button
          label={t('home.withdrawCta')}
          onPress={() => router.push(method ? '/withdraw/amount' : '/withdraw/method')}
          disabled={!ready && !!method}
          loading={loading && balance === null}
          caption={
            !method
              ? t('withdraw.noMethods')
              : balance && !balance.fresh
                ? t('balance.withdrawDisabledStale')
                : undefined
          }
        />
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('tabs.withdraw')}</Text>
        {loading && balance === null ? (
          <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
            {t('balance.checking')}
          </Text>
        ) : null}
      </View>

      <BalanceCard balance={balance} loading={loading} compact />

      <Card padded={false} style={{ marginTop: theme.spacing.base }}>
        <ListRow label={t('balance.park')} value={profile?.activePark?.name ?? '—'} first />
        <ListRow
          label={t('withdraw.methodTitle')}
          value={method ? `${method.displayName ?? ''} ${method.maskedIdentifier}`.trim() : '—'}
          onPress={() => router.push('/withdraw/method')}
          last
        />
      </Card>
    </Screen>
  );
}
