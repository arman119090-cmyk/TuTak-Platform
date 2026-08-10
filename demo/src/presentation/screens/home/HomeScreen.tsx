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
import { HomeHeader } from '../../components/HomeHeader';
import { QuickAction } from '../../components/QuickAction';
import { SectionHeader } from '../../components/SectionHeader';
import { ListRow } from '../../components/ListRow';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { walletApi } from '../../../data/api/walletApi';
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

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: walletApi.getMyWallet,
  });
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
            paddingTop: space[3],
            paddingBottom: space[5],
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
          <BalanceCard
            available={wallet?.availableBonus}
            pending={wallet?.pendingBonus}
            reserved={wallet?.reservedBonus}
            loading={walletLoading}
          />
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

        {/* Primary actions. Pay is first — it is why the app exists. */}
        <View
          style={[
            styles.actions,
            { paddingHorizontal: layout.screenPaddingX, marginTop: space[6], gap: space[3] },
          ]}
        >
          <QuickAction icon="qr-code" label={t('qr.myQr')} onPress={() => navigation.navigate('Main', { screen: 'Pay' } as never)} />
          <QuickAction icon="scan" label={t('qr.scanQr')} onPress={() => navigation.navigate('ScanQr')} />
          <QuickAction icon="flash" label={t('ev.stations')} tone="reserved" onPress={() => navigation.navigate('Main', { screen: 'EvCharging' } as never)} />
          <QuickAction icon="gift" label={t('referral.invite')} tone="pending" onPress={() => navigation.navigate('Referral')} />
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
                leading={<TransactionIcon type={tx.type} />}
                title={t(`transactionType.${tx.type}`, { defaultValue: tx.type })}
                subtitle={formatDayGroup(tx.createdAt)}
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
  const surface = tone === 'positive' ? bonusState.available.surface : color.surfaceSunken;
  const fg = tone === 'positive' ? bonusState.available.text : color.textSecondary;

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
