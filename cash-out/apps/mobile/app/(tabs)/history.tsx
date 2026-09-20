import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { HistoryEntryDto, HistoryEntryType, UserStatus } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  OperationRow,
  Screen,
  SegmentedControl,
  Sheet,
  Skeleton,
  Text,
} from '../../src/ui';

type Period = '7d' | '30d' | 'all';
type TypeFilter = HistoryEntryType | 'ANY';
type StatusFilter = UserStatus | 'ANY';

const TYPES: ReadonlyArray<{ value: TypeFilter; key: string }> = [
  { value: 'ANY', key: 'history.any' },
  { value: 'WITHDRAWAL', key: 'history.typeWithdrawal' },
  { value: 'REFUND', key: 'history.typeRefund' },
  { value: 'CREDIT', key: 'history.typeCredit' },
  { value: 'DEBIT', key: 'history.typeDebit' },
  { value: 'ADMIN_ADJUSTMENT', key: 'history.typeAdminAdjustment' },
];

const STATUSES: ReadonlyArray<{ value: StatusFilter; key: string }> = [
  { value: 'ANY', key: 'history.any' },
  { value: 'COMPLETED', key: 'history.userCompleted' },
  { value: 'PROCESSING', key: 'history.userProcessing' },
  { value: 'CANCELLED', key: 'history.userCancelled' },
  { value: 'REJECTED', key: 'history.userRejected' },
];

/**
 * Balance history: every operation Cash Out knows about, newest first, with
 * period, type and status filters. The rows come from the server's read model
 * over withdrawals and the ledger; the app adds nothing and hides nothing.
 */
export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [items, setItems] = useState<HistoryEntryDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [period, setPeriod] = useState<Period>('30d');
  const [type, setType] = useState<TypeFilter>('ANY');
  const [status, setStatus] = useState<StatusFilter>('ANY');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filter = useCallback(() => {
    const from =
      period === 'all'
        ? undefined
        : new Date(Date.now() - (period === '7d' ? 7 : 30) * 86_400_000).toISOString();
    return {
      from,
      type: type === 'ANY' ? undefined : type,
      status: status === 'ANY' ? undefined : status,
    };
  }, [period, type, status]);

  const load = useCallback(
    async (nextCursor?: string) => {
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const page = await endpoints.history(api, { ...filter(), cursor: nextCursor });
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
    [api, filter],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const activeFilters =
    (period !== '30d' ? 1 : 0) + (type !== 'ANY' ? 1 : 0) + (status !== 'ANY' ? 1 : 0);

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
      <View
        style={[styles.header, { paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }]}
      >
        <Text variant="titleLarge" style={{ flex: 1 }}>
          {t('history.title')}
        </Text>
        <Button
          label={
            activeFilters > 0 ? `${t('history.filters')} · ${activeFilters}` : t('history.filters')
          }
          variant="secondary"
          size="medium"
          fullWidth={false}
          onPress={() => setFiltersOpen(true)}
        />
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
        <EmptyState
          title={t('history.empty')}
          glyph="💸"
          actionLabel={activeFilters > 0 ? t('history.reset') : undefined}
          onAction={
            activeFilters > 0
              ? () => {
                  setPeriod('30d');
                  setType('ANY');
                  setStatus('ANY');
                }
              : undefined
          }
        />
      ) : (
        <>
          <Card padded={false}>
            {items.map((entry) => (
              <OperationRow
                key={entry.id}
                entry={entry}
                onPress={() => router.push({ pathname: '/history/[id]', params: { id: entry.id } })}
              />
            ))}
          </Card>
          {cursor ? (
            <Button
              label={t('history.loadMore')}
              variant="secondary"
              loading={loadingMore}
              onPress={() => void load(cursor)}
              style={{ marginTop: theme.spacing.base }}
            />
          ) : null}
        </>
      )}

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t('history.filters')}
      >
        <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.sm }}>
          {t('history.period')}
        </Text>
        <SegmentedControl
          segments={[
            { value: '7d', label: t('history.period7d') },
            { value: '30d', label: t('history.period30d') },
            { value: 'all', label: t('history.periodAll') },
          ]}
          value={period}
          onChange={setPeriod}
        />

        <Text
          variant="label"
          tone="secondary"
          style={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}
        >
          {t('history.type')}
        </Text>
        <View style={styles.chips}>
          {TYPES.map((option) => (
            <Button
              key={option.value}
              label={t(option.key as never)}
              variant={type === option.value ? 'primary' : 'secondary'}
              size="medium"
              fullWidth={false}
              onPress={() => setType(option.value)}
            />
          ))}
        </View>

        <Text
          variant="label"
          tone="secondary"
          style={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}
        >
          {t('history.status')}
        </Text>
        <View style={styles.chips}>
          {STATUSES.map((option) => (
            <Button
              key={option.value}
              label={t(option.key as never)}
              variant={status === option.value ? 'primary' : 'secondary'}
              size="medium"
              fullWidth={false}
              onPress={() => setStatus(option.value)}
            />
          ))}
        </View>

        <Button
          label={t('history.apply')}
          onPress={() => {
            setFiltersOpen(false);
            void load();
          }}
          style={{ marginTop: theme.spacing.xl }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = {
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
};
