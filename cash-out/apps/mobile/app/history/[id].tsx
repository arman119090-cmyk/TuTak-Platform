import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { HistoryEntryDetailDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import {
  AmountRow,
  Button,
  Card,
  ErrorState,
  ListRow,
  Screen,
  Skeleton,
  StatusPill,
  Text,
  historyStatusLabelKey,
  historyStatusTone,
  historyTypeLabelKey,
} from '../../src/ui';

/**
 * One operation: date, time, type, amount, balance after, status, operation
 * id, comment — and, for a withdrawal, its fee breakdown and timeline.
 */
export default function OperationDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const { t, money, locale } = useI18n();
  const describeError = useErrorMessage();

  const [detail, setDetail] = useState<HistoryEntryDetailDto | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setDetail(await endpoints.historyDetail(api, id));
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const intl = locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US';
  const date = (iso: string) =>
    new Intl.DateTimeFormat(intl, { dateStyle: 'medium' }).format(new Date(iso));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(intl, { timeStyle: 'short' }).format(new Date(iso));
  const dateTime = (iso: string) =>
    new Intl.DateTimeFormat(intl, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  if (error && !detail) {
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

  const entry = detail?.entry;
  const negative = entry?.amount.minor.startsWith('-') ?? false;

  return (
    <Screen
      footer={
        <Button label={t('common.close')} variant="secondary" onPress={() => router.back()} />
      }
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('history.detailsTitle')}</Text>
      </View>

      {!entry ? (
        <Card style={{ marginTop: theme.spacing.base }}>
          <Skeleton width="50%" height={28} />
          <Skeleton width="80%" height={16} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <>
          <Card style={{ marginTop: theme.spacing.base, alignItems: 'center' }}>
            <Text variant="label" tone="secondary">
              {t(historyTypeLabelKey(entry.type))}
              {entry.origin === 'AUTO_PAYOUT' ? ` · ${t('history.autoPayoutTag')}` : ''}
            </Text>
            <Text
              variant="amountLarge"
              tabular
              tone={negative ? 'primary' : 'success'}
              style={{ marginTop: theme.spacing.xs }}
            >
              {negative ? '−' : '+'}
              {money({
                minor: negative ? entry.amount.minor.slice(1) : entry.amount.minor,
                currency: entry.amount.currency,
              })}
            </Text>
            <View style={{ marginTop: theme.spacing.sm }}>
              <StatusPill
                tone={historyStatusTone(entry.status)}
                label={t(historyStatusLabelKey(entry.status))}
              />
            </View>
          </Card>

          <Card padded={false} style={{ marginTop: theme.spacing.base }}>
            <ListRow label={t('history.date')} value={date(entry.at)} first />
            <ListRow label={t('history.time')} value={time(entry.at)} />
            <ListRow label={t('history.operationId')} value={entry.operationId} />
            <ListRow
              label={t('history.balanceAfter')}
              value={entry.balanceAfter ? money(entry.balanceAfter) : '—'}
            />
            {entry.park ? <ListRow label={t('balance.park')} value={entry.park.name} /> : null}
            <ListRow
              label={t('history.comment')}
              value={
                entry.comment === 'under_review' ? t('history.underReview') : (entry.comment ?? '—')
              }
              last
            />
          </Card>

          {detail?.withdrawal ? (
            <Card style={{ marginTop: theme.spacing.base }}>
              <AmountRow label={t('withdraw.rowAmount')} amount={detail.withdrawal.gross} />
              <AmountRow
                label={t('withdraw.rowPlatformFee')}
                amount={detail.withdrawal.platformFee}
                negative
              />
              <AmountRow
                label={t('withdraw.rowProviderFee')}
                amount={detail.withdrawal.providerFee}
                negative
              />
              <View
                style={{
                  height: 1,
                  backgroundColor: theme.colors.border,
                  marginVertical: theme.spacing.sm,
                }}
              />
              <AmountRow label={t('withdraw.rowNet')} amount={detail.withdrawal.net} emphasis />
              <Text variant="caption" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
                {t('idram.recipient')}: {detail.withdrawal.payoutMethod.displayName ?? ''}{' '}
                {detail.withdrawal.payoutMethod.maskedIdentifier}
              </Text>
            </Card>
          ) : null}

          {detail && detail.timeline.length > 0 ? (
            <Card style={{ marginTop: theme.spacing.base }}>
              {detail.timeline.map((step, index) => (
                <View
                  key={`${step.state}-${step.at}`}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: theme.spacing.xs,
                    opacity: index === detail.timeline.length - 1 ? 1 : 0.7,
                  }}
                >
                  <Text variant="caption" tone="secondary">
                    {step.state}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {dateTime(step.at)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
