import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { AutoPayoutStateDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Dialog, ListRow, Screen, Skeleton, StatusPill, Text } from '../../src/ui';

/**
 * Automatic payout: what the rule is, whether it is on, when it next looks,
 * and what happened last time. Editing and enabling go through the edit
 * screen, which ends in the PIN; disabling is one tap, because stopping
 * money must always be easy.
 */
export default function AutoPayoutScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t, money, locale } = useI18n();
  const describeError = useErrorMessage();

  const [state, setState] = useState<AutoPayoutStateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await endpoints.autoPayout(api));
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [api, describeError]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rule = state?.rule ?? null;
  const active = !!rule && rule.enabled && !rule.paused;

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  const cadenceLabel = (cadence: 'ON_THRESHOLD' | 'DAILY' | 'WEEKLY') =>
    cadence === 'ON_THRESHOLD'
      ? t('autoPayout.cadenceOnThreshold')
      : cadence === 'DAILY'
        ? t('autoPayout.cadenceDaily')
        : t('autoPayout.cadenceWeekly');

  const summary = rule
    ? rule.cadence === 'ON_THRESHOLD'
      ? t('autoPayout.summaryOnThreshold', { threshold: money(rule.threshold) })
      : t('autoPayout.summaryScheduled', {
          when: cadenceLabel(rule.cadence),
          hour: String(rule.runHour ?? 0).padStart(2, '0'),
          threshold: money(rule.threshold),
        })
    : null;

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={rule ? t('autoPayout.edit') : t('autoPayout.enable')}
            onPress={() => router.push('/auto-payout/edit')}
          />
          {active ? (
            <Button
              label={t('autoPayout.disable')}
              variant="secondary"
              onPress={() => setDisableOpen(true)}
            />
          ) : null}
          <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('autoPayout.title')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('autoPayout.subtitle')}
        </Text>
      </View>

      {state === null ? (
        <Card>
          <Skeleton width="50%" height={24} />
          <Skeleton width="80%" height={16} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <>
          <Card
            tone={active ? 'brand' : 'surface'}
            style={{ borderRadius: theme.radius.xxl, padding: theme.spacing.lg }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <StatusPill
                tone={active ? 'success' : rule?.paused ? 'warning' : 'neutral'}
                label={
                  active
                    ? t('autoPayout.statusOn')
                    : rule?.paused
                      ? t('autoPayout.statusPaused')
                      : t('autoPayout.statusOff')
                }
              />
            </View>
            <Text variant="title" style={{ marginTop: theme.spacing.md }}>
              {summary ?? t('autoPayout.noRule')}
            </Text>
            {rule?.paused && rule.pausedReason ? (
              <Text variant="caption" tone="warning" style={{ marginTop: theme.spacing.xs }}>
                {t('autoPayout.pausedBody')}
              </Text>
            ) : null}
          </Card>

          {rule ? (
            <Card padded={false} style={{ marginTop: theme.spacing.base }}>
              <ListRow
                label={t('autoPayout.destination')}
                value={rule.destination.maskedIdentifier}
                first
              />
              <ListRow label={t('balance.park')} value={rule.park.name} />
              <ListRow
                label={t('autoPayout.maxPayout')}
                value={rule.maxPayout ? money(rule.maxPayout) : t('autoPayout.everything')}
              />
              <ListRow
                label={t('autoPayout.nextCheck')}
                value={rule.nextCheckAt ? format(rule.nextCheckAt) : '—'}
              />
              <ListRow
                label={t('autoPayout.lastRun')}
                value={rule.lastRunAt ? format(rule.lastRunAt) : '—'}
                onPress={
                  rule.lastWithdrawalId
                    ? () =>
                        router.push({
                          pathname: '/withdrawal/[id]',
                          params: { id: rule.lastWithdrawalId! },
                        })
                    : undefined
                }
                last
              />
            </Card>
          ) : null}
        </>
      )}

      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.base }}>
          {error}
        </Text>
      ) : null}

      <Dialog
        visible={disableOpen}
        title={t('autoPayout.disableConfirm')}
        confirmLabel={t('autoPayout.disable')}
        cancelLabel={t('common.cancel')}
        destructive
        onCancel={() => setDisableOpen(false)}
        onConfirm={() => {
          setDisableOpen(false);
          void endpoints
            .disableAutoPayout(api)
            .then(load)
            .catch((caught: unknown) => setError(describeError(caught)));
        }}
      />
    </Screen>
  );
}
