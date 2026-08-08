import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { StatePill } from '../../components/StatePill';
import { TextField } from '../../components/TextField';
import { Skeleton } from '../../components/Skeleton';
import { evApi } from '../../../data/api/evApi';
import { walletApi } from '../../../data/api/walletApi';
import { formatAmd, formatEnergy, formatPoints } from '../../utils/format';
import { estimateSessionCost, formatElapsed } from '../../utils/evSession';

/**
 * A charging session while it is running.
 *
 * The energy figure is not something this app can compute — it arrives from
 * the charge point through `POST /ev/sessions/:id/meter-value`, and the bill
 * is built from it at stop time. So this screen polls rather than counts:
 * the only number it derives locally is the clock, which is cosmetic. Cost is
 * shown as an estimate for the same reason — the authoritative figure is the
 * one the server computes when the session ends.
 */
export function EvSessionScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'EvSession'>>();
  const queryClient = useQueryClient();

  const [bonusToApply, setBonusToApply] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Only the clock ticks locally; everything else comes from the poll below.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: session, isLoading } = useQuery({
    queryKey: ['ev-active-session'],
    queryFn: evApi.activeSession,
    // The charge point reports every few seconds at most; polling faster
    // would spend the customer's battery to show the same number.
    refetchInterval: 5000,
    initialData: route.params?.session ?? undefined,
  });

  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: walletApi.getMyWallet });

  const stop = useMutation({
    mutationFn: () => evApi.stopSession(session!.id, bonusToApply.trim() || undefined),
    onSuccess: async (stopped) => {
      await queryClient.invalidateQueries({ queryKey: ['ev-active-session'] });
      await queryClient.invalidateQueries({ queryKey: ['ev-stations'] });
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      Alert.alert(
        t('ev.sessionEnded'),
        t('ev.sessionEndedBody', {
          energy: formatEnergy(stopped.energyKwh ?? 0),
          cost: formatAmd(stopped.cost ?? 0),
          points: formatPoints(stopped.bonusEarned ?? 0),
        }),
      );
      navigation.goBack();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        t('common.somethingWentWrong');
      Alert.alert(t('ev.couldNotStop'), message);
    },
  });

  const price = session?.connector?.pricePerKwh;
  const estimatedCost = useMemo(
    () => estimateSessionCost(session?.energyKwh, price),
    [session?.energyKwh, price],
  );

  const available = Number(wallet?.availableBonus ?? 0);
  const bonusNumber = Number(bonusToApply || 0);
  const bonusTooLarge = bonusNumber > available;

  if (isLoading && !session) {
    return (
      <Screen title={t('ev.sessionTitle')}>
        <Skeleton width="100%" height={220} style={{ borderRadius: radius.xl }} />
      </Screen>
    );
  }

  if (!session) {
    // Reached by opening the screen after the session already ended — a stop
    // from another device, or a back-navigation into a stale route.
    return (
      <Screen title={t('ev.sessionTitle')}>
        <Surface>
          <Text style={[text.body, { color: color.textSecondary }]}>{t('ev.noActiveSession')}</Text>
          <View style={{ marginTop: space[4] }}>
            <Button label={t('common.back')} variant="secondary" onPress={() => navigation.goBack()} />
          </View>
        </Surface>
      </Screen>
    );
  }

  return (
    <Screen title={t('ev.sessionTitle')} subtitle={session.connector?.station.name}>
      <Surface>
        <View style={styles.headerRow}>
          <View
            style={[
              styles.icon,
              { backgroundColor: color.availableSurface, borderRadius: radius.md },
            ]}
          >
            <Ionicons name="flash" size={20} color={color.availableText} />
          </View>
          <View style={[styles.flex, { marginLeft: space[3] }]}>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {session.connector?.connectorType.replace('_', ' ') ?? t('ev.connector')}
            </Text>
            {price ? (
              <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>
                {formatAmd(price)} / kWh
              </Text>
            ) : null}
          </View>
          <StatePill state="available" label={t('ev.charging')} />
        </View>

        {/* The three numbers that matter, largest first. */}
        <View style={[styles.metrics, { marginTop: space[5], gap: space[4] }]}>
          <View style={styles.flex}>
            <Text style={[text.caption, { color: color.textTertiary }]}>{t('ev.elapsed')}</Text>
            <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[1] }]}>
              {session.startedAt ? formatElapsed(session.startedAt, now) : '—'}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text style={[text.caption, { color: color.textTertiary }]}>{t('ev.delivered')}</Text>
            <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[1] }]}>
              {formatEnergy(session.energyKwh ?? 0)}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text style={[text.caption, { color: color.textTertiary }]}>{t('ev.estimated')}</Text>
            <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[1] }]}>
              {estimatedCost === null ? '—' : formatAmd(estimatedCost)}
            </Text>
          </View>
        </View>

        <Text style={[text.caption, { color: color.textTertiary, marginTop: space[4] }]}>
          {t('ev.estimateNote')}
        </Text>
      </Surface>

      {available > 0 ? (
        <Surface style={{ marginTop: space[3] }}>
          <View style={{ marginTop: space[3] }}>
            <TextField
              label={t('ev.payWithPoints')}
              hint={t('ev.pointsAvailable', { points: formatPoints(available) })}
              value={bonusToApply}
              onChangeText={setBonusToApply}
              placeholder="0"
              keyboardType="numeric"
              error={bonusTooLarge ? t('ev.notEnoughPoints') : undefined}
            />
          </View>
        </Surface>
      ) : null}

      <View style={{ marginTop: space[5] }}>
        <Button
          label={t('ev.stopCharging')}
          variant="destructive"
          loading={stop.isPending}
          disabled={stop.isPending || bonusTooLarge}
          onPress={() => stop.mutate()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  metrics: { flexDirection: 'row' },
});
