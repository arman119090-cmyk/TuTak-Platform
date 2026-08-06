import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { EvStationDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { StatePill } from '../../components/StatePill';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { evApi } from '../../../data/api/evApi';
import { evStatusTone } from '../../utils/transactionPresentation';
import { formatAmd } from '../../utils/format';

function StationCard({ station }: { station: EvStationDto }) {
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

      {/* Connector strip: type, power and price at a glance, no tap needed. */}
      <View style={[styles.connectors, { marginTop: space[4], gap: space[2] }]}>
        {station.connectors.map((c) => (
          <View
            key={c.id}
            style={[
              styles.connector,
              {
                borderColor: color.border,
                borderRadius: radius.md,
                paddingHorizontal: space[3],
                paddingVertical: space[2],
                gap: space[2],
              },
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: dotFor(c.status, color) }]}
            />
            <Text style={[text.caption, { color: color.textPrimary }]}>
              {c.connectorType.replace('_', ' ')}
            </Text>
            <Text style={[text.caption, { color: color.textTertiary }]}>
              {Number(c.powerKw)} kW · {formatAmd(c.pricePerKwh)}
            </Text>
          </View>
        ))}
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
  const { space, radius } = useTheme();
  const { data, isLoading } = useQuery({ queryKey: ['ev-stations'], queryFn: evApi.listStations });

  return (
    <Screen title={t('ev.stations')} subtitle={t('ev.stationsSubtitle')}>
      {isLoading ? (
        <View style={{ gap: space[3] }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={132} style={{ borderRadius: radius.xl }} />
          ))}
        </View>
      ) : !data || data.length === 0 ? (
        <EmptyState title={t('ev.noStationsTitle')} message={t('ev.noStationsMessage')} />
      ) : (
        data.map((s) => <StationCard key={s.id} station={s} />)
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
