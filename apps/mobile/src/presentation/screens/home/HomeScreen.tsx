import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { BalanceCard } from '../../components/BalanceCard';
import { Button } from '../../components/Button';
import { HomeHeader } from '../../components/HomeHeader';
import { JakoWingMark } from '../../components/V2NavIcon';
import { QuickAction } from '../../components/QuickAction';
import { PartnerSpotlight } from '../../components/PartnerSpotlight';
import { ReferralEntryCard } from '../../components/ReferralEntryCard';
import { SectionHeader } from '../../components/SectionHeader';
import { ListRow } from '../../components/ListRow';
import { PartnerMark } from '../../components/PartnerMark';
import { EmptyState } from '../../components/EmptyState';
import { Surface } from '../../components/Surface';
import { Skeleton } from '../../components/Skeleton';
import { isWalletAbsent, walletApi } from '../../../data/api/walletApi';
import { transactionsApi } from '../../../data/api/transactionsApi';
import { useAuthStore } from '../../../data/stores/authStore';
import { formatDayGroup, formatSigned } from '../../utils/format';
import { transactionIcon, transactionTone } from '../../utils/transactionPresentation';
import type { MainTabParamList, RootStackParamList } from '../../../app/navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

export function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, layout, radius } = useTheme();
  const { user } = useAuthStore();

  const {
    data: wallet,
    isLoading: walletLoading,
    isError: walletError,
    error: walletErrorValue,
    refetch: refetchWallet,
  } = useQuery({
    queryKey: ['wallet'],
    queryFn: walletApi.getMyWallet,
  });
  // An account with no wallet is a state, not a fault — see `isWalletAbsent`.
  const noWallet = walletError && isWalletAbsent(walletErrorValue);
  const { data: txs, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => transactionsApi.myHistory(),
  });

  const recent = txs?.items.slice(0, 4) ?? [];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: color.background }]} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: layout.tabBarHeight + space[6] }}
      >
        <View
          style={{
            paddingHorizontal: layout.screenPaddingX,
            paddingTop: space[2],
            paddingBottom: space[4],
          }}
        >
          <HomeHeader
            firstName={user?.firstName}
            onNotifications={() => navigation.navigate('Notifications')}
            // The avatar is where every other app keeps the account, so it
            // goes to the profile tab rather than nowhere.
            onProfile={() => navigation.navigate('Settings')}
          />
        </View>

        <View style={{ paddingHorizontal: layout.screenPaddingX }}>
          {noWallet ? (
            // Said plainly, and with no "Retry": nothing failed, so asking
            // again would produce the same answer. Still no balance drawn —
            // there is no wallet behind this account to draw one from.
            <Surface>
              <EmptyState
                title={t('wallet.noWalletTitle')}
                message={t('wallet.noWalletBody')}
              />
            </Surface>
          ) : walletError ? (
            // `BalanceCard` renders `available ?? 0`, so a failed request puts
            // a confident "0 points" on the first screen of the app. A
            // customer reading that has no way to tell it from having spent
            // everything, and the balance is the number this whole product is
            // about.
            <Surface>
              <EmptyState
                title={t('common.error')}
                message={t('common.somethingWentWrong')}
                actionLabel={t('common.retry')}
                onAction={() => {
                  void refetchWallet();
                }}
              />
            </Surface>
          ) : (
            <BalanceCard
              available={wallet?.availableBonus}
              pending={wallet?.pendingBonus}
              reserved={wallet?.reservedBonus}
              loading={walletLoading}
            />
          )}
        </View>

        {/* Unverified accounts can pay and charge, but cannot earn — the
            backend gates accrual on isPhoneVerified, so this is the one
            action that actually unblocks the product for a new customer. */}
        {user && !user.isPhoneVerified ? (
          <Pressable
            onPress={() => navigation.navigate('VerifyPhone')}
            style={[
              styles.verifyBanner,
              {
                marginHorizontal: layout.screenPaddingX,
                marginTop: space[4],
                backgroundColor: color.pendingSurface,
                borderRadius: radius.lg,
                padding: space[4],
                gap: space[1],
              },
            ]}
          >
            <Text style={[text.label, { color: color.pendingText }]}>
              {t('auth.verifyPhoneBannerTitle')}
            </Text>
            <Text style={[text.bodySm, { color: color.pendingText }]}>
              {t('auth.verifyPhoneBannerBody')}
            </Text>
          </Pressable>
        ) : null}

        {/* Primary action — master spec §1: "The primary action is a
            full-width green 'Сканировать QR'. Below it: two equal quick
            actions, 'Начать зарядку' and 'Найти партнёра'." The Jako wing
            signature is permitted on this button: a safe, positive,
            full-width primary CTA is exactly the icon-boundary table's
            allowed case. */}
        <View style={{ paddingHorizontal: layout.screenPaddingX, marginTop: space[4] }}>
          <Button
            label={t('qr.scanQr')}
            onPress={() => navigation.navigate('ScanQr')}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
        </View>

        <View
          style={[
            styles.actions,
            { paddingHorizontal: layout.screenPaddingX, marginTop: space[3], gap: space[3] },
          ]}
        >
          <QuickAction
            icon="flash-outline"
            label={t('ev.stations')}
            tone="reserved"
            onPress={() => navigation.navigate('Main', { screen: 'Partners', params: { filter: 'stations' } } as never)}
          />
          <QuickAction
            icon="map-outline"
            label={t('partners.findPartner')}
            onPress={() => navigation.navigate('Main', { screen: 'Partners' } as never)}
          />
        </View>

        {/* Partner Spotlight — after the customer's own actions, never above
            the QR button. Absent entirely when there is nothing to show. A
            card lands on the map narrowed to that partner (its branches,
            nearest first) or on the whole map, per the placement's own
            destination; never outside the app. */}
        <PartnerSpotlight
          onOpen={(promo) =>
            navigation.navigate(
              'Main',
              {
                screen: 'Partners',
                params: promo.destination === 'PARTNER' ? { q: promo.partnerName } : undefined,
              } as never,
            )
          }
        />

        {/* Referral entry — master spec §1: "sits immediately after the
            quick actions — before long transaction history — because it is
            a primary acquisition loop." Now after the spotlight, which is
            the one thing the owner asked to sit between the two. */}
        <View style={{ paddingHorizontal: layout.screenPaddingX, marginTop: space[6] }}>
          <ReferralEntryCard onPress={() => navigation.navigate('Referral')} />
        </View>

        <View style={{ paddingHorizontal: layout.screenPaddingX }}>
          <SectionHeader
            title={t('home.recentActivity')}
            actionLabel={recent.length > 0 ? t('common.seeAll') : undefined}
            onAction={() => navigation.navigate('TransactionHistory')}
          />

          {txLoading ? (
            <View style={{ gap: space[4], paddingVertical: space[3] }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.skeletonRow, { gap: space[3] }]}>
                  <Skeleton width={40} height={40} style={{ borderRadius: radius.md }} />
                  <View style={styles.flex}>
                    <Skeleton width="55%" height={14} />
                    <Skeleton width="35%" height={12} style={{ marginTop: 8 }} />
                  </View>
                </View>
              ))}
            </View>
          ) : recent.length === 0 ? (
            <EmptyState title={t('home.noActivityTitle')} message={t('home.noActivityMessage')} />
          ) : (
            recent.map((tx, i) => (
              <ListRow
                key={tx.id}
                /* `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §1: "TuTak must not show
                   anonymous generic symbols where a customer is dealing with
                   a real business." So a row that has a partner behind it
                   leads with that partner's mark and is titled by its name;
                   the operation type moves to the subtitle, where it is more
                   use than "PARTNER_PURCHASE" was as a headline. A row with
                   no partner — a manual adjustment, an expiry — keeps the
                   type icon, because inventing a business for it would be
                   worse than a glyph.

                   The brand is the operation's own snapshot (§2.2), so a
                   partner rebranding tomorrow does not rewrite this row. */
                leading={
                  tx.partnerBrand ? (
                    <PartnerMark
                      name={tx.partnerBrand.displayName}
                      logoUrl={tx.partnerBrand.logo?.thumbnailUrl}
                      size={40}
                    />
                  ) : (
                    <TransactionIcon type={tx.type} />
                  )
                }
                title={
                  tx.partnerBrand?.displayName ??
                  t(`transactionType.${tx.type}`, { defaultValue: tx.type })
                }
                subtitle={
                  tx.partnerBrand
                    ? `${t(`transactionType.${tx.type}`, { defaultValue: tx.type })} · ${formatDayGroup(tx.createdAt)}`
                    : formatDayGroup(tx.createdAt)
                }
                value={formatSigned(
                  transactionTone(tx.type) === 'positive' ? tx.bonusEarnedAmount : `-${tx.amount}`,
                  transactionTone(tx.type) === 'positive' ? 'points' : 'amd',
                )}
                valueTone={transactionTone(tx.type)}
                last={i === recent.length - 1}
                onPress={() => navigation.navigate('TransactionHistory')}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TransactionIcon({ type }: { type: string }) {
  const { color, radius, bonusState } = useTheme();
  const tone = transactionTone(type);
  // One neutral tile for every non-partner row; the sign and colour of the
  // amount already say which way the money went.
  void bonusState;
  const surface = color.backgroundSubtle;
  const fg = tone === 'positive' ? color.availableText : color.textSecondary;

  return (
    <View
      style={[styles.txIcon, { backgroundColor: surface, borderRadius: radius.md }]}
    >
      <Ionicons name={transactionIcon(type)} size={18} color={fg} />
    </View>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row' },
  txIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  skeletonRow: { flexDirection: 'row', alignItems: 'center' },
  verifyBanner: {},
});
