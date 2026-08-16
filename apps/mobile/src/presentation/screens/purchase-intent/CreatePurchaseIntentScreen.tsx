import React, { useState } from 'react';
import { Text, View } from 'react-native';
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
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';
import { walletApi } from '../../../data/api/walletApi';
import { describeApiError } from '../../../data/api/errors';
import { formatAmd, formatPoints } from '../../utils/format';

/**
 * Spec §7 steps 1-8: the customer enters the amounts themselves, on the
 * partner they already picked (a map card's "Pay" action passed `partnerId`
 * here). The amount is never editable again after this screen submits — the
 * next screen only tracks the intent to a terminal state, it cannot change
 * it — matching PurchaseIntentsService.create()'s server-side invariant that
 * a customer sets the figures once.
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

  return (
    <Screen title={t('purchaseIntent.createTitle')} subtitle={partnerName}>
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
        />
      </View>
    </Screen>
  );
}
