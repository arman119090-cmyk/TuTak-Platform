import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { BonusComposition } from '../../components/BonusComposition';
import { SectionHeader } from '../../components/SectionHeader';
import { ListRow } from '../../components/ListRow';
import { PartnerMark } from '../../components/PartnerMark';
import { StatePill } from '../../components/StatePill';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { walletApi } from '../../../data/api/walletApi';
import { formatDate, formatPoints } from '../../utils/format';
import { bonusStateFor, ledgerAmountFor } from '../../utils/transactionPresentation';

export function WalletScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();

  const {
    data: wallet,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['wallet'],
    queryFn: walletApi.getMyWallet,
  });
  const { data: ledger } = useQuery({
    queryKey: ['wallet-ledger'],
    queryFn: () => walletApi.getMyLedger(),
  });
  const { data: lots } = useQuery({ queryKey: ['wallet-lots'], queryFn: walletApi.getMyLots });

  // Soonest-expiring first — the only ordering that makes this list useful.
  const expiring = [...(lots ?? [])]
    .filter((l) => Number(l.remainingAmount) > 0)
    .sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt))
    .slice(0, 3);

  return (
    <Screen title={t('wallet.title')}>
      <Surface>
        {isLoading ? (
          <View style={{ gap: space[4] }}>
            <Skeleton width="45%" height={36} />
            <Skeleton width="100%" height={10} style={{ borderRadius: 999 }} />
          </View>
        ) : isError ? (
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
            <Text style={[text.caption, { color: color.textSecondary }]}>
              {t('wallet.totalBalance')}
            </Text>
            <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[1], marginBottom: space[5] }]}>
              {formatPoints(
                Number(wallet?.availableBonus ?? 0) +
                  Number(wallet?.pendingBonus ?? 0) +
                  Number(wallet?.reservedBonus ?? 0),
              )}
            </Text>
            <BonusComposition
              available={wallet?.availableBonus ?? 0}
              pending={wallet?.pendingBonus ?? 0}
              reserved={wallet?.reservedBonus ?? 0}
            />
          </>
        )}
      </Surface>

      {/* Lifetime totals — secondary, so they sit in plain grey text. */}
      <View style={[styles.totals, { marginTop: space[5], gap: space[3] }]}>
        <Surface style={styles.flex}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('wallet.lifetimeEarned')}
          </Text>
          <Text style={[text.headline, { color: color.availableText, marginTop: space[1] }]}>
            {formatPoints(wallet?.lifetimeEarned ?? 0)}
          </Text>
        </Surface>
        <Surface style={styles.flex}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('wallet.lifetimeSpent')}
          </Text>
          <Text style={[text.headline, { color: color.textPrimary, marginTop: space[1] }]}>
            {formatPoints(wallet?.lifetimeSpent ?? 0)}
          </Text>
        </Surface>
      </View>

      {expiring.length > 0 ? (
        <>
          <SectionHeader title={t('wallet.expiringSoon')} />
          <Surface padded={false}>
            <View style={{ paddingHorizontal: space[5] }}>
              {expiring.map((lot, i) => (
                <ListRow
                  key={lot.id}
                  leading={
                    <View
                      style={[
                        styles.lotIcon,
                        { backgroundColor: color.pendingSurface, borderRadius: radius.md },
                      ]}
                    >
                      <Ionicons name="time-outline" size={18} color={color.pendingText} />
                    </View>
                  }
                  title={formatPoints(lot.remainingAmount)}
                  subtitle={t('bonus.expiresOn', { date: formatDate(lot.expiresAt) })}
                  trailing={<StatePill state={bonusStateFor(lot.status)} />}
                  last={i === expiring.length - 1}
                />
              ))}
            </View>
          </Surface>
        </>
      ) : null}

      <SectionHeader title={t('wallet.history')} />
      <Surface padded={false}>
        <View style={{ paddingHorizontal: space[5] }}>
          {!ledger ? (
            <View style={{ paddingVertical: space[5], gap: space[4] }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={40} />
              ))}
            </View>
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
        </View>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  totals: { flexDirection: 'row' },
  lotIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
