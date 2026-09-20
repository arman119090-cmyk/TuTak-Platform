import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { MembershipDto } from '@cashout/contracts';
import { useI18n } from '../i18n/i18n';
import { useTheme } from '../theme/theme';
import { StatusPill } from './StatusPill';
import { Text } from './Text';

/**
 * One taxi park the driver belongs to.
 *
 * The card states plainly whether the park can be used right now and why not
 * when it cannot; a greyed-out card with no explanation sends the driver to
 * support with a question the card could have answered.
 */
export function TaxiParkCard({
  membership,
  onPress,
  busy = false,
}: {
  membership: MembershipDto;
  onPress?: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  const { t } = useI18n();

  const reason = !membership.available
    ? membership.park.status !== 'ACTIVE'
      ? t('park.suspended')
      : membership.eligibility === 'PENDING_REVIEW'
        ? t('park.pendingReview')
        : t('park.ineligible')
    : null;

  const disabled = !membership.available || busy || !onPress;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: membership.isActive }}
      accessibilityLabel={`${membership.park.name}. ${
        membership.isActive ? t('park.active') : (reason ?? t('park.use'))
      }`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        theme.elevation.card,
        {
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderColor: membership.isActive ? theme.colors.primary : theme.colors.border,
          borderWidth: membership.isActive ? 2 : StyleSheet.hairlineWidth,
          borderRadius: theme.radius.xxl,
          padding: theme.spacing.lg,
          opacity: membership.available ? 1 : 0.7,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: theme.spacing.md }}>
          <Text variant="title">{membership.park.name}</Text>
          <Text variant="caption" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
            {t('park.driverIdLabel')} · {membership.externalProfileId}
          </Text>
        </View>
        {membership.isActive ? (
          <StatusPill tone="success" label={t('park.active')} />
        ) : reason ? (
          <StatusPill tone="neutral" label={reason} />
        ) : null}
      </View>
      {!membership.isActive && membership.available && onPress ? (
        <Text variant="label" tone="brand" style={{ marginTop: theme.spacing.md }}>
          {busy ? t('park.switching') : t('park.use')} ›
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
});
