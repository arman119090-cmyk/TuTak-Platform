import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PayoutMethodDto, WithdrawalDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useBalance } from '../../src/hooks/useBalance';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import {
  BalanceHero,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  Text,
  WithdrawalRow,
} from '../../src/ui';

/**
 * Home.
 *
 * The brief asks for the shortest possible path: open, see the balance, tap
 * Withdraw. So the screen is a balance, a button, and the last few payouts —
 * and nothing else competes with the button.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();
  const { balance, loading, error, refresh } = useBalance();

  const [recent, setRecent] = useState<WithdrawalDto[]>([]);
  const [methods, setMethods] = useState<PayoutMethodDto[]>([]);

  const load = useCallback(async () => {
    try {
      const [history, payoutMethods] = await Promise.all([
        endpoints.withdrawals(api),
        endpoints.payoutMethods(api),
      ]);
      setRecent(history.items.slice(0, 3));
      setMethods(payoutMethods.items);
    } catch {
      // The balance is the screen's job; history failing is not worth an error
      // state over the top of it.
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void load();
    }, [refresh, load]),
  );

  const live = recent.find((item) => item.status === 'PROCESSING' || item.status === 'PENDING');
  const canWithdraw =
    balance !== null && BigInt(balance.withdrawable.minor) > 0n && methods.length > 0 && !live;

  if (error && !balance) {
    return (
      <Screen>
        <ErrorState
          title={t('common.error')}
          body={describeError(error)}
          retryLabel={t('common.retry')}
          onRetry={() => void refresh()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      onRefresh={() => {
        void refresh();
        void load();
      }}
      refreshing={loading && balance !== null}
      footer={
        <Button
          label={t('home.withdrawCta')}
          onPress={() => router.push(methods.length === 0 ? '/withdraw/method' : '/withdraw/amount')}
          disabled={!canWithdraw && methods.length > 0}
          caption={
            live
              ? t('withdraw.inProgressAlready')
              : methods.length === 0
                ? t('withdraw.noMethods')
                : undefined
          }
        />
      }
    >
      <View style={{ paddingTop: theme.spacing.xxl, paddingBottom: theme.spacing.xl }}>
        <BalanceHero
          balance={balance?.withdrawable ?? null}
          reserved={balance?.reservedByPendingWithdrawals ?? null}
          loading={loading}
          stale={balance ? !balance.fresh : false}
          updatedAt={balance?.asOf}
        />
      </View>

      {live ? (
        <Card
          tone="brand"
          style={{ marginBottom: theme.spacing.base }}
        >
          <Text variant="label" tone="brand">
            {t('withdraw.processingTitle')}
          </Text>
          <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
            {t('withdraw.processingBody')}
          </Text>
          <Button
            label={t('history.detailsTitle')}
            variant="ghost"
            fullWidth={false}
            style={{ marginTop: theme.spacing.sm, paddingHorizontal: 0 }}
            onPress={() => router.push({ pathname: '/withdrawal/[id]', params: { id: live.id } })}
          />
        </Card>
      ) : null}

      <Card padded={false}>
        {recent.length === 0 ? (
          <EmptyState title={t('home.emptyHistory')} glyph="💸" />
        ) : (
          recent.map((withdrawal) => (
            <WithdrawalRow
              key={withdrawal.id}
              withdrawal={withdrawal}
              onPress={() =>
                router.push({ pathname: '/withdrawal/[id]', params: { id: withdrawal.id } })
              }
            />
          ))
        )}
      </Card>

      {recent.length > 0 ? (
        <Button
          label={t('home.historyLink')}
          variant="ghost"
          onPress={() => router.push('/(tabs)/history')}
          style={{ marginTop: theme.spacing.sm }}
        />
      ) : null}
    </Screen>
  );
}
