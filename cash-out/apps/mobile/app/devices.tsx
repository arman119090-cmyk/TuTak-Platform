import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SessionDto } from '@cashout/contracts';
import { endpoints } from '../src/api/endpoints';
import { useAuth } from '../src/auth/auth-context';
import { useI18n } from '../src/i18n/i18n';
import { useTheme } from '../src/theme/theme';
import { Button, Card, Dialog, ListRow, Screen, Text } from '../src/ui';

/**
 * Where the driver can see every signed-in device and end all of them.
 *
 * This is the control a driver reaches for after losing a phone, so it does the
 * thing that actually matters — revoking the sessions server-side — rather than
 * only clearing the local keystore.
 */
export default function DevicesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api, signOut } = useAuth();
  const { t, locale } = useI18n();

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [confirming, setConfirming] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void endpoints
        .sessions(api)
        .then((result) => setSessions(result.items))
        .catch(() => setSessions([]));
    }, [api]),
  );

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('profile.signOut')}
            variant="danger"
            onPress={() => setConfirming(true)}
          />
          <Button label={t('common.close')} variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('profile.devices')}</Text>
      </View>

      <Card padded={false}>
        {sessions.map((session, index) => (
          <ListRow
            key={session.id}
            label={`${session.deviceName ?? session.platform ?? session.deviceId.slice(0, 12)}${
              session.current ? ' •' : ''
            }`}
            value={format(session.lastSeenAt)}
            first={index === 0}
            last={index === sessions.length - 1}
          />
        ))}
      </Card>

      <Dialog
        visible={confirming}
        title={t('profile.signOutConfirm')}
        confirmLabel={t('profile.signOut')}
        cancelLabel={t('common.cancel')}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void signOut().then(() => router.replace('/'));
        }}
      />
    </Screen>
  );
}
