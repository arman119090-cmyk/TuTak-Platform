import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { walletApi } from '../../../data/api/walletApi';
import { formatDate, formatPoints } from '../../utils/format';
import type { BonusLedgerEntryDto } from '@tutak/shared-types';

function LedgerRow({ entry }: { entry: BonusLedgerEntryDto }) {
  const { theme, spacing, typography } = useAppTheme();
  const isCredit = Number(entry.amount) >= 0;
  const color = isCredit ? theme.bonusAvailable : theme.danger;

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[typography.callout, { color: theme.textPrimary }]}>{entry.type}</Text>
        <Text style={[typography.headline, { color }]}>{formatPoints(entry.amount)}</Text>
      </View>
      <Text style={[typography.caption, { color: theme.textSecondary, marginTop: spacing.xs }]}>
        {formatDate(entry.createdAt)}
      </Text>
    </Card>
  );
}

export function WalletScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const { data } = useQuery({ queryKey: ['wallet-ledger'], queryFn: () => walletApi.getMyLedger() });

  return (
    <ScreenContainer scroll={false}>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.md }]}>
        {t('wallet.history')}
      </Text>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <LedgerRow entry={item} />}
        ListEmptyComponent={
          <Text style={[typography.body, { color: theme.textSecondary }]}>{t('wallet.noTransactions')}</Text>
        }
      />
    </ScreenContainer>
  );
}
