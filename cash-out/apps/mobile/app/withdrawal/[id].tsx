import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { WithdrawalTimelineEntryDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useWithdrawalStatus } from '../../src/hooks/useWithdrawalStatus';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { AmountRow, Button, Card, Screen, Skeleton, StatusChip, Text } from '../../src/ui';

export default function WithdrawalDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const { t, locale } = useI18n();
  const { withdrawal } = useWithdrawalStatus(id);

  const [timeline, setTimeline] = useState<WithdrawalTimelineEntryDto[]>([]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    try {
      setTimeline((await endpoints.timeline(api, id)).items);
    } catch {
      setTimeline([]);
    }
  }, [api, id]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline, withdrawal?.status]);

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <Screen footer={<Button label={t('common.close')} variant="secondary" onPress={() => router.back()} />}>
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('history.detailsTitle')}</Text>
      </View>

      {!withdrawal ? (
        <Card style={{ marginTop: theme.spacing.base }}>
          <Skeleton width="50%" height={28} />
          <Skeleton width="80%" height={16} style={{ marginTop: 12 }} />
          <Skeleton width="60%" height={16} style={{ marginTop: 8 }} />
        </Card>
      ) : (
        <>
          <Card style={{ marginTop: theme.spacing.base, alignItems: 'center' }}>
            <Text variant="amountLarge" tabular>
              {useI18nMoney(withdrawal.net)}
            </Text>
            <View style={{ marginTop: theme.spacing.sm }}>
              <StatusChip status={withdrawal.status} />
            </View>
          </Card>

          <Card style={{ marginTop: theme.spacing.base }}>
            <AmountRow label={t('withdraw.rowAmount')} amount={withdrawal.gross} />
            <AmountRow label={t('withdraw.rowPlatformFee')} amount={withdrawal.platformFee} negative />
            <AmountRow label={t('withdraw.rowProviderFee')} amount={withdrawal.providerFee} negative />
            <View
              style={{
                height: 1,
                backgroundColor: theme.colors.border,
                marginVertical: theme.spacing.sm,
              }}
            />
            <AmountRow label={t('withdraw.rowNet')} amount={withdrawal.net} emphasis />
          </Card>

          <Card style={{ marginTop: theme.spacing.base }}>
            <Row label={t('history.reference')} value={withdrawal.reference} />
            <Row label={t('withdraw.methodTitle')} value={withdrawal.payoutMethod.maskedIdentifier} />
            <Row label={t('history.requestedAt')} value={format(withdrawal.createdAt)} />
            {withdrawal.completedAt ? (
              <Row label={t('history.completedAt')} value={format(withdrawal.completedAt)} />
            ) : null}
          </Card>

          {timeline.length > 0 ? (
            <Card style={{ marginTop: theme.spacing.base }}>
              {timeline.map((entry, index) => (
                <View
                  key={`${entry.state}-${entry.at}`}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: theme.spacing.xs,
                    opacity: index === timeline.length - 1 ? 1 : 0.7,
                  }}
                >
                  <Text variant="caption" tone="secondary">
                    {entry.state}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {format(entry.at)}
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

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: theme.spacing.xs,
        gap: theme.spacing.base,
      }}
    >
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="body" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function useI18nMoney(amount: { minor: string; currency: string }): string {
  const { money } = useI18n();
  return money(amount);
}
