import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { MoneyDto } from '@cashout/contracts';
import { useTheme } from '../theme/theme';
import { useI18n } from '../i18n/i18n';
import { Text } from './Text';
import { Skeleton } from './Skeleton';

export interface BalanceHeroProps {
  balance: MoneyDto | null;
  loading?: boolean;
  /** Set when the figure came from cache because the fleet was unreachable. */
  stale?: boolean;
  updatedAt?: string;
  reserved?: MoneyDto | null;
}

/**
 * The number the whole app exists to show.
 *
 * It is the largest thing on the screen, in tabular figures so it does not
 * shimmer while refreshing, with the currency beside it rather than glued to it
 * — a driver reads the digits first and the symbol second.
 *
 * A stale balance says so, plainly. Showing a cached number as though it were
 * live is how a driver ends up believing they have money they have already
 * spent.
 */
export function BalanceHero({
  balance,
  loading = false,
  stale = false,
  updatedAt,
  reserved,
}: BalanceHeroProps) {
  const theme = useTheme();
  const { t, amount, money, locale } = useI18n();

  return (
    <View style={styles.root}>
      <Text variant="label" tone="secondary">
        {t('home.balanceLabel')}
      </Text>

      {loading && !balance ? (
        <Skeleton width={220} height={54} style={{ marginTop: theme.spacing.sm }} />
      ) : (
        <View style={[styles.amountRow, { marginTop: theme.spacing.xs }]}>
          <Text
            variant="amountHero"
            tabular
            accessibilityLabel={balance ? money(balance) : undefined}
          >
            {balance ? amount(balance) : '—'}
          </Text>
          <Text variant="titleLarge" tone="secondary" style={{ marginLeft: theme.spacing.sm }}>
            {balance?.currency === 'AMD' ? '֏' : (balance?.currency ?? '')}
          </Text>
        </View>
      )}

      {reserved && reserved.minor !== '0' ? (
        <Text variant="caption" tone="warning" style={{ marginTop: theme.spacing.xs }}>
          {t('home.reservedNote', { amount: money(reserved) })}
        </Text>
      ) : null}

      {stale ? (
        <Text variant="caption" tone="warning" style={{ marginTop: theme.spacing.xs }}>
          {t('home.stale')}
        </Text>
      ) : updatedAt ? (
        <Text variant="caption" tone="tertiary" style={{ marginTop: theme.spacing.xs }}>
          {t('home.updatedAt', {
            time: new Intl.DateTimeFormat(
              locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US',
              {
                timeStyle: 'short',
              },
            ).format(new Date(updatedAt)),
          })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  amountRow: { flexDirection: 'row', alignItems: 'baseline' },
});
