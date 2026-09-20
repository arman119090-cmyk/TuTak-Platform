import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { PartnerMark } from '../../components/PartnerMark';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { JakoWingMark } from '../../components/V2NavIcon';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';
import { partnersApi } from '../../../data/api/partnersApi';
import { walletApi } from '../../../data/api/walletApi';
import { describeApiError } from '../../../data/api/errors';
import { formatAmd, formatPoints } from '../../utils/format';
import {
  compare,
  moneyToString,
  parseMoney,
  percentOfFloor,
  subtract,
  type Money,
} from '../../../domain/money';

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

  /*
   * The balance is a fact from the server or it is unknown — never zero by
   * default (U07). A customer typing a bonus against "0 points available"
   * because the request had not answered yet was told they had nothing to
   * spend; the server would then have accepted the purchase they gave up
   * on.
   */
  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: walletApi.getMyWallet });
  const availableBonus: Money | null = walletQuery.data
    ? parseMoney(walletQuery.data.availableBonus)
    : null;

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

  /*
   * The same rules the server applies in `PurchaseIntentsService.create`,
   * checked exactly (scaled integers, four decimals) so the preview can be
   * believed. The server still decides — this is what the customer sees
   * before pressing the button, and why the button is off when it would be
   * refused. Nothing is clamped: a bonus larger than the bill is an error
   * to fix, not a remainder of zero to admire.
   */
  const gross = parseMoney(grossAmount);
  const grossValid = gross !== null && gross > 0n;
  const bonus: Money | null = bonusAmount.trim() === '' ? 0n : parseMoney(bonusAmount);
  const bonusCeiling =
    gross !== null && Number.isInteger(partner?.maxBonusPaymentPercent)
      ? percentOfFloor(gross, partner!.maxBonusPaymentPercent)
      : null;
  const validation: string | null = (() => {
    if (grossAmount !== '' && !grossValid) return t('purchaseIntent.invalidAmount');
    if (bonus === null) return t('purchaseIntent.invalidBonus');
    if (gross === null || bonus === 0n) return null;
    if (compare(bonus, gross) > 0) return t('purchaseIntent.bonusOverGross');
    if (bonusCeiling !== null && compare(bonus, bonusCeiling) > 0) {
      return t('purchaseIntent.bonusOverLimit', {
        percent: partner?.maxBonusPaymentPercent,
        max: formatPoints(moneyToString(bonusCeiling)),
      });
    }
    if (availableBonus !== null && compare(bonus, availableBonus) > 0) {
      return t('purchaseIntent.bonusOverBalance', {
        amount: formatPoints(moneyToString(availableBonus)),
      });
    }
    return null;
  })();
  const canSubmit = grossValid && bonus !== null && validation === null;
  const youPay = gross !== null && bonus !== null ? subtract(gross, bonus) : null;

  if (partnerLoading) {
    return (
      <Screen title={t('purchaseIntent.createTitle')} subtitle={partnerName}>
        <View style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <ActivityIndicator color={color.primary} />
        </View>
      </Screen>
    );
  }

  if (partnerFailed) {
    return (
      <Screen title={t('purchaseIntent.createTitle')}>
        <View style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <Text style={[text.bodySm, { color: color.dangerText, textAlign: 'center' }]}>
            {t('purchaseIntent.partnerLoadFailed')}
          </Text>
        </View>
        <View style={{ marginTop: space[5] }}>
          <Button
            label={t('common.retry')}
            onPress={() => refetchPartner()}
            variant="secondary"
            loading={partnerRetrying}
            icon={<JakoWingMark size={16} color={color.textPrimary} />}
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
        <View style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <Text style={[text.bodySm, { color: color.textSecondary, textAlign: 'center' }]}>
            {t('purchaseIntent.partnerInactive')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t('purchaseIntent.createTitle')} subtitle={partner.displayName}>
      {/* `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §1.3: the QR purchase preview is a
          named surface. This is the moment the customer commits an amount to
          a business they have just scanned a code for, so it is the moment
          they most need to see that business's own mark and not a generic
          symbol — the logo is a second, non-textual confirmation that the
          scanned id resolved to who they think they are standing in front of.

          Deliberately the *current* published logo (`partner.logo`, from the
          server read this screen already does — never the scanned code's
          claim). The snapshot only becomes authoritative once the intent
          exists; see `PurchaseIntentStatusScreen`. */}
      <View style={{ marginBottom: space[5], paddingVertical: space[3] }}>
        {/* Centred on an inner view, not via `alignItems` on the Surface:
            `Surface` nests its children under a full-width fill, so alignment
            set on the outer element centres that fill rather than anything in
            it.

            The name is deliberately not repeated here — `Screen`'s subtitle
            above already carries it, from the same server-resolved record.
            Two copies of it would be noise, and the mark's own accessibility
            label names the partner for a screen reader. */}
        <View style={{ alignItems: 'center' }}>
          <PartnerMark name={partner.displayName} logoUrl={partner.logo?.url} size={64} />
          <Text style={[text.caption, { color: color.textSecondary, marginTop: space[3] }]}>
            {t('purchaseIntent.cashbackHere', {
              percent: partner.bonusAccrualRateBps / 100,
              defaultValue: `${partner.bonusAccrualRateBps / 100}% back`,
            })}
          </Text>
        </View>
      </View>

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
        hint={
          availableBonus !== null
            ? t('qr.availableToSpend', { amount: formatPoints(moneyToString(availableBonus)) })
            : walletQuery.isError
              ? t('purchaseIntent.balanceUnavailable')
              : t('purchaseIntent.balanceLoading')
        }
      />
      {walletQuery.isError && !walletQuery.data ? (
        <Text
          accessibilityRole="button"
          onPress={() => {
            void walletQuery.refetch();
          }}
          style={[text.bodySm, { color: color.primary, marginTop: space[1] }]}
        >
          {t('common.retry')}
        </Text>
      ) : null}

      {validation ? (
        <Text
          accessibilityRole="alert"
          style={[text.bodySm, { color: color.dangerText, marginTop: space[2] }]}
        >
          {validation}
        </Text>
      ) : null}

      {error ? (
        <Text style={[text.bodySm, { color: color.dangerText, marginTop: space[2] }]}>{error}</Text>
      ) : null}

      {canSubmit && youPay !== null ? (
        <View style={{ marginTop: space[4] }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={[text.bodySm, { color: color.textSecondary }]}>
              {t('purchaseIntent.youPay')}
            </Text>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {formatAmd(moneyToString(youPay))}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: space[4] }}>
        <Text style={[text.bodySm, { color: color.textSecondary }]}>
          {t('purchaseIntent.expiryNotice')}
        </Text>
      </View>

      <View style={{ marginTop: space[7] }}>
        <Button
          label={t('purchaseIntent.submit')}
          onPress={() => {
            setError(null);
            create.mutate();
          }}
          loading={create.isPending}
          disabled={!canSubmit}
          icon={<JakoWingMark size={16} color={color.textInverse} />}
        />
      </View>
    </Screen>
  );
}
