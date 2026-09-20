import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { TransactionDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { ListRow } from '../../components/ListRow';
import { PartnerMark } from '../../components/PartnerMark';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Button } from '../../components/Button';
import { transactionsApi } from '../../../data/api/transactionsApi';
import { formatAmd, formatDayGroup, formatPoints } from '../../utils/format';
import { transactionIcon, transactionTone } from '../../utils/transactionPresentation';

/**
 * Everything the customer has done, oldest page by page.
 *
 * ## Pages (U04)
 *
 * The first version fetched one page and stopped, so a customer with more
 * than twenty operations had a history that ended in the middle of last
 * week with nothing to say so. Pages are now walked with the server's
 * cursor. A page that fails to load is reported *under* the pages that did
 * — the rows already on screen were true, and a "try again" for the next
 * page must not blank them.
 *
 * ## The status is always there (U05)
 *
 * The subtitle used to show "−500 bonus" *instead of* the status whenever
 * bonus had been applied, so the one row where the customer most wants to
 * know whether the purchase went through was the one row that did not say.
 * Type and status are now always shown; the bonus is a third part.
 *
 * Tapping a row opens the operation, with the purchase behind it.
 */
export function TransactionHistoryScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const history = useInfiniteQuery({
    queryKey: ['transactions', 'history'],
    queryFn: ({ pageParam }) => transactionsApi.myHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = useMemo(
    () => history.data?.pages.flatMap((page) => page.items) ?? [],
    [history.data],
  );

  // Grouping by day turns a flat wall of rows into something scannable —
  // the single highest-value change to a history list.
  const groups = useMemo(() => {
    const map = new Map<string, TransactionDto[]>();
    for (const tx of items) {
      const key = formatDayGroup(tx.createdAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(tx);
      else map.set(key, [tx]);
    }
    return Array.from(map.entries());
  }, [items]);

  const firstPageFailed = history.isError && !history.data;
  const nextPageFailed = history.isFetchNextPageError;
  const refreshFailed = history.isError && !!history.data && !nextPageFailed;

  const subtitleFor = (tx: TransactionDto) => {
    const type = t(`transactionType.${tx.type}`, { defaultValue: tx.type });
    const status = t(`transactionStatus.${tx.status}`, { defaultValue: tx.status });
    const parts = tx.partnerBrand ? [type, status] : [status];
    if (Number(tx.bonusAppliedAmount) > 0) {
      parts.push(t('qr.bonusAppliedShort', { amount: formatPoints(tx.bonusAppliedAmount) }));
    }
    return parts.join(' · ');
  };

  return (
    <Screen title={t('wallet.history')}>
      {history.isPending ? (
        <Surface padded={false}>
          <View style={{ padding: space[5], gap: space[4] }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={44} />
            ))}
          </View>
        </Surface>
      ) : firstPageFailed ? (
        // Not the empty state. A failed request leaves `data` undefined, which
        // reaches the same branch as "this customer has no purchases yet" and
        // tells a tester their history is empty when it is unreachable — the
        // two need opposite next steps.
        <Surface>
          <EmptyState
            title={t('common.error')}
            message={t('common.somethingWentWrong')}
            actionLabel={t('common.retry')}
            onAction={() => {
              void history.refetch();
            }}
          />
        </Surface>
      ) : groups.length === 0 ? (
        <Surface>
          <EmptyState title={t('wallet.noTransactions')} message={t('home.noActivityMessage')} />
        </Surface>
      ) : (
        <>
          {refreshFailed ? (
            <Text
              accessibilityRole="alert"
              style={[text.bodySm, { color: color.pendingText, marginBottom: space[3] }]}
            >
              {t('history.staleNotice', 'Connection lost. Showing what was loaded before — it may be out of date.')}
            </Text>
          ) : null}
          {groups.map(([day, rows]) => (
            <View key={day} style={{ marginBottom: space[5] }}>
              <Text style={[text.label, { color: color.textSecondary, marginBottom: space[2], marginLeft: space[1] }]}>
                {day}
              </Text>
              <Surface tone="subtle" padded={false}>
                <View style={{ paddingHorizontal: space[4] }}>
                  {rows.map((tx, i) => {
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
                                { backgroundColor: color.surface, borderRadius: radius.md },
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
                        subtitle={subtitleFor(tx)}
                        value={
                          tone === 'positive'
                            ? `+${formatPoints(tx.bonusEarnedAmount)}`
                            : formatAmd(tx.amount)
                        }
                        valueTone={tone}
                        onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })}
                        last={i === rows.length - 1}
                      />
                    );
                  })}
                </View>
              </Surface>
            </View>
          ))}

          {/*
            The footer says one of three things, and never nothing: there is
            more (a button), the last page failed (the rows above stay, the
            button retries), or this is everything.
          */}
          <View style={{ alignItems: 'center', gap: space[3], paddingBottom: space[6] }}>
            {nextPageFailed ? (
              <Text accessibilityRole="alert" style={[text.bodySm, { color: color.pendingText }]}>
                {t('history.moreFailed', 'The next page could not be loaded. Everything above is still correct.')}
              </Text>
            ) : null}
            {history.hasNextPage ? (
              <Button
                label={
                  nextPageFailed
                    ? t('common.retry')
                    : t('history.loadMore', 'Show earlier operations')
                }
                variant="secondary"
                size="md"
                loading={history.isFetchingNextPage}
                onPress={() => {
                  void history.fetchNextPage();
                }}
              />
            ) : (
              <Text style={[text.bodySm, { color: color.textSecondary }]}>
                {t('history.endOfList', "That's everything.")}
              </Text>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
