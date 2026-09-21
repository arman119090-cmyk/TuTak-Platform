import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  PaymentRoute,
  PurchaseIntentStatus as Status,
  type PurchaseIntentDto,
} from '@tutak/shared-types';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { PartnerMark } from '../../components/PartnerMark';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';
import { invalidateMoney } from '../../../data/query/invalidateMoney';
import { formatAmd, formatPoints } from '../../utils/format';
import { JakoScene } from '../../components/JakoScene';

/**
 * Tracks one intent from creation to a terminal state, polling
 * `GET /purchase-intents/:id` until the status stops being
 * AWAITING_CONFIRMATION.
 *
 * Confirm and reject are the cashier's actions, at the till, on the partner
 * dashboard (spec §7 steps 9-11) — this screen cannot do either. The one
 * write it does own is the customer's own way out: cancelling a purchase no
 * cashier has answered yet, which releases the bonus this intent reserved.
 * Losing that race to the cashier is normal and is rendered as what actually
 * happened, never as a cancellation.
 */
export function PurchaseIntentStatusScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'PurchaseIntentStatus'>>();
  const queryClient = useQueryClient();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const { data: intent, isError: pollError } = useQuery({
    queryKey: ['purchase-intent', route.params.intent.id],
    queryFn: () => purchaseIntentApi.get(route.params.intent.id),
    initialData: route.params.intent,
    // Stops polling once a terminal state arrives — nothing left to learn,
    // and the customer's screen should stop working the moment the
    // cashier's tap or the expiry sweep resolves it.
    refetchInterval: (query) =>
      query.state.data?.status === Status.AWAITING_CONFIRMATION ? 3000 : false,
  });

  const status = intent?.status ?? Status.AWAITING_CONFIRMATION;
  const isTerminal = status !== Status.AWAITING_CONFIRMATION;

  useEffect(() => {
    if (!intent?.expiresAt || isTerminal) return;
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.floor((+new Date(intent.expiresAt) - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [intent?.expiresAt, isTerminal]);

  const done = () => {
    // The purchase, if confirmed, already moved real money and bonus — the
    // wallet and transaction history must reflect it the moment this screen
    // is left, not on the next unrelated refetch.
    invalidateMoney(queryClient);
    navigation.goBack();
  };

  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelNow = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await purchaseIntentApi.cancel(route.params.intent.id);
      // Straight into the cache the poll reads, so the terminal state is on
      // screen before the next 3-second tick.
      queryClient.setQueryData(['purchase-intent', route.params.intent.id], updated);
      // The bonus this intent reserved is available again the moment the
      // server says CANCELLED — the balance must not keep showing it held.
      invalidateMoney(queryClient);
    } catch (error) {
      // 400 is the server saying the purchase left AWAITING_CONFIRMATION
      // first — the cashier got there, or the window ran out. That is not a
      // failure to report as one: refetch and let the real state render.
      const tooLate = axios.isAxiosError(error) && error.response?.status === 400;
      setCancelError(t(tooLate ? 'purchaseIntent.cancelTooLate' : 'purchaseIntent.cancelFailed'));
      if (tooLate) {
        queryClient.invalidateQueries({ queryKey: ['purchase-intent', route.params.intent.id] });
      }
    } finally {
      setCancelling(false);
    }
  };

  const askToCancel = () => {
    Alert.alert(t('purchaseIntent.cancelConfirmTitle'), t('purchaseIntent.cancelConfirmBody'), [
      { text: t('purchaseIntent.cancelKeep'), style: 'cancel' },
      { text: t('purchaseIntent.cancel'), style: 'destructive', onPress: () => void cancelNow() },
    ]);
  };

  if (!intent) {
    return (
      <Screen title={t('purchaseIntent.statusTitle')}>
        <ActivityIndicator color={color.primary} />
      </Screen>
    );
  }

  if (status === Status.CONFIRMED) {
    return (
      <JakoScene state="success" size="compact" title={t('purchaseIntent.confirmed')} note={t('scene.note.success')} logo={false}>
        <View style={styles.wrap}>
          <BrandLine brand={intent.partnerBrand} />
          <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[3] }]}>
            {formatAmd(intent.grossAmount)}
          </Text>

          <View style={{ width: '100%', marginTop: space[8] }}>
            <FundingLines intent={intent} settled />
          </View>

          <View style={{ width: '100%', marginTop: space[8] }}>
            <Button
              label={t('common.done')}
              onPress={done}
              icon={<JakoWingMark size={16} color={color.textInverse} />}
            />
          </View>
        </View>
      </JakoScene>
    );
  }

  const createAnother = () => {
    navigation.replace('CreatePurchaseIntent', {
      partnerId: intent.partnerId,
      partnerBranchId: intent.partnerBranchId ?? undefined,
    });
  };

  if (status === Status.REJECTED) {
    return (
      <Screen title={t('purchaseIntent.statusTitle')}>
        <View style={{ paddingVertical: space[8] }}>
          <View style={{ alignItems: 'center' }}>
            <View
              style={[
                styles.mark,
                { backgroundColor: color.dangerSurface, borderRadius: radius.full },
              ]}
            >
              <Ionicons name="close" size={32} color={color.dangerText} />
            </View>
            <Text style={[text.headline, { color: color.textPrimary, marginTop: space[4] }]}>
              {t('purchaseIntent.rejected')}
            </Text>
            <BrandLine brand={intent.partnerBrand} />
            <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[3] }]}>
              {formatAmd(intent.grossAmount)}
            </Text>
            {intent.rejectionReason ? (
              <Text
                style={[
                  text.bodySm,
                  { color: color.textSecondary, textAlign: 'center', marginTop: space[2] },
                ]}
              >
                {intent.rejectionReason}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ marginTop: space[6], gap: space[3] }}>
          <Button
            label={t('purchaseIntent.createNew')}
            onPress={createAnother}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
          <Button
            label={t('purchaseIntent.goHome')}
            onPress={done}
            variant="tertiary"
            icon={<JakoWingMark size={16} color={color.textBrand} />}
          />
        </View>
      </Screen>
    );
  }

  if (status === Status.CANCELLED) {
    return (
      <Screen title={t('purchaseIntent.statusTitle')}>
        <View style={{ paddingVertical: space[8] }}>
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="close-circle-outline" size={32} color={color.textSecondary} />
            <BrandLine brand={intent.partnerBrand} />
            <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[4] }]}>
              {formatAmd(intent.grossAmount)}
            </Text>
            <Text
              style={[
                text.bodySm,
                { color: color.textSecondary, textAlign: 'center', marginTop: space[2] },
              ]}
            >
              {t('purchaseIntent.cancelled')}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: space[6], gap: space[3] }}>
          <Button
            label={t('purchaseIntent.createNew')}
            onPress={createAnother}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
          <Button
            label={t('purchaseIntent.goHome')}
            onPress={done}
            variant="tertiary"
            icon={<JakoWingMark size={16} color={color.textBrand} />}
          />
        </View>
      </Screen>
    );
  }

  if (status === Status.EXPIRED) {
    return (
      <Screen title={t('purchaseIntent.statusTitle')}>
        <View style={{ paddingVertical: space[8] }}>
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="time-outline" size={32} color={color.pendingText} />
            <BrandLine brand={intent.partnerBrand} />
            <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[4] }]}>
              {formatAmd(intent.grossAmount)}
            </Text>
            <Text
              style={[
                text.bodySm,
                { color: color.textSecondary, textAlign: 'center', marginTop: space[2] },
              ]}
            >
              {t('purchaseIntent.expired')}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: space[6], gap: space[3] }}>
          <Button
            label={t('purchaseIntent.createNew')}
            onPress={createAnother}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
          <Button
            label={t('purchaseIntent.goHome')}
            onPress={done}
            variant="tertiary"
            icon={<JakoWingMark size={16} color={color.textBrand} />}
          />
        </View>
      </Screen>
    );
  }

  // AWAITING_CONFIRMATION
  //
  // A provider-routed purchase waits for two different things in turn, and
  // conflating them would mislead: first the business agrees the amount, then
  // the customer pays. Until `merchantApprovedAt` exists there is nothing to
  // pay — the server refuses a bill — so the Pay control only appears once it
  // does. The till code below stays either way: it is how the cashier finds
  // the purchase to approve it in the first place.
  const viaProvider = intent.paymentRoute === PaymentRoute.TUTAK_PSP;
  const readyToPay = viaProvider && !!intent.merchantApprovedAt;

  return (
    <Screen title={t('purchaseIntent.statusTitle')}>
      <View style={{ paddingVertical: space[8] }}>
        <View style={{ alignItems: 'center' }}>
          <ActivityIndicator color={color.primary} />
          <Text style={[text.headline, { color: color.textPrimary, marginTop: space[4] }]}>
            {viaProvider && !readyToPay
              ? t('purchaseIntent.awaitingApproval', 'Waiting for the business to agree the amount')
              : t('purchaseIntent.awaiting')}
          </Text>
          <BrandLine brand={intent.partnerBrand} />
          <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[3] }]}>
            {formatAmd(intent.grossAmount)}
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: space[4] }}>
            <FundingLines intent={intent} settled={false} />
          </View>
          {readyToPay ? (
            <View style={{ marginTop: space[5], alignSelf: 'stretch' }}>
              <Button
                label={t('psp.pay', 'Pay')}
                onPress={() =>
                  navigation.navigate('ProviderPayment', { purchaseIntentId: intent.id })
                }
              />
            </View>
          ) : null}
          {/*
            What the cashier actually needs: four digits the customer can
            read out across a counter. The purchase id is still shown, but
            below and small — it is what support asks for, not what a queue
            runs on. A purchase created before codes existed has none, and
            then the id is all there is.
          */}
          {intent.confirmationCode ? (
            <View style={{ alignItems: 'center', marginTop: space[5] }}>
              <Text style={[text.caption, { color: color.textSecondary }]}>
                {t('purchaseIntent.tillCode')}
              </Text>
              <Text
                accessibilityLabel={t('purchaseIntent.tillCodeAccessible', {
                  digits: intent.confirmationCode.split('').join(' '),
                })}
                style={[
                  text.balanceSm,
                  { color: color.textPrimary, letterSpacing: 6, marginTop: space[1] },
                ]}
              >
                {intent.confirmationCode}
              </Text>
            </View>
          ) : null}
          <Text style={[text.caption, { color: color.textTertiary, marginTop: space[2] }]}>
            {t('purchaseIntent.purchaseId')}: {intent.id.slice(-8).toUpperCase()}
          </Text>
          {secondsLeft !== null ? (
            <View
              style={[
                styles.timer,
                {
                  backgroundColor: secondsLeft < 60 ? color.pendingSurface : color.surfaceSunken,
                  borderRadius: radius.full,
                  paddingHorizontal: space[3],
                  paddingVertical: space[2],
                  marginTop: space[5],
                },
              ]}
            >
              <Text
                style={[
                  text.caption,
                  { color: secondsLeft < 60 ? color.pendingText : color.textSecondary },
                ]}
              >
                {t('qr.expiresIn', { time: formatCountdown(secondsLeft) })}
              </Text>
            </View>
          ) : null}
          {pollError ? (
            // `initialData` means this screen always has an intent to draw, so
            // a poll that stops answering leaves the spinner turning over a
            // status that may already have changed — at a till, with a cashier
            // waiting. The countdown keeps running either way; what it cannot
            // do on its own is say that the last few answers never arrived.
            <Text
              style={[
                text.caption,
                { color: color.pendingText, marginTop: space[3], textAlign: 'center' },
              ]}
            >
              {t('common.somethingWentWrong')}
            </Text>
          ) : null}
          {cancelError ? (
            <Text
              style={[
                text.caption,
                { color: color.dangerText, marginTop: space[3], textAlign: 'center' },
              ]}
            >
              {cancelError}
            </Text>
          ) : null}
        </View>
      </View>
      {/*
        The way out, for the customer who mistyped the amount or picked the
        wrong branch. Tertiary and below the card on purpose: waiting for the
        cashier is the expected path, and this must not compete with it —
        but it has to be reachable without leaving the screen, because the
        bonus stays reserved until this intent ends.
      */}
      <View style={{ marginTop: space[6] }}>
        <Button
          label={t('purchaseIntent.cancel')}
          onPress={askToCancel}
          variant="tertiary"
          disabled={cancelling}
        />
      </View>
    </Screen>
  );
}

