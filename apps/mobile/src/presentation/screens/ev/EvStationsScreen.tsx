import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { EvConnectorDto, EvStationDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { StatePill } from '../../components/StatePill';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { evApi } from '../../../data/api/evApi';
import { evStatusTone } from '../../utils/transactionPresentation';
import { formatAmd } from '../../utils/format';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function StationCard({
  station,
  onStart,
  startingConnectorId,
  disabled,
}: {
  station: EvStationDto;
  onStart: (connector: EvConnectorDto) => void;
  startingConnectorId: string | null;
  disabled: boolean;
}) {
  const { color, space, text, radius } = useTheme();
  const { t } = useTranslation();

  const free = station.connectors.filter((c) => c.status === 'AVAILABLE').length;
  const total = station.connectors.length;
  const anyFree = free > 0;

  return (
    <Surface style={{ marginBottom: space[3] }}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: anyFree ? color.availableSurface : color.surfaceSunken,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            name="flash"
            size={20}
            color={anyFree ? color.availableText : color.textTertiary}
          />
        </View>

        <View style={[styles.flex, { marginLeft: space[3] }]}>
          <Text style={[text.headline, { color: color.textPrimary }]} numberOfLines={1}>
            {station.name}
          </Text>
          <Text
            style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}
            numberOfLines={1}
          >
            {station.address}
          </Text>
        </View>

        <StatePill
          state={anyFree ? 'available' : 'pending'}
          label={t('ev.connectorsFree', { free, total })}
        />
      </View>

      {/* Connector strip: type, power and price at a glance — and the tap
          target that starts a session. An unavailable bay stays visible but
          inert, because "there is a CCS2 here and someone is using it" is
          different information from "there is no CCS2 here". */}
      <View style={[styles.connectors, { marginTop: space[4], gap: space[2] }]}>
        {station.connectors.map((c) => {
          const startable = c.status === 'AVAILABLE' && !disabled;
          const starting = startingConnectorId === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => onStart(c)}
              disabled={!startable || starting}
              accessibilityRole="button"
              accessibilityLabel={t('ev.startAt', {
                connector: c.connectorType.replace('_', ' '),
                station: station.name,
              })}
              style={({ pressed }) => [
                styles.connector,
                {
                  borderColor: startable ? color.availableFill : color.border,
                  backgroundColor: startable && pressed ? color.availableSurface : 'transparent',
                  opacity: startable || starting ? 1 : 0.55,
                  borderRadius: radius.md,
                  paddingHorizontal: space[3],
                  paddingVertical: space[2],
                  gap: space[2],
                },
              ]}
            >
              {starting ? (
                <ActivityIndicator size="small" color={color.availableText} />
              ) : (
                <View style={[styles.statusDot, { backgroundColor: dotFor(c.status, color) }]} />
              )}
              <Text style={[text.caption, { color: color.textPrimary }]}>
                {c.connectorType.replace('_', ' ')}
              </Text>
              <Text style={[text.caption, { color: color.textTertiary }]}>
                {Number(c.powerKw)} kW · {formatAmd(c.pricePerKwh)}
              </Text>
              {startable ? (
                <Ionicons name="play-circle" size={16} color={color.availableText} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Surface>
  );
}

function dotFor(status: string, color: ReturnType<typeof useTheme>['color']) {
  const tone = evStatusTone(status);
  return tone === 'available'
    ? color.availableFill
    : tone === 'reserved'
      ? color.reservedFill
      : color.textTertiary;
}

export function EvStationsScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['ev-stations'], queryFn: evApi.listStations });

  // A customer can only be charging in one place at a time, and the API
  // enforces it. Knowing about it here turns a confusing rejection into a
  // banner that takes them back to the session they already have.
  const { data: active } = useQuery({
    queryKey: ['ev-active-session'],
    queryFn: evApi.activeSession,
  });

  const start = useMutation({
    mutationFn: (connectorId: string) => evApi.startSession({ connectorId }),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: ['ev-stations'] });
      queryClient.setQueryData(['ev-active-session'], session);
      navigation.navigate('EvSession', { session });
    },
    onError: (err: unknown) => {
      // The server owns the rules here — the bay was taken a second ago, the
      // network is deactivated, the reservation belongs to someone else — so
      // show what it said rather than guessing.
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        t('common.somethingWentWrong');
      Alert.alert(t('ev.couldNotStart'), message);
    },
  });

  return (
    <Screen title={t('ev.stations')} subtitle={t('ev.stationsSubtitle')}>
      {active ? (
        <Pressable onPress={() => navigation.navigate('EvSession', { session: active })}>
          <Surface
            style={{
              marginBottom: space[3],
              backgroundColor: color.availableSurface,
            }}
          >
            <View style={styles.headerRow}>
              <Ionicons name="flash" size={20} color={color.availableText} />
              <View style={[styles.flex, { marginLeft: space[3] }]}>
                <Text style={[text.headline, { color: color.availableText }]}>
                  {t('ev.chargingNow')}
                </Text>
                <Text style={[text.caption, { color: color.availableText, marginTop: space[1] }]}>
                  {t('ev.tapToManage')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={color.availableText} />
            </View>
          </Surface>
        </Pressable>
      ) : null}

      {isLoading ? (
        <View style={{ gap: space[3] }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={132} style={{ borderRadius: radius.xl }} />
          ))}
        </View>
      ) : !data || data.length === 0 ? (
        <EmptyState title={t('ev.noStationsTitle')} message={t('ev.noStationsMessage')} />
      ) : (
        data.map((s) => (
          <StationCard
            key={s.id}
            station={s}
            onStart={(c) => start.mutate(c.id)}
            startingConnectorId={start.isPending ? (start.variables ?? null) : null}
            disabled={!!active || start.isPending}
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  connectors: { flexDirection: 'row', flexWrap: 'wrap' },
  connector: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
});
