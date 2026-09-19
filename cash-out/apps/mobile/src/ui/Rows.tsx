import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import type { MoneyDto, WithdrawalDto } from '@cashout/contracts';
import { useTheme } from '../theme/theme';
import { useI18n } from '../i18n/i18n';
import { StatusChip } from './StatusChip';
import { Text } from './Text';

/** A tappable settings/menu row. */
export function ListRow({
  label,
  value,
  onPress,
  danger = false,
  first = false,
  last = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.listRow,
        {
          minHeight: theme.touchTarget.comfortable,
          paddingHorizontal: theme.spacing.base,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderTopLeftRadius: first ? theme.radius.lg : 0,
          borderTopRightRadius: first ? theme.radius.lg : 0,
          borderBottomLeftRadius: last ? theme.radius.lg : 0,
          borderBottomRightRadius: last ? theme.radius.lg : 0,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <Text variant="body" tone={danger ? 'danger' : 'primary'}>
        {label}
      </Text>
      <View style={styles.rowEnd}>
        {value ? (
          <Text variant="body" tone="secondary">
            {value}
          </Text>
        ) : null}
        {onPress ? (
          <Text variant="body" tone="tertiary" style={{ marginLeft: theme.spacing.sm }}>
            ›
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A labelled amount, as used on the review screen and the details screen. */
export function AmountRow({
  label,
  amount,
  emphasis = false,
  negative = false,
  style,
}: {
  label: string;
  amount: MoneyDto;
  emphasis?: boolean;
  negative?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const { money } = useI18n();

  return (
    <View style={[styles.amountRow, { paddingVertical: theme.spacing.sm }, style]}>
      <Text variant={emphasis ? 'bodyLarge' : 'body'} tone={emphasis ? 'primary' : 'secondary'}>
        {label}
      </Text>
      <Text
        variant={emphasis ? 'amountMedium' : 'bodyLarge'}
        tone={emphasis ? 'primary' : negative ? 'secondary' : 'primary'}
        tabular
      >
        {negative ? '−' : ''}
        {money(amount)}
      </Text>
    </View>
  );
}

/** One line of payout history. */
export function WithdrawalRow({
  withdrawal,
  onPress,
}: {
  withdrawal: WithdrawalDto;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { money, locale } = useI18n();

  const date = new Intl.DateTimeFormat(
    locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  ).format(new Date(withdrawal.createdAt));

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.withdrawalRow,
        {
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.base,
          backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.rowMain}>
        <Text variant="bodyLarge" tabular>
          {money(withdrawal.net)}
        </Text>
        <Text variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
          {date} · {withdrawal.payoutMethod.maskedIdentifier}
        </Text>
      </View>
      <StatusChip status={withdrawal.status} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowEnd: { flexDirection: 'row', alignItems: 'center' },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  withdrawalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, marginRight: 12 },
});
