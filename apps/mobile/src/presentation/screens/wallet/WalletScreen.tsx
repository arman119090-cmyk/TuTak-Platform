import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { BonusComposition } from '../../components/BonusComposition';
import { SectionHeader } from '../../components/SectionHeader';
import { ListRow } from '../../components/ListRow';
import { PartnerMark } from '../../components/PartnerMark';
import { StatePill } from '../../components/StatePill';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { isWalletAbsent, walletApi } from '../../../data/api/walletApi';
import { formatDate, formatPoints } from '../../utils/format';
import { bonusStateFor, ledgerAmountFor } from '../../utils/transactionPresentation';

/**
 * The wallet as a statement, not a stack of cards.
 *
 * The first pass put the balance in a white card, the lifetime totals in
 * two grey tiles, the expiring lots in a group and the ledger in another —
 * four surfaces for one page of numbers, and the page read as a prototype
 * of a wallet. A financial statement does not box its sections; it sets
 * them in one column with the biggest number first, a rule under the
 * summary, and the lists beneath it separated by their headings alone.
 * That is what this is now: no card on the page at all.
 */
export function WalletScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();

  /*
   * Three sources, three sets of states (U06).
   *
   * The wallet, its ledger and its expiring lots come from three requests
   * that fail independently. Each is rendered from its own answer: a
   * ledger that did not arrive is "could not load", not an endless
   * skeleton; lots that did not arrive are not "nothing expiring soon";
   * and no lifetime total is a number until the wallet has answered.
   */
  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: walletApi.getMyWallet,
  });
  const wallet = walletQuery.data;
  const isLoading = walletQuery.isPending;
  // An account with no wallet is a state, not a fault — see `isWalletAbsent`.
  const noWallet = walletQuery.isError && isWalletAbsent(walletQuery.error);
  const walletFailed = walletQuery.isError && !noWallet && !wallet;
  const walletStale = walletQuery.isError && !noWallet && !!wallet;
  const refetch = walletQuery.refetch;

  const ledgerQuery = useQuery({
    queryKey: ['wallet-ledger'],
    queryFn: () => walletApi.getMyLedger(),
  });
  const ledger = ledgerQuery.data;
  const lotsQuery = useQuery({ queryKey: ['wallet-lots'], queryFn: walletApi.getMyLots });
  const lots = lotsQuery.data;

  // Soonest-expiring first — the only ordering that makes this list useful.
  const expiring = [...(lots ?? [])]
    .filter((l) => Number(l.remainingAmount) > 0)
    .sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt))
    .slice(0, 3);

  return (
    <Screen title={t('wallet.title')}>
      {isLoading ? (
        <View style={{ gap: space[4], paddingTop: space[2] }}>
          <Skeleton width="45%" height={36} />
          <Skeleton width="100%" height={10} style={{ borderRadius: 999 }} />
        </View>
      ) : noWallet ? (
        // Said plainly, and with no "Retry": asking again would produce
        // the same answer, because nothing failed. The balance is still
        // not drawn — there is no wallet to draw one from.
        <EmptyState title={t('wallet.noWalletTitle')} message={t('wallet.noWalletBody')} />
      ) : walletFailed || !wallet ? (
        // A failed wallet request leaves `wallet` undefined, and every
        // `?? 0` below then renders a confident, wrong zero balance. On a
        // loyalty app that is the one number a customer will believe and
        // act on, so it must not be shown when it was never received.
        <EmptyState
          title={t('common.error')}
          message={t('common.somethingWentWrong')}
          actionLabel={t('common.retry')}
          onAction={() => {
            void refetch();
          }}
        />
      ) : (
        <>
          {walletStale ? (
            <Text
              accessibilityRole="alert"
              style={[text.bodySm, { color: color.pendingText, marginBottom: space[3] }]}
            >
              {t('wallet.staleNotice', 'Connection lost. Showing the last known balance — it may have changed.')}
            </Text>
          ) : null}
          {/* The statement head: one caption, one number, the bar, the
              three states in a line. */}
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('wallet.totalBalance')}
          </Text>
          <Text style={[text.balanceSm, styles.tabular, { color: color.textPrimary, marginTop: 2 }]}>
            {formatPoints(
              Number(wallet.availableBonus) + Number(wallet.pendingBonus) + Number(wallet.reservedBonus),
            )}
          </Text>
          <View style={{ marginTop: space[4] }}>
            <BonusComposition
              available={wallet.availableBonus}
              pending={wallet.pendingBonus}
              reserved={wallet.reservedBonus}
            />
          </View>

          {/* Lifetime totals as one quiet line under a rule — a footnote to
              the balance, which is what they are, not two more cards. */}
          <View
            style={[
              styles.totals,
              {
                marginTop: space[5],
                paddingTop: space[4],
                borderTopColor: color.divider,
                gap: space[4],
              },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[text.caption, { color: color.textSecondary }]}>
                {t('wallet.lifetimeEarned')}
              </Text>
              <Text style={[text.headline, styles.tabular, { color: color.availableText, marginTop: 2 }]}>
                {formatPoints(wallet.lifetimeEarned)}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text style={[text.caption, { color: color.textSecondary }]}>
                {t('wallet.lifetimeSpent')}
              </Text>
              <Text style={[text.headline, styles.tabular, { color: color.textPrimary, marginTop: 2 }]}>
                {formatPoints(wallet.lifetimeSpent)}
              </Text>
            </View>
          </View>
        </>
      )}

      {lotsQuery.isError && !lots ? (
        // Not "nothing expiring": the list did not arrive. Said once, in
        // its place, with a way to ask again.
        <>
          <SectionHeader title={t('wallet.expiringSoon')} />
          <Text accessibilityRole="alert" style={[text.bodySm, { color: color.pendingText }]}>
            {t('wallet.lotsFailed', 'Expiring bonuses could not be loaded — this does not mean there are none.')}
          </Text>
          <Text
            accessibilityRole="button"
            onPress={() => {
              void lotsQuery.refetch();
            }}
            style={[text.bodySm, { color: color.primary, marginTop: space[2] }]}
          >
            {t('common.retry')}
          </Text>
        </>
      ) : null}
      {expiring.length > 0 ? (
        <>
          <SectionHeader title={t('wallet.expiringSoon')} />
          {expiring.map((lot, i) => (
            // Value first: the amount is the title, the date is the
            // subtitle, the state sits at the end. No clock glyph — every
            // row here is about expiry, so a clock on each said nothing.
            <ListRow
              key={lot.id}
              title={formatPoints(lot.remainingAmount)}
              subtitle={t('bonus.expiresOn', { date: formatDate(lot.expiresAt) })}
              trailing={<StatePill state={bonusStateFor(lot.status)} />}
              last={i === expiring.length - 1}
            />
          ))}
        </>
      ) : null}

      <SectionHeader title={t('wallet.history')} />
      {ledgerQuery.isPending ? (
        <View style={{ paddingVertical: space[3], gap: space[4] }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={40} />
          ))}
        </View>
      ) : !ledger ? (
        // The skeleton used to stay forever here: `!ledger` is true for a
        // failed request as well as a pending one.
        <EmptyState
          title={t('wallet.ledgerFailed', 'Your bonus history could not be loaded.')}
          actionLabel={t('common.retry')}
          onAction={() => {
            void ledgerQuery.refetch();
          }}
        />
      ) : ledger.items.length === 0 ? (
        <EmptyState title={t('wallet.noTransactions')} />
      ) : (
        ledger.items.map((entry, i) => {
          // Three directions, not two — a transfer between the wallet's
          // own buckets is shown unsigned, because nothing was gained or
          // lost. See `ledgerAmountFor`.
          const amount = ledgerAmountFor(entry.direction, entry.amount);
          return (
            <ListRow
              key={entry.id}
              /* `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §1.3: "wallet source rows
                 when the source is a partner". Most rows here have no
                 partner at all — an expiry, a referral reward, a manual
                 adjustment — and those keep the plain layout rather than
                 being given a business they had nothing to do with. */
              leading={
                entry.partnerBrand ? (
                  <PartnerMark
                    name={entry.partnerBrand.displayName}
                    logoUrl={entry.partnerBrand.logo?.thumbnailUrl}
                    size={36}
                  />
                ) : undefined
              }
              title={t(`bonusEntryType.${entry.type}`, { defaultValue: entry.type })}
              subtitle={
                entry.partnerBrand
                  ? `${entry.partnerBrand.displayName} · ${formatDate(entry.createdAt)}`
                  : formatDate(entry.createdAt)
              }
              value={amount.value}
              valueTone={amount.tone}
              last={i === ledger.items.length - 1}
            />
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  totals: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
});
