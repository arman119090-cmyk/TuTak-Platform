import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BalanceDto } from '@cashout/contracts';
import { useI18n } from '../i18n/i18n';
import { useTheme } from '../theme/theme';
import { Skeleton } from './Skeleton';
import { StatusPill } from './StatusPill';
import { Text } from './Text';

/**
 * The balance, as a card: current, available, in processing, and how fresh.
 *
 * Three figures rather than one, because they answer three different
 * questions — what the park says I have, what I can take now, what is already
 * on its way — and a driver who sees only one of them phones support about the
 * other two. Freshness is shown on the card itself, not in a footnote: a stale
 * figure is a different kind of number.
 */
export function BalanceCard({
  balance,
  loading = false,
  compact = false,
}: {
  balance: BalanceDto | null;
  loading?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const { t, amount, money, locale } = useI18n();

  const time = balance
    ? new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', {
        timeStyle: 'short',
      }).format(new Date(balance.asOf))
    : '';

  return (
    <View
      style={[
        styles.card,
        theme.elevation.card,
        {
          backgroundColor: theme.colors.surfaceInverse,
          borderRadius: theme.radius.xxl,
          padding: theme.spacing.xl,
        },
      ]}
    >
      <View style={styles.row}>
        <Text variant="label" tone="inverse" style={{ opacity: 0.7 }}>
          {t('balance.available')}
        </Text>
        {balance ? (
          <StatusPill
            tone={balance.fresh ? 'success' : 'warning'}
            label={balance.fresh ? t('balance.fresh') : t('balance.stale')}
          />
        ) : null}
      </View>

      {loading && !balance ? (
        <Skeleton width={200} height={48} style={{ marginTop: theme.spacing.sm }} />
      ) : (
        <View style={[styles.amountRow, { marginTop: theme.spacing.xs }]}>
          <Text
            variant={compact ? 'amountLarge' : 'amountHero'}
            tone="inverse"
            tabular
            accessibilityLabel={balance ? money(balance.withdrawable) : undefined}
          >
            {balance ? amount(balance.withdrawable) : '—'}
          </Text>
          <Text
            variant="titleLarge"
            tone="inverse"
            style={{ marginLeft: theme.spacing.sm, opacity: 0.7 }}
          >
            {balance?.withdrawable.currency === 'AMD'
              ? '֏'
              : (balance?.withdrawable.currency ?? '')}
          </Text>
        </View>
      )}

      {!compact ? (
        <View
          style={[
            styles.figures,
            { marginTop: theme.spacing.lg, borderTopColor: 'rgba(255,255,255,0.14)' },
          ]}
        >
          <Figure label={t('balance.current')} value={balance ? money(balance.available) : '—'} />
          <Figure
            label={t('balance.processing')}
            value={balance ? money(balance.reservedByPendingWithdrawals) : '—'}
          />
        </View>
      ) : null}

      {balance ? (
        <Text
          variant="caption"
          tone="inverse"
          style={{ marginTop: theme.spacing.md, opacity: 0.6 }}
        >
          {balance.park.name} · {t('balance.updatedAt', { time })}
        </Text>
      ) : null}
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, paddingTop: theme.spacing.md }}>
      <Text variant="caption" tone="inverse" style={{ opacity: 0.6 }}>
        {label}
      </Text>
      <Text variant="bodyLarge" tone="inverse" tabular style={{ marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline' },
  figures: { flexDirection: 'row', gap: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
