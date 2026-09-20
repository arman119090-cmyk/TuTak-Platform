import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { AutoPayoutStateDto, PayoutMethodDto, WithdrawalDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useBalance } from '../../src/hooks/useBalance';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import {
  BalanceCard,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  StatusPill,
  Text,
  WithdrawalRow,
} from '../../src/ui';

/**
 * Home.
 *
 * Who you are, where you work, what you have, one button. The header shows
 * the driver's name, Driver ID and park because a driver in two parks must
 * never wonder which balance they are looking at; the balance card says how
 * fresh the figure is; the button is disabled — with the reason — whenever the
 * server would refuse the withdrawal anyway.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api, profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();
  const { balance, loading, error, refresh, refreshFresh } = useBalance({ immediate: false });

  const [recent, setRecent] = useState<WithdrawalDto[]>([]);
  const [methods, setMethods] = useState<PayoutMethodDto[]>([]);
  const [autoPayout, setAutoPayout] = useState<AutoPayoutStateDto['rule']>(null);

  const load = useCallback(async () => {
    try {
      const [history, payoutMethods, auto] = await Promise.all([
        endpoints.withdrawals(api),
        endpoints.payoutMethods(api),
        endpoints.autoPayout(api).catch(() => null),
      ]);
      setRecent(history.items.slice(0, 3));
      setMethods(payoutMethods.items);
      setAutoPayout(auto?.rule ?? null);
    } catch {
      // The balance is the screen's job; history failing is not worth an error
      // state over the top of it.
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
      void refresh();
      void load();
    }, [refreshProfile, refresh, load]),
  );

  const live = recent.find((item) => item.status === 'PROCESSING' || item.status === 'PENDING');
  const hasMethod = methods.some((method) => method.status === 'ACTIVE');
  const stale = balance !== null && !balance.fresh;
  const canWithdraw =
    balance !== null &&
    balance.fresh &&
    BigInt(balance.withdrawable.minor) > 0n &&
    hasMethod &&
    !live;

  const caption = live
    ? t('withdraw.inProgressAlready')
    : !hasMethod
      ? t('withdraw.noMethods')
      : stale
        ? t('balance.withdrawDisabledStale')
        : undefined;

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || profile?.phone;

  if (error && !balance) {
    return (
      <Screen>
        <ErrorState
          title={t('balance.unavailableTitle')}
          body={describeError(error)}
          retryLabel={t('common.retry')}
          onRetry={() => void refreshFresh()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      onRefresh={() => {
        void refreshFresh();
        void load();
      }}
      refreshing={loading && balance !== null}
      footer={
        <Button
          label={t('home.withdrawCta')}
          onPress={() => {
            if (!hasMethod) router.push('/idram/account');
            else if (stale) void refreshFresh();
            else router.push('/withdraw/amount');
          }}
          disabled={!canWithdraw && hasMethod && !stale}
          caption={caption}
        />
      }
    >
      <View style={[styles.header, { paddingTop: theme.spacing.xl }]}>
        <View style={{ flex: 1 }}>
          <Text variant="titleLarge">{t('homeHeader.greeting', { name: name ?? '' })}</Text>
          <Text variant="caption" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
            {t('homeHeader.driverId', { id: profile?.driverId ?? '—' })}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          (profile?.membershipCount ?? 0) > 1 ? router.push('/park/select') : undefined
        }
        style={[styles.parkRow, { marginTop: theme.spacing.md, marginBottom: theme.spacing.base }]}
      >
        <StatusPill tone="brand" label={profile?.activePark?.name ?? '—'} />
        {(profile?.membershipCount ?? 0) > 1 ? (
          <Text variant="caption" tone="brand" style={{ marginLeft: theme.spacing.sm }}>
            {t('park.changePark')} ›
          </Text>
        ) : null}
      </Pressable>

      <BalanceCard balance={balance} loading={loading} />

      <View
        style={[styles.parkRow, { marginTop: theme.spacing.sm, justifyContent: 'space-between' }]}
      >
        <Pressable accessibilityRole="button" onPress={() => router.push('/auto-payout')}>
          <StatusPill
            tone={autoPayout && autoPayout.enabled && !autoPayout.paused ? 'success' : 'neutral'}
            label={
              autoPayout && autoPayout.enabled && !autoPayout.paused
                ? t('homeHeader.autoPayoutOn')
                : t('homeHeader.autoPayoutOff')
            }
          />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/balance')}>
          <Text variant="label" tone="brand">
            {t('homeHeader.viewBalance')} ›
          </Text>
        </Pressable>
      </View>

      {live ? (
        <Card tone="brand" style={{ marginTop: theme.spacing.base }}>
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

      <Card padded={false} style={{ marginTop: theme.spacing.base }}>
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

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  parkRow: { flexDirection: 'row', alignItems: 'center' },
});
