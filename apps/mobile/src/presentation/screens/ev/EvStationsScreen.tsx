import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { EvStationDto } from '@tutak/shared-types';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { evApi } from '../../../data/api/evApi';

function ConnectorBadge({ status }: { status: string }) {
  const { theme, spacing, typography, radius } = useAppTheme();
  const color =
    status === 'AVAILABLE' ? theme.bonusAvailable : status === 'CHARGING' ? theme.bonusReserved : theme.textSecondary;
  return (
    <View
      style={{
        backgroundColor: `${color}22`,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        marginRight: spacing.xs,
        marginTop: spacing.xs,
      }}
    >
      <Text style={[typography.caption, { color }]}>{status}</Text>
    </View>
  );
}

function StationCard({ station }: { station: EvStationDto }) {
  const { theme, spacing, typography } = useAppTheme();
  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Text style={[typography.headline, { color: theme.textPrimary }]}>{station.name}</Text>
      <Text style={[typography.footnote, { color: theme.textSecondary, marginTop: spacing.xs }]}>
        {station.address}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
        {station.connectors.map((c) => (
          <ConnectorBadge key={c.id} status={c.status} />
        ))}
      </View>
    </Card>
  );
}

export function EvStationsScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const { data } = useQuery({ queryKey: ['ev-stations'], queryFn: evApi.listStations });

  return (
    <ScreenContainer scroll={false}>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.md }]}>
        {t('ev.stations')}
      </Text>
      <FlatList
        data={data ?? []}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <StationCard station={item} />}
        ListEmptyComponent={
          <Text style={[typography.body, { color: theme.textSecondary }]}>{t('common.comingSoon')}</Text>
        }
      />
    </ScreenContainer>
  );
}
