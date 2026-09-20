import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PayoutMethodDto, SecurityStatusDto } from '@cashout/contracts';
import type { Locale } from '@cashout/i18n';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme, useThemePreference } from '../../src/theme/theme';
import { Card, Dialog, ListRow, Screen, Text } from '../../src/ui';

const LANGUAGE_LABEL: Record<Locale, string> = { hy: 'Հայերեն', ru: 'Русский', en: 'English' };

/**
 * Settings, in the order the ТЗ lists them: who I am, which park, where the
 * money goes, how I confirm it, how the app looks and speaks, and — last, in
 * red — the way out. Every row leads to a screen; nothing here edits in place
 * except through those screens, so a mis-tap never changes anything.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, signOut, api } = useAuth();
  const { t, locale } = useI18n();
  const { preference } = useThemePreference();

  const [methods, setMethods] = useState<PayoutMethodDto[]>([]);
  const [security, setSecurity] = useState<SecurityStatusDto | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void endpoints
        .payoutMethods(api)
        .then((result) => setMethods(result.items))
        .catch(() => setMethods([]));
      void endpoints
        .securityStatus(api)
        .then(setSecurity)
        .catch(() => setSecurity(null));
    }, [api]),
  );

  const idram = methods.find((method) => method.kind === 'IDRAM' && method.isDefault);
  const appearanceLabel =
    preference === 'dark'
      ? t('appearance.dark')
      : preference === 'system'
        ? t('appearance.system')
        : t('appearance.light');
  const securityLabel = security
    ? security.pinSet
      ? security.biometricEnabledOnThisDevice
        ? t('security.biometricsOn')
        : t('security.pinSet')
      : t('security.pinNotSet')
    : undefined;
  const version = Constants.expoConfig?.version ?? '0.0.0';

  const section = (title: string) => (
    <Text
      variant="label"
      tone="secondary"
      style={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}
    >
      {title}
    </Text>
  );

  return (
    <Screen>
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('tabs.settings')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {[profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || profile?.phone}
        </Text>
      </View>

      {section(t('settings.sectionAccount'))}
      <Card padded={false}>
        <ListRow label={t('profileScreen.open')} onPress={() => router.push('/profile')} first />
        <ListRow
          label={t('profile.driverId')}
          value={profile?.driverId ?? '—'}
          onPress={() => router.push('/driver-id')}
          last
        />
      </Card>

      {section(t('settings.sectionPark'))}
      <Card padded={false}>
        <ListRow label={t('settings.currentPark')} value={profile?.activePark?.name ?? '—'} first />
        <ListRow
          label={t('settings.changePark')}
          value={
            (profile?.membershipCount ?? 0) > 1 ? String(profile?.membershipCount ?? 0) : undefined
          }
          onPress={
            (profile?.membershipCount ?? 0) > 1 ? () => router.push('/park/select') : undefined
          }
          last
        />
      </Card>

      {section(t('settings.sectionPayout'))}
      <Card padded={false}>
        <ListRow
          label={t('settings.idramAccount')}
          value={idram?.maskedIdentifier ?? t('idram.none')}
          onPress={() => router.push('/idram/account')}
          first
        />
        <ListRow label={t('autoPayout.title')} onPress={() => router.push('/auto-payout')} last />
      </Card>

      {section(t('settings.sectionSecurity'))}
      <Card padded={false}>
        <ListRow
          label={t('settings.pinAndBiometrics')}
          value={securityLabel}
          onPress={() => router.push('/security')}
          first
        />
        <ListRow label={t('profile.devices')} onPress={() => router.push('/devices')} last />
      </Card>

      {section(t('settings.sectionApp'))}
      <Card padded={false}>
        <ListRow
          label={t('profile.language')}
          value={LANGUAGE_LABEL[locale]}
          onPress={() => router.push('/settings/language')}
          first
        />
        <ListRow
          label={t('settings.appearance')}
          value={appearanceLabel}
          onPress={() => router.push('/settings/appearance')}
        />
        <ListRow
          label={t('settings.notifications')}
          onPress={() => router.push('/settings/notifications')}
          last
        />
      </Card>

      {section(t('settings.sectionMore'))}
      <Card padded={false}>
        <ListRow label={t('profile.support')} onPress={() => router.push('/support')} first />
        <ListRow
          label={t('profile.terms')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
        />
        <ListRow
          label={t('profile.privacy')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
          last
        />
      </Card>

      <Card padded={false} style={{ marginTop: theme.spacing.lg }}>
        <ListRow
          label={t('profile.signOut')}
          danger
          onPress={() => setSignOutOpen(true)}
          first
          last
        />
      </Card>

      <Text
        variant="caption"
        tone="tertiary"
        align="center"
        style={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.base }}
      >
        {t('settings.version', { version })}
      </Text>

      <Dialog
        visible={signOutOpen}
        title={t('profile.signOutConfirm')}
        confirmLabel={t('profile.signOut')}
        cancelLabel={t('common.cancel')}
        destructive
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => {
          setSignOutOpen(false);
          void signOut().then(() => router.replace('/'));
        }}
      />
    </Screen>
  );
}
