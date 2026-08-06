import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { ListRow } from '../../components/ListRow';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { evApi } from '../../../data/api/evApi';
import { formatAmd, formatDateTime, formatEnergy } from '../../utils/format';

export function EvHistoryScreen() {
  const { t } = useTranslation();
  const { color, space, radius } = useTheme();
  const { data, isLoading } = useQuery({ queryKey: ['ev-history'], queryFn: evApi.myHistory });

  const sessions = data ?? [];
  const totalEnergy = sessions.reduce((sum, s) => sum + Number(s.energyKwh ?? 0), 0);

  return (
    <Screen title={t('ev.history')}>
      {sessions.length > 0 ? (
        <Surface style={{ marginBottom: space[5] }}>
          <Text style={{ color: color.textSecondary, fontSize: 13 }}>
            {t('ev.totalDelivered')}
          </Text>
          <Text
            style={{
              color: color.textPrimary,
              fontSize: 30,
              fontWeight: '600',
              marginTop: space[1],
            }}
          >
            {formatEnergy(totalEnergy)}
          </Text>
        </Surface>
      ) : null}

      <Surface padded={false}>
        <View style={{ paddingHorizontal: space[5] }}>
          {isLoading ? (
            <View style={{ paddingVertical: space[5], gap: space[4] }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={44} />
              ))}
            </View>
          ) : sessions.length === 0 ? (
            <EmptyState title={t('ev.noSessionsTitle')} message={t('ev.noSessionsMessage')} />
          ) : (
            sessions.map((s, i) => (
              <ListRow
                key={s.id}
                leading={
                  <View
                    style={[
                      styles.icon,
                      { backgroundColor: color.reservedSurface, borderRadius: radius.md },
                    ]}
                  >
                    <Ionicons name="flash" size={18} color={color.reservedText} />
                  </View>
                }
                title={formatEnergy(s.energyKwh ?? 0)}
                subtitle={s.stoppedAt ? formatDateTime(s.stoppedAt) : t(`evStatus.${s.status}`, { defaultValue: s.status })}
                value={formatAmd(s.cost ?? 0)}
                last={i === sessions.length - 1}
              />
            ))
          )}
        </View>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
