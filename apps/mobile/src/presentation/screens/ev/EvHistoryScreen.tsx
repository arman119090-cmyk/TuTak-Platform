import React from 'react';
import { FlatList, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { EvSessionDto } from '@tutak/shared-types';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { evApi } from '../../../data/api/evApi';

function SessionRow({ session }: { session: EvSessionDto }) {
  const { theme, spacing, typography } = useAppTheme();
  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <Text style={[typography.callout, { color: theme.textPrimary }]}>{session.status}</Text>
      <Text style={[typography.footnote, { color: theme.textSecondary, marginTop: spacing.xs }]}>
        {session.energyKwh ?? '0'} kWh — {session.cost ?? '0'} AMD
      </Text>
    </Card>
  );
}

export function EvHistoryScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const { data } = useQuery({ queryKey: ['ev-history'], queryFn: evApi.myHistory });

  return (
    <ScreenContainer scroll={false}>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.md }]}>
        {t('ev.history')}
      </Text>
      <FlatList
        data={data ?? []}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <SessionRow session={item} />}
        ListEmptyComponent={
          <Text style={[typography.body, { color: theme.textSecondary }]}>{t('wallet.noTransactions')}</Text>
        }
      />
    </ScreenContainer>
  );
}
