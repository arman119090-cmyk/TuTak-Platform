import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { TransactionDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { ListRow } from '../../components/ListRow';
import { PartnerMark } from '../../components/PartnerMark';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { transactionsApi } from '../../../data/api/transactionsApi';
import { formatAmd, formatDayGroup, formatPoints } from '../../utils/format';
import { transactionIcon, transactionTone } from '../../utils/transactionPresentation';

export function TransactionHistoryScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const { data, isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => transactionsApi.myHistory(),
  });

  // Grouping by day turns a flat wall of rows into something scannable —
  // the single highest-value change to a history list.
  const groups = useMemo(() => {
    const items = data?.items ?? [];
    const map = new Map<string, TransactionDto[]>();
    for (const tx of items) {
      const key = formatDayGroup(tx.createdAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(tx);
      else map.set(key, [tx]);
    }
    return Array.from(map.entries());
  }, [data]);

  return (
    <Screen title={t('wallet.history')}>
      {isLoading ? (
        <Surface padded={false}>
          <View style={{ padding: space[5], gap: space[4] }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={44} />
            ))}
          </View>
        </Surface>
      ) : groups.length === 0 ? (
        <Surface>
          <EmptyState title={t('wallet.noTransactions')} message={t('home.noActivityMessage')} />
        </Surface>
      ) : (
        groups.map(([day, items]) => (
          <View key={day} style={{ marginBottom: space[5] }}>
            <Text
              style={[
                text.overline,
                { color: color.textTertiary, marginBottom: space[2], textTransform: 'uppercase' },
              ]}
            >
              {day}
            </Text>
            <Surface padded={false}>
              <View style={{ paddingHorizontal: space[5] }}>
                {items.map((tx, i) => {
                  const tone = transactionTone(tx.type);
                  return (
                    <ListRow
                      key={tx.id}
                      /* `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §1.3 lists the full
                         transaction history — and the refund/reversal rows
                         inside it, which are ordinary rows of type REFUND —
                         among the surfaces that must identify the partner.
                         §2.2 is why this uses `tx.partnerBrand` rather than
                         looking the partner up: the row shows the brand the
                         operation was recorded under, so a rebrand does not
                         retroactively rewrite a receipt from last March.

                         A row with no partner (a manual adjustment, an
                         expiry) keeps the direction glyph — there is no
                         business to name, and naming one would be a lie. */
                      leading={
                        tx.partnerBrand ? (
                          <PartnerMark
                            name={tx.partnerBrand.displayName}
                            logoUrl={tx.partnerBrand.logo?.thumbnailUrl}
                            size={40}
                          />
                        ) : (
                          <View
                            style={[
                              styles.icon,
                              {
                                backgroundColor:
                                  tone === 'positive' ? color.availableSurface : color.surfaceSunken,
                                borderRadius: radius.md,
                              },
                            ]}
                          >
                            <Ionicons
                              name={transactionIcon(tx.type)}
                              size={18}
                              color={tone === 'positive' ? color.availableText : color.textSecondary}
                            />
                          </View>
                        )
                      }
                      title={
                        tx.partnerBrand?.displayName ??
                        t(`transactionType.${tx.type}`, { defaultValue: tx.type })
                      }
                      subtitle={
                        Number(tx.bonusAppliedAmount) > 0
                          ? t('qr.bonusAppliedShort', {
                              amount: formatPoints(tx.bonusAppliedAmount),
                            })
                          : tx.partnerBrand
                            ? `${t(`transactionType.${tx.type}`, { defaultValue: tx.type })} · ${t(`transactionStatus.${tx.status}`, { defaultValue: tx.status })}`
                            : t(`transactionStatus.${tx.status}`, { defaultValue: tx.status })
                      }
                      value={
                        tone === 'positive'
                          ? `+${formatPoints(tx.bonusEarnedAmount)}`
                          : formatAmd(tx.amount)
                      }
                      valueTone={tone}
                      last={i === items.length - 1}
                    />
                  );
                })}
              </View>
            </Surface>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
