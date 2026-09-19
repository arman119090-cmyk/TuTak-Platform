import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { DriverVisibleStatus } from '@cashout/contracts';
import { useTheme } from '../theme/theme';
import { useI18n } from '../i18n/i18n';
import { Text } from './Text';

const LABEL_KEY = {
  PENDING: 'history.statusPending',
  PROCESSING: 'history.statusProcessing',
  SENT: 'history.statusSent',
  FAILED: 'history.statusFailed',
  UNDER_REVIEW: 'history.statusUnderReview',
} as const;

/**
 * Status is carried by a word plus a shape, never by colour alone: a
 * red-green-blind driver — roughly one man in twelve — must be able to tell
 * "sent" from "failed" at a glance.
 */
export function StatusChip({ status }: { status: DriverVisibleStatus }) {
  const theme = useTheme();
  const { t } = useI18n();

  const palette: Record<DriverVisibleStatus, { bg: string; fg: string; mark: string }> = {
    PENDING: { bg: theme.colors.surfaceMuted, fg: theme.colors.textSecondary, mark: '•' },
    PROCESSING: { bg: theme.colors.infoSoft, fg: theme.colors.info, mark: '↻' },
    SENT: { bg: theme.colors.successSoft, fg: theme.colors.success, mark: '✓' },
    FAILED: { bg: theme.colors.dangerSoft, fg: theme.colors.danger, mark: '✕' },
    UNDER_REVIEW: { bg: theme.colors.warningSoft, fg: theme.colors.warning, mark: '!' },
  };

  const tone = palette[status];

  return (
    <View
      accessibilityRole="text"
      style={[
        styles.chip,
        {
          backgroundColor: tone.bg,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
        },
      ]}
    >
      <Text variant="micro" style={{ color: tone.fg }}>
        {tone.mark} {t(LABEL_KEY[status]).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' },
});
