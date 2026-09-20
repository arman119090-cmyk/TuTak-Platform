import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { DriverIdChangeRequestDto, DriverIdStateDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Dialog, ListRow, Screen, Skeleton, StatusPill, Text } from '../../src/ui';

const STATUS_KEY = {
  PENDING: 'driverId.statusPending',
  APPROVED: 'driverId.statusApproved',
  REJECTED: 'driverId.statusRejected',
  CANCELLED: 'driverId.statusCancelled',
} as const;

const STATUS_TONE = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
} as const;

/**
 * The Driver ID: what it is now, whether a change is being checked, and every
 * change ever asked for. The id is the park's name for the driver; getting it
 * wrong pays the wrong person, so this screen never lets a new one become
 * active without the server's say-so.
 */
export default function DriverIdScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t, locale } = useI18n();
  const describeError = useErrorMessage();

  const [state, setState] = useState<DriverIdStateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<DriverIdChangeRequestDto | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await endpoints.driverId(api));
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

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  const note = (request: DriverIdChangeRequestDto) => {
    const key = request.verificationNote?.split(';')[0];
    switch (key) {
      case 'phone_matched':
        return t('driverId.notePhoneMatched');
      case 'phone_mismatch':
        return t('driverId.notePhoneMismatch');
      case 'profile_not_found':
        return t('driverId.noteNotFound');
      case 'yandex_unavailable':
        return t('driverId.noteUnavailable');
      default:
        return request.decisionReason ?? '';
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('driverId.requestChange')}
            onPress={() => router.push('/driver-id/request')}
            disabled={!state?.current || !!state.pending}
            caption={state?.pending ? t('driverId.pendingCaption') : undefined}
          />
          <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('driverId.title')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('driverId.subtitle')}
        </Text>
      </View>

      {state === null ? (
        <Card>
          <Skeleton width="50%" height={28} />
          <Skeleton width="70%" height={16} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <>
          <Card style={{ borderRadius: theme.radius.xxl, padding: theme.spacing.lg }}>
            <Text variant="label" tone="secondary">
              {t('driverId.current')}
            </Text>
            <Text variant="amountMedium" tabular style={{ marginTop: theme.spacing.xs }}>
              {state.current?.driverId ?? '—'}
            </Text>
            <Text variant="caption" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
              {state.current?.park.name ?? t('park.notFoundTitle')}
            </Text>
          </Card>

          {state.pending ? (
            <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <StatusPill tone="warning" label={t('driverId.statusPending')} />
                <Text variant="caption" tone="secondary">
                  {format(state.pending.requestedAt)}
                </Text>
              </View>
              <Text variant="bodyLarge" tabular style={{ marginTop: theme.spacing.sm }}>
                {state.pending.previousDriverId} → {state.pending.requestedDriverId}
              </Text>
              <Text variant="caption" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
                {note(state.pending)}
              </Text>
              <Button
                label={t('driverId.cancelRequest')}
                variant="ghost"
                fullWidth={false}
                style={{ marginTop: theme.spacing.sm, paddingHorizontal: 0 }}
                onPress={() => setCancelling(state.pending)}
              />
            </Card>
          ) : null}

          {state.history.length > 0 ? (
            <>
              <Text
                variant="label"
                tone="secondary"
                style={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}
              >
                {t('driverId.history')}
              </Text>
              <Card padded={false}>
                {state.history.map((request, index) => (
                  <ListRow
                    key={request.id}
                    label={`${request.previousDriverId} → ${request.requestedDriverId}`}
                    value={t(STATUS_KEY[request.status])}
                    first={index === 0}
                    last={index === state.history.length - 1}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}

      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.base }}>
          {error}
        </Text>
      ) : null}

      <Dialog
        visible={cancelling !== null}
        title={t('driverId.cancelConfirm')}
        confirmLabel={t('driverId.cancelRequest')}
        cancelLabel={t('common.back')}
        destructive
        onCancel={() => setCancelling(null)}
        onConfirm={() => {
          const target = cancelling;
          setCancelling(null);
          if (!target) return;
          void endpoints
            .cancelDriverIdRequest(api, target.id)
            .then(load)
            .catch((caught: unknown) => setError(describeError(caught)));
        }}
      />
    </Screen>
  );
}

export { STATUS_TONE as DRIVER_ID_STATUS_TONE };
