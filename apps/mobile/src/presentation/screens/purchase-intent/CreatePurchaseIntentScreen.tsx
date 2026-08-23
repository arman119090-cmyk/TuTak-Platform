import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { JakoWingMark } from '../../components/V2NavIcon';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';
import { partnersApi } from '../../../data/api/partnersApi';
import { walletApi } from '../../../data/api/walletApi';
import { describeApiError } from '../../../data/api/errors';
import { formatAmd, formatPoints } from '../../utils/format';

/**
 * Spec §7 steps 1-8: the customer enters the amounts themselves, on the
 * partner they already picked. The amount is never editable again after
 * this screen submits — the next screen only tracks the intent to a
 * terminal state, it cannot change it — matching
 * PurchaseIntentsService.create()'s server-side invariant that a customer
 * sets the figures once.
 *
 * GitHub issue #28 (HIGH, 2026-08-16): `route.params.partnerName` is never
 * a trusted value — a QR scan (`ScanQrScreen`) only ever supplies a bare
 * `partnerId`, so relying on the param alone let a substituted or stale
 * code reach this screen with no verified merchant identity shown before
 * the customer commits an amount. This screen now always resolves the
 * partner from the server (`GET /partners/:id`, the same public read
 * `PartnersScreen` already trusts) and keeps the amount form disabled
 * until that resolves to a name and an active business — `partnerName`
 * is used only as an instant placeholder while that request is in flight,
 * never as the thing actually shown once it resolves.
 */
export function CreatePurchaseIntentScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CreatePurchaseIntent'>>();
  const { partnerId, partnerBranchId, partnerName } = route.params;

  const [grossAmount, setGrossAmount] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const {
    data: partner,
    isLoading: partnerLoading,
    isError: partnerFailed,
    refetch: refetchPartner,
    isRefetching: partnerRetrying,
  } = useQuery({ queryKey: ['partner', partnerId], queryFn: () => partnersApi.get(partnerId) });

  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: walletApi.getMyWallet });
  const availableBonus = wallet?.availableBonus ?? '0';

  const create = useMutation({
    mutationFn: () =>
      purchaseIntentApi.create({
        partnerId,
        partnerBranchId,
        grossAmount,
        bonusAmountRequested: bonusAmount || undefined,
      }),
    onSuccess: (intent) => {
      navigation.replace('PurchaseIntentStatus', { intent });
    },
    onError: (err) => {
      // The server explains exactly why — over max_bonus_payment_percent,
      // not a number, exceeds the wallet balance — and that reason is worth
      // more to the customer than a generic failure message.
      setError(describeApiError(err) ?? t('purchaseIntent.createFailed'));
    },
  });

  const grossValid = /^\d+(\.\d{1,4})?$/.test(grossAmount) && Number(grossAmount) > 0;

  if (partnerLoading) {
    return (
      <Screen title={t('purchaseIntent.createTitle')} subtitle={partnerName}>
        <Surface style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <ActivityIndicator color={color.primary} />
        </Surface>
      </Screen>
    );
  }

  if (partnerFailed) {
    return (
      <Screen title={t('purchaseIntent.createTitle')}>
        <Surface style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <Text style={[text.bodySm, { color: color.dangerText, textAlign: 'center' }]}>
            {t('purchaseIntent.partnerLoadFailed')}
          </Text>
        </Surface>
        <View style={{ marginTop: space[5] }}>
          <Button
            label={t('common.retry')}
            onPress={() => refetchPartner()}
            variant="secondary"
            loading={partnerRetrying}
          />
        </View>
      </Screen>
    );
  }

  if (!partner) {
    // Neither loading nor failed, yet no data — react-query's contract
    // guarantees this doesn't happen, but the type doesn't, and silently
    // falling through to `partner.isActive` below is exactly the kind of
    // untrusted-identity gap this screen exists to close.
    return (
      <Screen title={t('purchaseIntent.createTitle')}>
        <ActivityIndicator color={color.primary} />
      </Screen>
    );
  }

  if (!partner.isActive) {
    return (
      <Screen title={t('purchaseIntent.createTitle')} subtitle={partner.displayName}>
        <Surface style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <Text style={[text.bodySm, { color: color.textSecondary, textAlign: 'center' }]}>
            {t('purchaseIntent.partnerInactive')}
          </Text>
        </Surface>
      </Screen>
    );
  }

  return (
    <Screen title={t('purchaseIntent.createTitle')} subtitle={partner.displayName}>
      <TextField
        label={t('purchaseIntent.grossAmount')}
        keyboardType="decimal-pad"
        value={grossAmount}
        onChangeText={setGrossAmount}
        placeholder="0"
      />

      <TextField
        label={t('purchaseIntent.bonusAmount')}
        keyboardType="decimal-pad"
        value={bonusAmount}
        onChangeText={setBonusAmount}
        placeholder="0"
        hint={t('qr.availableToSpend', { amount: formatPoints(availableBonus) })}
      />

      {error ? (
        <Text style={[text.bodySm, { color: color.dangerText, marginTop: space[2] }]}>
          {error}
        </Text>
      ) : null}

      {grossValid ? (
        <Surface style={{ marginTop: space[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[text.bodySm, { color: color.textSecondary }]}>
              {t('purchaseIntent.youPay')}
            </Text>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {formatAmd(Math.max(0, Number(grossAmount || 0) - Number(bonusAmount || 0)))}
            </Text>
          </View>
        </Surface>
      ) : null}

      <Surface style={{ marginTop: space[4] }}>
        <Text style={[text.bodySm, { color: color.textSecondary }]}>
          {t('purchaseIntent.expiryNotice')}
        </Text>
      </Surface>

      <View style={{ marginTop: space[7] }}>
        <Button
          label={t('purchaseIntent.submit')}
          onPress={() => {
            setError(null);
            create.mutate();
          }}
          loading={create.isPending}
          disabled={!grossValid}
          icon={<JakoWingMark size={16} color={color.textInverse} />}
        />
      </View>
    </Screen>
  );
}
