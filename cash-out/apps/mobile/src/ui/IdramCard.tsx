import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { PayoutMethodDto } from '@cashout/contracts';
import { useI18n } from '../i18n/i18n';
import { useTheme } from '../theme/theme';
import { StatusPill } from './StatusPill';
import { Text } from './Text';

/**
 * The iDram destination: masked id, holder, verification state.
 *
 * The id is masked because that is all the server ever sends; the holder's
 * name is shown because "•••• 3456" alone does not let a driver notice they
 * linked the wrong wallet, and the recipient line on the confirmation screen
 * is the last place they can.
 */
export function IdramCard({ account }: { account: PayoutMethodDto | null }) {
  const theme = useTheme();
  const { t } = useI18n();

  const tone = !account
    ? 'neutral'
    : account.status === 'ACTIVE'
      ? 'success'
      : account.status === 'REJECTED'
        ? 'danger'
        : 'warning';
  const label = !account
    ? t('idram.none')
    : account.status === 'ACTIVE'
      ? t('idram.verified')
      : account.status === 'REJECTED'
        ? t('idram.rejected')
        : t('idram.unverified');

  return (
    <View
      style={[
        styles.card,
        theme.elevation.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xxl,
          padding: theme.spacing.lg,
        },
      ]}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.logo,
            { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md },
          ]}
        >
          <Text variant="label" tone="brand">
            iD
          </Text>
        </View>
        <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
          <Text variant="label" tone="secondary">
            {t('idram.title')}
          </Text>
          <Text variant="title" tabular style={{ marginTop: 2 }}>
            {account?.maskedIdentifier ?? '—'}
          </Text>
        </View>
        <StatusPill tone={tone} label={label} />
      </View>

      {account ? (
        <View
          style={[
            styles.meta,
            { marginTop: theme.spacing.md, borderTopColor: theme.colors.border },
          ]}
        >
          <Text variant="caption" tone="secondary">
            {t('idram.recipient')}
          </Text>
          <Text variant="body" style={{ marginTop: 2 }}>
            {account.holderName ?? '—'}
          </Text>
          {account.isDefault ? (
            <Text variant="caption" tone="brand" style={{ marginTop: theme.spacing.xs }}>
              {t('idram.activeDestination')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.md }}>
          {t('idram.noneBody')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  meta: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
});
