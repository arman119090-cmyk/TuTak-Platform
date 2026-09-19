import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { WithdrawalDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, EmptyState, ErrorState, Screen, Skeleton, Text, WithdrawalRow } from '../../src/ui';

export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [items, setItems] = useState<WithdrawalDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (nextCursor?: string) => {
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const page = await endpoints.withdrawals(api, nextCursor);
        setItems((previous) => (nextCursor ? [...previous, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (caught) {
        setError(caught);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (error && items.length === 0) {
    return (
      <Screen>
        <ErrorState
          title={t('common.error')}
          body={describeError(error)}
          retryLabel={t('common.retry')}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void load()} refreshing={loading && items.length > 0}>
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('history.title')}</Text>
      </View>

      {loading && items.length === 0 ? (
        <Card padded={false}>
          {[0, 1, 2, 3].map((row) => (
            <View key={row} style={{ padding: theme.spacing.base }}>
              <Skeleton width="60%" height={20} />
              <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
            </View>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState title={t('history.empty')} glyph="💸" />
      ) : (
        <>
          <Card padded={false}>
            {items.map((withdrawal) => (
              <WithdrawalRow
                key={withdrawal.id}
                withdrawal={withdrawal}
                onPress={() =>
                  router.push({ pathname: '/withdrawal/[id]', params: { id: withdrawal.id } })
                }
              />
            ))}
          </Card>
          {cursor ? (
            <Button
              label={t('common.continue')}
              variant="secondary"
              loading={loadingMore}
              onPress={() => void load(cursor)}
              style={{ marginTop: theme.spacing.base }}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
