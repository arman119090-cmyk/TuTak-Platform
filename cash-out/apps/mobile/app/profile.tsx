import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PayoutMethodDto } from '@cashout/contracts';
import { endpoints } from '../src/api/endpoints';
import { useAuth } from '../src/auth/auth-context';
import { useI18n } from '../src/i18n/i18n';
import { useTheme } from '../src/theme/theme';
import { Button, Card, ListRow, Screen, StatusPill, Text } from '../src/ui';

/**
 * The driver's profile: who the server says they are, in which park, with
 * which Driver ID and payout destination, and the doors to security and
 * notifications. Nothing here is editable in place — each row opens the flow
 * that owns the change.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, api, refreshProfile } = useAuth();
  const { t } = useI18n();
  const [idram, setIdram] = useState<PayoutMethodDto | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
      void endpoints
        .idramAccount(api)
        .then((result) => setIdram(result.account))
        .catch(() => setIdram(null));
    }, [api, refreshProfile]),
  );

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || '—';
  const statusTone =
    profile?.verificationStatus === 'VERIFIED'
      ? 'success'
      : profile?.verificationStatus === 'BLOCKED'
        ? 'danger'
        : 'warning';
  const statusLabel =
    profile?.verificationStatus === 'VERIFIED'
      ? t('profileScreen.statusActive')
      : profile?.verificationStatus === 'BLOCKED'
        ? t('profileScreen.statusBlocked')
        : t('profileScreen.statusPending');

  return (
    <Screen
      footer={<Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('profile.title')}</Text>
      </View>

      <Card style={{ borderRadius: theme.radius.xxl, padding: theme.spacing.lg }}>
        <View
          style={[
            {
              width: 56,
              height: 56,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <Text variant="title" tone="brand">
            {name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text variant="titleLarge" style={{ marginTop: theme.spacing.md }}>
          {name}
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
          {profile?.phone ?? ''}
        </Text>
        <View style={{ marginTop: theme.spacing.md }}>
          <StatusPill tone={statusTone} label={statusLabel} />
        </View>
      </Card>

      <Card padded={false} style={{ marginTop: theme.spacing.base }}>
        <ListRow
          label={t('profile.driverId')}
          value={profile?.driverId ?? '—'}
          onPress={() => router.push('/driver-id')}
          first
        />
        <ListRow
          label={t('profileScreen.activePark')}
          value={profile?.activePark?.name ?? '—'}
          onPress={
            (profile?.membershipCount ?? 0) > 1 ? () => router.push('/park/select') : undefined
          }
        />
        <ListRow
          label={t('idram.title')}
          value={idram?.maskedIdentifier ?? t('idram.none')}
          onPress={() => router.push('/idram/account')}
        />
        <ListRow label={t('security.title')} onPress={() => router.push('/security')} />
        <ListRow
          label={t('notifications.title')}
          onPress={() => router.push('/settings/notifications')}
          last
        />
      </Card>
    </Screen>
  );
}
