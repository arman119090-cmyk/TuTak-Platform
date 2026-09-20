import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { PayoutMethodDto, QuoteDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, IdramCard, Screen, Text } from '../../src/ui';

/**
 * Step two of a withdrawal: where the money goes.
 *
 * The quote from the amount screen already names the destination; this screen
 * shows it — masked id, holder, verified or not — and lets the driver change
 * it before anything is authorised. It never lets an unverified account
 * through: the server would refuse, and the screen says so first.
 */
export default function WithdrawIdramScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ quote: string }>();
  const { api } = useAuth();
  const { t, money } = useI18n();

  const [account, setAccount] = useState<PayoutMethodDto | null | undefined>(undefined);

  const quote = (() => {
    try {
      return params.quote ? (JSON.parse(params.quote) as QuoteDto) : null;
    } catch {
      return null;
    }
  })();

  useFocusEffect(
    useCallback(() => {
      void endpoints
        .idramAccount(api)
        .then((result) => setAccount(result.account))
        .catch(() => setAccount(null));
    }, [api]),
  );

  const usable = !!account && account.status === 'ACTIVE' && account.id === quote?.payoutMethodId;

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={account ? t('common.continue') : t('idram.notLinkedCta')}
            onPress={() =>
              account
                ? router.push({ pathname: '/withdraw/authorize', params: { quote: params.quote } })
                : router.push('/idram/account')
            }
            disabled={!!account && !usable}
            caption={account && !usable ? t('idram.unverified') : undefined}
          />
          <Button
            label={t('idram.change')}
            variant="ghost"
            onPress={() => router.push('/idram/account')}
          />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('idram.confirmTitle')}</Text>
        {quote ? (
          <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
            {t('withdraw.rowNet')}: {money(quote.net)}
          </Text>
        ) : null}
      </View>

      <IdramCard account={account ?? null} />

      <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
        <Text variant="caption" tone="secondary">
          {t('idram.mockNote')}
        </Text>
      </Card>
    </Screen>
  );
}
