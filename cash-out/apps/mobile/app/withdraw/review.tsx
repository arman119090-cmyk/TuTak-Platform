import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { QuoteDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { newIdempotencyKey } from '../../src/auth/session';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { AmountRow, Button, Card, Screen, Sheet, Text } from '../../src/ui';

/**
 * The screen the brief is really about: the driver sees the amount, both fees,
 * and the exact figure that will arrive, before anything happens.
 *
 * Two details that matter more than they look:
 *
 *  - The idempotency key is minted **once**, when this screen mounts, and is
 *    reused by every retry of this confirmation. It identifies the driver's
 *    intent, not an HTTP attempt, so a tap-after-timeout is recognised by the
 *    server as the same withdrawal rather than a second one.
 *  - The quote carries its own countdown. When it expires the numbers are gone,
 *    not stale: the screen refuses to submit and offers a refresh, because a
 *    driver must never confirm a fee they were not shown.
 */
export default function ReviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ quote: string }>();
  const { api } = useAuth();
  const { t, money } = useI18n();
  const describeError = useErrorMessage();

  const quote = useMemo<QuoteDto | null>(() => {
    try {
      return params.quote ? (JSON.parse(params.quote) as QuoteDto) : null;
    } catch {
      return null;
    }
  }, [params.quote]);

  const [idempotencyKey] = useState(newIdempotencyKey);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(quote?.expiresAt));

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft(secondsUntil(quote?.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [quote?.expiresAt]);

  if (!quote) {
    router.back();
    return null;
  }

  const expired = secondsLeft <= 0;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const withdrawal = await endpoints.confirm(api, {
        quoteId: quote.quoteId,
        signature: quote.signature,
        idempotencyKey,
      });
      setConfirming(false);
      router.replace({ pathname: '/withdraw/processing', params: { id: withdrawal.id } });
    } catch (caught) {
      setConfirming(false);
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          {error ? (
            <Text variant="body" tone="danger" align="center">
              {error}
            </Text>
          ) : null}
          <Button
            label={
              expired
                ? t('common.retry')
                : t('withdraw.confirmCta', { amount: money(quote.net) })
            }
            caption={expired ? t('withdraw.quoteExpired') : undefined}
            onPress={() => (expired ? router.back() : setConfirming(true))}
            loading={busy}
          />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('withdraw.reviewTitle')}</Text>

        <Card style={{ marginTop: theme.spacing.xl }}>
          <AmountRow label={t('withdraw.rowAmount')} amount={quote.gross} />
          <AmountRow label={t('withdraw.rowPlatformFee')} amount={quote.platformFee} negative />
          <AmountRow label={t('withdraw.rowProviderFee')} amount={quote.providerFee} negative />
          <View
            style={{
              height: 1,
              backgroundColor: theme.colors.border,
              marginVertical: theme.spacing.sm,
            }}
          />
          <AmountRow label={t('withdraw.rowNet')} amount={quote.net} emphasis />
        </Card>

        <Text
          variant="caption"
          tone={expired ? 'danger' : 'tertiary'}
          align="center"
          style={{ marginTop: theme.spacing.base }}
        >
          {expired
            ? t('withdraw.quoteExpired')
            : `${secondsLeft}s`}
        </Text>
      </View>

      <Sheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        dismissable={!busy}
        title={t('withdraw.reviewTitle')}
        footer={
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={t('common.confirm')}
              onPress={() => void confirm()}
              loading={busy}
            />
            <Button
              label={t('common.cancel')}
              variant="ghost"
              disabled={busy}
              onPress={() => setConfirming(false)}
            />
          </View>
        }
      >
        <Text variant="amountMedium" align="center" tabular>
          {money(quote.net)}
        </Text>
        <Text variant="body" tone="secondary" align="center" style={{ marginTop: theme.spacing.xs }}>
          {t('withdraw.rowNet')}
        </Text>
      </Sheet>
    </Screen>
  );
}

function secondsUntil(iso: string | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}
