import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PayoutMethodDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Card, Dialog, ListRow, Screen, Sheet, Text, Button } from '../../src/ui';
import type { Locale } from '@cashout/i18n';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, signOut, api } = useAuth();
  const { t, locale, setLocale } = useI18n();

  const [methods, setMethods] = useState<PayoutMethodDto[]>([]);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void endpoints
        .payoutMethods(api)
        .then((result) => setMethods(result.items))
        .catch(() => setMethods([]));
    }, [api]),
  );

  const languages: Array<{ code: Locale; label: string }> = [
    { code: 'hy', label: 'Հայերեն' },
    { code: 'ru', label: 'Русский' },
    { code: 'en', label: 'English' },
  ];

  return (
    <Screen>
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('tabs.settings')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {[profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || profile?.phone}
        </Text>
      </View>

      <Card padded={false} style={{ marginBottom: theme.spacing.base }}>
        <ListRow
          label={t('profile.fleet')}
          value={profile?.activePark?.name ?? '—'}
          onPress={
            (profile?.membershipCount ?? 0) > 1 ? () => router.push('/park/select') : undefined
          }
          first
        />
        <ListRow label={t('profile.driverId')} value={profile?.driverId ?? '—'} last />
      </Card>

      <Card padded={false} style={{ marginBottom: theme.spacing.base }}>
        <ListRow
          label={t('idram.title')}
          value={
            methods.find((method) => method.kind === 'IDRAM' && method.isDefault)
              ?.maskedIdentifier ?? t('idram.none')
          }
          onPress={() => router.push('/idram/account')}
          first
        />
        <ListRow
          label={t('profile.language')}
          value={languages.find((item) => item.code === locale)?.label}
          onPress={() => setLanguageOpen(true)}
        />
        <ListRow label={t('autoPayout.title')} onPress={() => router.push('/auto-payout')} />
        <ListRow label={t('security.title')} onPress={() => router.push('/security')} />
        <ListRow label={t('profile.devices')} onPress={() => router.push('/devices')} last />
      </Card>

      <Card padded={false} style={{ marginBottom: theme.spacing.base }}>
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

      <Card padded={false}>
        <ListRow
          label={t('profile.signOut')}
          danger
          onPress={() => setSignOutOpen(true)}
          first
          last
        />
      </Card>

      <Sheet
        visible={languageOpen}
        onClose={() => setLanguageOpen(false)}
        title={t('profile.language')}
      >
        <View style={{ gap: theme.spacing.sm }}>
          {languages.map((language) => (
            <Button
              key={language.code}
              label={language.label}
              variant={language.code === locale ? 'primary' : 'secondary'}
              onPress={() => {
                setLocale(language.code);
                void endpoints.setLocale(api, language.code).catch(() => undefined);
                setLanguageOpen(false);
              }}
            />
          ))}
        </View>
      </Sheet>

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
