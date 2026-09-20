import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useBalance } from '../../src/hooks/useBalance';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { AmountField, Button, ErrorState, Screen, Text } from '../../src/ui';

/** AMD has two decimal places; drivers type whole drams. */
const MINOR_PER_MAJOR = 100n;

export default function WithdrawAmountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t, money } = useI18n();
  const describeError = useErrorMessage();
  const { balance, error: balanceError, refreshFresh } = useBalance({ immediate: false });

  // Fresh from the fleet, never the cache: the amount the driver types is
  // validated against the figure the server will actually use.
  useEffect(() => {
    void refreshFresh();
  }, [refreshFresh]);

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = balance?.withdrawable.currency ?? 'AMD';
  const withdrawableMinor = balance ? BigInt(balance.withdrawable.minor) : 0n;
  const requestedMinor = value ? BigInt(value) * MINOR_PER_MAJOR : 0n;

  const presets = useMemo(() => {
    const major = Number(withdrawableMinor / MINOR_PER_MAJOR);
    return [5_000, 10_000, 20_000, 50_000].filter((preset) => preset <= major);
  }, [withdrawableMinor]);

  const fresh = balance !== null && balance.fresh;
  const tooMuch = requestedMinor > withdrawableMinor;
  const canContinue = fresh && requestedMinor > 0n && !tooMuch;

  const goToReview = async (all: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const quote = await endpoints.quote(api, {
        payoutMethodId: (await defaultMethodId()) ?? '',
        all,
        ...(all ? {} : { amount: { minor: requestedMinor.toString(), currency } }),
      } as never);
      router.push({ pathname: '/withdraw/idram', params: { quote: JSON.stringify(quote) } });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  /** The iDram account is the destination; any other default is a fallback. */
  const defaultMethodId = async (): Promise<string | undefined> => {
    const idram = await endpoints.idramAccount(api).catch(() => ({ account: null }));
    if (idram.account?.status === 'ACTIVE') return idram.account.id;
    const result = await endpoints.payoutMethods(api);
    return (result.items.find((item) => item.isDefault) ?? result.items[0])?.id;
  };

  if (balanceError && !balance) {
    return (
      <Screen>
        <ErrorState
          title={t('balance.unavailableTitle')}
          body={describeError(balanceError)}
          retryLabel={t('balance.refresh')}
          onRetry={() => void refreshFresh()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label={t('common.continue')}
          onPress={() => void goToReview(false)}
          disabled={!canContinue}
          loading={busy || !balance}
          caption={balance && !balance.fresh ? t('balance.withdrawDisabledStale') : undefined}
        />
      }
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('withdraw.amountTitle')}</Text>
        {!balance ? (
          <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
            {t('balance.checking')}
          </Text>
        ) : null}
        {balance ? (
          <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
            {t('withdraw.aboveBalance', { amount: money(balance.withdrawable) })}
          </Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xxl }}>
          <AmountField
            value={value}
            onChange={(next) => {
              setValue(next);
              setError(null);
            }}
            currency={currency}
            error={
              error ??
              (tooMuch && balance
                ? t('withdraw.aboveBalance', { amount: money(balance.withdrawable) })
                : null)
            }
            presets={presets}
            onPresetPress={(preset) => setValue(String(preset))}
            allLabel={t('withdraw.all')}
            onAllPress={() => void goToReview(true)}
          />
        </View>
      </View>
    </Screen>
  );
}
