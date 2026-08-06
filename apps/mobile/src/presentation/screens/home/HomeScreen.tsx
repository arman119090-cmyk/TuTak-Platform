import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { MascotBadge } from '../../components/MascotBadge';
import { BonusStatusPill } from '../../components/BonusStatusPill';
import { walletApi } from '../../../data/api/walletApi';
import { useAuthStore } from '../../../data/stores/authStore';
import { formatPoints } from '../../utils/format';
import type { MainTabParamList, RootStackParamList } from '../../../app/navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

export function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { theme, spacing, typography, radius } = useAppTheme();
  const { user } = useAuthStore();

  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: walletApi.getMyWallet });

  const actions: { key: keyof RootStackParamList | 'ScanQr'; icon: string; label: string }[] = [
    { key: 'ScanQr', icon: '▢', label: t('qr.scanQr') },
    { key: 'Referral', icon: '↗', label: t('referral.inviteFriends') },
    { key: 'TransactionHistory', icon: '≡', label: t('wallet.history') },
    { key: 'Notifications', icon: '◔', label: t('notifications.title') },
  ];

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <View>
          <Text style={[typography.footnote, { color: theme.textSecondary }]}>
            {t('auth.welcomeBack')}
          </Text>
          <Text style={[typography.title1, { color: theme.textPrimary }]}>
            {user?.firstName ?? ''}
          </Text>
        </View>
        <MascotBadge size={48} />
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Text style={[typography.footnote, { color: theme.textSecondary }]}>{t('wallet.available')}</Text>
        <Text style={[typography.largeTitle, { color: theme.primary, marginTop: spacing.xs }]}>
          {formatPoints(wallet?.availableBonus ?? 0)}
        </Text>
        <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
          <BonusStatusPill state="AVAILABLE" />
          <BonusStatusPill state="PENDING" />
          <BonusStatusPill state="RESERVED" />
        </View>
        <View style={[styles.row, { marginTop: spacing.lg }]}>
          <View style={styles.statBlock}>
            <Text style={[typography.headline, { color: theme.bonusPending }]}>
              {formatPoints(wallet?.pendingBonus ?? 0)}
            </Text>
            <Text style={[typography.caption, { color: theme.textSecondary }]}>{t('wallet.pending')}</Text>
          </View>
          <View style={styles.statBlock}>
            <Text style={[typography.headline, { color: theme.bonusReserved }]}>
              {formatPoints(wallet?.reservedBonus ?? 0)}
            </Text>
            <Text style={[typography.caption, { color: theme.textSecondary }]}>{t('wallet.reserved')}</Text>
          </View>
        </View>
      </Card>

      <View style={[styles.grid, { marginTop: spacing.xl }]}>
        {actions.map((action) => (
          <Card
            key={action.key}
            style={{
              width: '47%',
              marginBottom: spacing.md,
              alignItems: 'center',
              borderRadius: radius.md,
            }}
          >
            <Text
              onPress={() => navigation.navigate(action.key as never)}
              style={[typography.title2, { color: theme.primary }]}
            >
              {action.icon}
            </Text>
            <Text
              onPress={() => navigation.navigate(action.key as never)}
              style={[typography.footnote, { color: theme.textPrimary, marginTop: spacing.xs, textAlign: 'center' }]}
            >
              {action.label}
            </Text>
          </Card>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row' },
  statBlock: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
});
