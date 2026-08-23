import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PurchaseIntentStatus as Status, type PurchaseIntentDto } from '@tutak/shared-types';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { PartnerMark } from '../../components/PartnerMark';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';
import { formatAmd, formatPoints } from '../../utils/format';

/**
 * Tracks one intent from creation to a terminal state. This screen never
 * writes to the intent — confirm/reject is the cashier's action, at the
 * till, on the partner dashboard (spec §7 steps 9-11) — it only polls
 * `GET /purchase-intents/:id` until the status stops being
 * AWAITING_CONFIRMATION.
 */
export function PurchaseIntentStatusScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius, layout } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'PurchaseIntentStatus'>>();
  const queryClient = useQueryClient();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const { data: intent } = useQuery({
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
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    navigation.goBack();
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
      <SafeAreaView style={[styles.flex, { backgroundColor: color.background }]}>
        <View style={[styles.wrap, { padding: layout.screenPaddingX }]}>
          <View
            style={[
              styles.mark,
              { backgroundColor: color.availableSurface, borderRadius: radius.full },
            ]}
          >
            <Ionicons name="checkmark" size={40} color={color.availableText} />
          </View>
          <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[6] }]}>
            {t('purchaseIntent.confirmed')}
          </Text>
          <BrandLine brand={intent.partnerBrand} />
          <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[3] }]}>
            {formatAmd(intent.grossAmount)}
          </Text>

          {Number(intent.bonusAmountRequested) > 0 ? (
            <Surface style={{ width: '100%', marginTop: space[8] }}>
              <View style={styles.row}>
                <Text style={[text.bodySm, { color: color.textSecondary }]}>
                  {t('qr.applyBonus')}
                </Text>
                <Text style={[text.headline, { color: color.reservedText }]}>
                  −{formatPoints(intent.bonusAmountRequested)}
                </Text>
              </View>
            </Surface>
          ) : null}

          <View style={{ width: '100%', marginTop: space[8] }}>
            <Button
              label={t('common.done')}
              onPress={done}
              icon={<JakoWingMark size={16} color={color.textInverse} />}
            />
          </View>
          <View style={{ marginTop: space[8], opacity: 0.35 }}>
            <Image
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              source={require('../../../../assets/logo-mark.png')}
              style={{ width: 32, height: 32 }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        </View>
      </SafeAreaView>
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
        <Surface style={{ paddingVertical: space[8] }}>
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
        </Surface>
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
        <Surface style={{ paddingVertical: space[8] }}>
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
        </Surface>
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
  return (
    <Screen title={t('purchaseIntent.statusTitle')}>
      <Surface style={{ paddingVertical: space[8] }}>
        <View style={{ alignItems: 'center' }}>
          <ActivityIndicator color={color.primary} />
          <Text style={[text.headline, { color: color.textPrimary, marginTop: space[4] }]}>
            {t('purchaseIntent.awaiting')}
          </Text>
          <BrandLine brand={intent.partnerBrand} />
          <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[3] }]}>
            {formatAmd(intent.grossAmount)}
          </Text>
          {Number(intent.bonusAmountRequested) > 0 ? (
            <Text style={[text.bodySm, { color: color.reservedText, marginTop: space[2] }]}>
              −{formatPoints(intent.bonusAmountRequested)} {t('qr.applyBonus').toLowerCase()}
            </Text>
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
        </View>
      </Surface>
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
