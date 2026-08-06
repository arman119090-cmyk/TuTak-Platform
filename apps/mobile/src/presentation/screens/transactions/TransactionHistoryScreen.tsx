import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { TransactionDto } from '@tutak/shared-types';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { transactionsApi } from '../../../data/api/transactionsApi';
import { formatAmd, formatDate } from '../../utils/format';

function TransactionRow({ tx }: { tx: TransactionDto }) {
  const { theme, spacing, typography } = useAppTheme();
  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[typography.callout, { color: theme.textPrimary }]}>{tx.type}</Text>
        <Text style={[typography.headline, { color: theme.textPrimary }]}>{formatAmd(tx.amount)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Text style={[typography.caption, { color: theme.textSecondary }]}>{tx.status}</Text>
        <Text style={[typography.caption, { color: theme.textSecondary }]}>{formatDate(tx.createdAt)}</Text>
      </View>
    </Card>
  );
}

export function TransactionHistoryScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const { data } = useQuery({ queryKey: ['transactions'], queryFn: () => transactionsApi.myHistory() });

  return (
    <ScreenContainer scroll={false}>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.md }]}>
        {t('wallet.history')}
      </Text>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(tx) => tx.id}
        renderItem={({ item }) => <TransactionRow tx={item} />}
        ListEmptyComponent={
          <Text style={[typography.body, { color: theme.textSecondary }]}>{t('wallet.noTransactions')}</Text>
        }
      />
    </ScreenContainer>
  );
}
