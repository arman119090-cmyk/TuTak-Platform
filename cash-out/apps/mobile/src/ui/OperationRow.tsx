import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { HistoryEntryDto } from '@cashout/contracts';
import { useI18n } from '../i18n/i18n';
import { useTheme } from '../theme/theme';
import { StatusPill, type PillTone } from './StatusPill';
import { Text } from './Text';

const TYPE_KEY = {
  CREDIT: 'history.typeCredit',
  DEBIT: 'history.typeDebit',
  WITHDRAWAL: 'history.typeWithdrawal',
  REFUND: 'history.typeRefund',
  ADMIN_ADJUSTMENT: 'history.typeAdminAdjustment',
} as const;

const STATUS_KEY = {
  COMPLETED: 'history.userCompleted',
  PROCESSING: 'history.userProcessing',
  CANCELLED: 'history.userCancelled',
  REJECTED: 'history.userRejected',
} as const;

const STATUS_TONE: Record<HistoryEntryDto['status'], PillTone> = {
  COMPLETED: 'success',
  PROCESSING: 'info',
  CANCELLED: 'warning',
  REJECTED: 'danger',
};

/**
 * One line of balance history: type, when, signed amount, status.
 *
 * The sign is part of the number, in tabular figures, so a column of rows
 * lines up and a refund reads as a plus at a glance. A cancelled or rejected
 * withdrawal is shown struck through the amount's meaning by its status pill,
 * never by hiding the row: the driver asked for it, and it happened.
 */
export function OperationRow({ entry, onPress }: { entry: HistoryEntryDto; onPress?: () => void }) {
  const theme = useTheme();
  const { t, locale, money } = useI18n();

  const date = new Intl.DateTimeFormat(
    locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  ).format(new Date(entry.at));

  const negative = entry.amount.minor.startsWith('-');
  const amount = money({
    minor: negative ? entry.amount.minor.slice(1) : entry.amount.minor,
    currency: entry.amount.currency,
  });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.base,
          backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.main}>
        <Text variant="bodyLarge">
          {t(TYPE_KEY[entry.type])}
          {entry.origin === 'AUTO_PAYOUT' ? ` · ${t('history.autoPayoutTag')}` : ''}
        </Text>
        <Text variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
          {date} · {entry.operationId}
        </Text>
      </View>
      <View style={styles.end}>
        <Text
          variant="bodyLarge"
          tabular
          tone={negative ? 'primary' : 'success'}
          style={entry.status === 'REJECTED' ? { opacity: 0.5 } : null}
        >
          {negative ? '−' : '+'}
          {amount}
        </Text>
        <View style={{ marginTop: 4 }}>
          <StatusPill tone={STATUS_TONE[entry.status]} label={t(STATUS_KEY[entry.status])} />
        </View>
      </View>
    </Pressable>
  );
}

export function historyTypeLabelKey(type: HistoryEntryDto['type']) {
  return TYPE_KEY[type];
}

export function historyStatusLabelKey(status: HistoryEntryDto['status']) {
  return STATUS_KEY[status];
}

export function historyStatusTone(status: HistoryEntryDto['status']): PillTone {
  return STATUS_TONE[status];
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, marginRight: 12 },
  end: { alignItems: 'flex-end' },
});