function formatCountdown(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Who this purchase is with, on every one of the four states.
 *
 * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §1.3 names "pending/confirmed/rejected/
 * expired purchase state" individually, and all four get the same treatment
 * here rather than only the happy one — a customer looking at a rejection
 * needs to know which business rejected them at least as much as they needed
 * to know who confirmed.
 *
 * `intent.partnerBrand` is the snapshot taken when the intent was created
 * (spec §2.2), not a live read: a partner replacing its logo while a purchase
 * is still awaiting confirmation must not change what the customer is looking
 * at mid-transaction.
 */
function BrandLine({ brand }: { brand: PurchaseIntentDto['partnerBrand'] }) {
  const { color, space, text } = useTheme();
  if (!brand) return null;
  return (
    <View style={{ alignItems: 'center', marginTop: space[4] }}>
      <PartnerMark name={brand.displayName} logoUrl={brand.logo?.url} size={48} />
      <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2] }]}>
        {brand.displayName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timer: {},
});

/**
 * The three funding components, each on its own line, and the figure that
 * matters at the till — the server's `ordinaryPaymentRemainder`, never a
 * subtraction done here (§27–28). A zero is said in words: "nothing to pay
 * at the till", and never "paid" before the cashier has confirmed.
 */
function FundingLines({ intent, settled }: { intent: PurchaseIntentDto; settled: boolean }) {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const bonus = Number(intent.bonusAmountRequested) > 0;
  const prepaid = Number(intent.prepaidAmountApplied ?? '0') > 0;
  const remainder = Number(intent.ordinaryPaymentRemainder);
  const viaProvider = intent.paymentRoute === PaymentRoute.TUTAK_PSP;
  const row = (label: string, value: string, tone: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] }}>
      <Text style={[text.bodySm, { color: color.textSecondary }]}>{label}</Text>
      <Text style={[text.bodySm, { color: tone }]}>{value}</Text>
    </View>
  );
  return (
    <View>
      {bonus ? row(t('qr.applyBonus'), `−${formatPoints(intent.bonusAmountRequested)}`, color.reservedText) : null}
      {prepaid
        ? row(t('purchaseIntent.fromBalance'), `−${formatAmd(intent.prepaidAmountApplied)}`, color.reservedText)
        : null}
      {remainder > 0
        ? row(
            t(viaProvider ? 'purchaseIntent.inTutak' : 'purchaseIntent.atTill'),
            formatAmd(intent.ordinaryPaymentRemainder),
            color.textPrimary,
          )
        : (
            <Text style={[text.caption, { color: color.textSecondary, marginTop: space[2] }]}>
              {t(settled ? 'purchaseIntent.paidViaTutak' : 'purchaseIntent.nothingAtTill')}
            </Text>
          )}
    </View>
  );
}
