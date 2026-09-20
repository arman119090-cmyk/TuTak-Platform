import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ApiError } from '../api/client';
import { useErrorMessage } from '../hooks/useErrorMessage';
import { useI18n } from '../i18n/i18n';
import { useTheme } from '../theme/theme';
import { EmptyState, ErrorState } from './States';
import { Text } from './Text';

export type ViewState =
  | { kind: 'loading'; message?: string }
  | { kind: 'empty'; title: string; body?: string; actionLabel?: string; onAction?: () => void }
  | { kind: 'error'; error: unknown; onRetry?: () => void };

/**
 * Loading, empty and error, in one place, with the same shapes everywhere.
 *
 * Errors are classified by their stable code so the driver sees the right
 * sentence: no connection, session ended, the fleet or iDram not answering,
 * the balance out of date. A stack trace never reaches this component — the
 * API client strips it — and an unknown code gets the generic apology.
 */
export function StateView({ state }: { state: ViewState }) {
  const theme = useTheme();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  if (state.kind === 'loading') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: theme.spacing.xxxl }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text
          variant="caption"
          tone="tertiary"
          align="center"
          style={{ marginTop: theme.spacing.md }}
        >
          {state.message ?? t('common.loading')}
        </Text>
      </View>
    );
  }

  if (state.kind === 'empty') {
    return (
      <EmptyState
        title={state.title}
        body={state.body}
        actionLabel={state.actionLabel}
        onAction={state.onAction}
      />
    );
  }

  const error = state.error;
  let title = t('common.error');
  if (error instanceof ApiError) {
    if (error.isNetwork) title = t('stateView.networkTitle');
    else if (error.isAuth) title = t('stateView.unauthorizedTitle');
    else if (error.status >= 500) title = t('stateView.serverTitle');
    else if (error.code === 'VALIDATION_FAILED') title = t('stateView.validationTitle');
    else if (error.code === 'BALANCE_UNAVAILABLE' || error.code === 'BALANCE_STALE')
      title = t('balance.unavailableTitle');
  }

  return (
    <ErrorState
      title={title}
      body={describeError(error)}
      retryLabel={t('common.retry')}
      onRetry={state.onRetry ?? (() => undefined)}
    />
  );
}
