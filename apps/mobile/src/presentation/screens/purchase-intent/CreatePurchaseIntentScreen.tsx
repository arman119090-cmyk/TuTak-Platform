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
import { partnerCheckoutApi } from '../../../data/api/partnerCheckoutApi';
import { partnersApi } from '../../../data/api/partnersApi';
import { walletApi } from '../../../data/api/walletApi';
import { balanceApi } from '../../../data/api/balanceApi';
import { describeApiError } from '../../../data/api/errors';
import { formatAmd, formatPoints } from '../../utils/format';
import {
  add,
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
  const { partnerId, partnerBranchId, partnerName, checkout } = route.params;

  // A till-opened purchase arrives with its gross already stated by the
  // business; the customer chooses only the funding. Everything else on
  // this screen is the same, which is the point (brief §40).
  const [grossAmount, setGrossAmount] = useState(checkout?.grossAmount ?? '');
  const [bonusAmount, setBonusAmount] = useState('');
  const [prepaidAmount, setPrepaidAmount] = useState('');
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

  /*
   * Money and bonus are two balances, never one number (§27). The stored
   * balance is a fact from the server, "not available on this deployment"
   * (also a fact, worded as one), or unknown while the request is in
   * flight or failed — and unknown is never drawn as zero.
   */
  const balanceQuery = useQuery({ queryKey: ['customer-balance'], queryFn: balanceApi.getMyBalance });
  const prepaidState: 'available' | 'unavailable' | 'loading' | 'error' = balanceQuery.data
    ? balanceQuery.data.state === 'AVAILABLE' && balanceQuery.data.balance.purchasesEnabled
      ? 'available'
      : 'unavailable'
    : balanceQuery.isError
      ? 'error'
      : 'loading';
  const availablePrepaid: Money | null =
    balanceQuery.data?.state === 'AVAILABLE' && balanceQuery.data.balance.purchasesEnabled
      ? parseMoney(balanceQuery.data.balance.available)
      : null;

  const create = useMutation({
    mutationFn: () =>
      checkout
        ? partnerCheckoutApi.claim(checkout.token, {
            bonusAmountRequested: bonusAmount || undefined,
            prepaidAmountApplied: prepaidAmount || undefined,
          })
        : purchaseIntentApi.create({
            partnerId,
            partnerBranchId,
            grossAmount,
            bonusAmountRequested: bonusAmount || undefined,
            prepaidAmountApplied: prepaidAmount || undefined,
          }),
    onSuccess: (intent) => {
      navigation.replace('PurchaseIntentStatus', { intent });
    },
    onError: (err) => {
      // The server explains exactly why — over max_bonus_payment_percent,
      // not a number, exceeds the wallet balance — and that reason is worth
      // more to the customer than a generic failure message.
      setError(
        describeApiError(err) ??
          t(checkout ? 'purchaseIntent.claimFailed' : 'purchaseIntent.createFailed'),
      );
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
  const prepaid: Money | null = prepaidAmount.trim() === '' ? 0n : parseMoney(prepaidAmount);
  const validation: string | null = (() => {
    if (grossAmount !== '' && !grossValid) return t('purchaseIntent.invalidAmount');
    if (bonus === null) return t('purchaseIntent.invalidBonus');
    if (prepaid === null) return t('purchaseIntent.invalidPrepaid');
    if (gross === null) return null;
    if (bonus !== 0n) {
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
    }
    if (prepaid !== 0n) {
      if (prepaidState === 'unavailable') return t('purchaseIntent.prepaidUnavailable');
      if (availablePrepaid !== null && compare(prepaid, availablePrepaid) > 0) {
        return t('purchaseIntent.prepaidOverBalance', {
          amount: formatAmd(moneyToString(availablePrepaid)),
        });
      }
    }
    if (compare(add(bonus, prepaid), gross) > 0) return t('purchaseIntent.componentsOverGross');
    return null;
  })();
  const canSubmit = grossValid && bonus !== null && prepaid !== null && validation === null;
  const localRemainder =
    gross !== null && bonus !== null && prepaid !== null ? subtract(subtract(gross, bonus), prepaid) : null;

  /*
   * The server's own breakdown for exactly these inputs (§2). The local
   * arithmetic above decides whether the button is on; the figure the
   * customer commits to is the server's when it has answered, and the same
   * local figure — computed by the same rule — until then.
   */
  const quoteQuery = useQuery({
    queryKey: ['purchase-quote', partnerId, grossAmount, bonusAmount, prepaidAmount],
    queryFn: () =>
      purchaseIntentApi.quote({
        partnerId,
        partnerBranchId,
        grossAmount,
        bonusAmountRequested: bonusAmount || undefined,
        prepaidAmountApplied: prepaidAmount || undefined,
      }),
    enabled: canSubmit,
    staleTime: 10_000,
  });
  const youPay: Money | null =
    quoteQuery.data && quoteQuery.data.canProceed
      ? parseMoney(quoteQuery.data.externalAmountDue)
      : localRemainder;

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

      {checkout ? (
        // The business stated the amount at its till. Shown, not editable:
        // a customer cannot lower a till's figure, and the server would
        // refuse anything but the till's own number anyway.
        <View style={{ marginBottom: space[4] }}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('purchaseIntent.tillAmount')}
          </Text>
          <Text style={[text.headline, { color: color.textPrimary, marginTop: space[1] }]}>
            {formatAmd(checkout.grossAmount)}
          </Text>
          <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>
            {t('purchaseIntent.tillAmountHint')}
          </Text>
        </View>
      ) : (
        <TextField
          label={t('purchaseIntent.grossAmount')}
          keyboardType="decimal-pad"
          value={grossAmount}
          onChangeText={setGrossAmount}
          placeholder="0"
        />
      )}

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

      {/*
        The second TuTak-side source (§27). Shown as "not available" — in
        words — when this deployment does not let a purchase draw on the
        balance; never hidden, never a zero. While the balance is unknown the
        field stays, with a hint saying so, because unknown is not empty.
      */}
      {prepaidState === 'unavailable' ? (
        <Text style={[text.caption, { color: color.textSecondary, marginTop: space[3] }]}>
          {t('purchaseIntent.prepaidUnavailable')}
        </Text>
      ) : (
        <TextField
          label={t('purchaseIntent.prepaidAmount')}
          keyboardType="decimal-pad"
          value={prepaidAmount}
          onChangeText={setPrepaidAmount}
          placeholder="0"
          hint={
            availablePrepaid !== null
              ? t('purchaseIntent.prepaidHint', { amount: formatAmd(moneyToString(availablePrepaid)) })
              : prepaidState === 'error'
                ? t('purchaseIntent.prepaidLoadFailed')
                : t('purchaseIntent.prepaidLoading')
          }
        />
      )}
      {prepaidState === 'error' ? (
        <Text
          accessibilityRole="button"
          onPress={() => {
            void balanceQuery.refetch();
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
        <View style={{ marginTop: space[4], gap: space[2] }}>
          {bonus !== null && bonus > 0n ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[text.bodySm, { color: color.textSecondary }]}>{t('qr.applyBonus')}</Text>
              <Text style={[text.bodySm, { color: color.reservedText }]}>
                −{formatPoints(moneyToString(bonus))}
              </Text>
            </View>
          ) : null}
          {prepaid !== null && prepaid > 0n ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[text.bodySm, { color: color.textSecondary }]}>
                {t('purchaseIntent.fromBalance')}
              </Text>
              <Text style={[text.bodySm, { color: color.reservedText }]}>
                −{formatAmd(moneyToString(prepaid))}
              </Text>
            </View>
          ) : null}
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
          {youPay === 0n ? (
            <Text style={[text.caption, { color: color.textSecondary }]}>
              {t('purchaseIntent.nothingAtTill')}
            </Text>
          ) : null}
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
