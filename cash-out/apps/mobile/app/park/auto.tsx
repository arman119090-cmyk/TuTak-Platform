import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Card, Screen, Skeleton, StatusPill, Text } from '../../src/ui';

/**
 * One park, chosen for the driver. Shown for a moment after the first sign-in
 * so the driver sees which park they are working with before the balance
 * appears — the ТЗ asks for the automatic choice to be visible, not silent.
 */
export default function ParkAutoScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    const timer = setTimeout(() => router.replace('/(tabs)'), 1400);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text variant="titleLarge" align="center">
          {t('park.autoTitle')}
        </Text>
        <Card style={{ marginTop: theme.spacing.xl }}>
          {profile?.activePark ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="title">{profile.activePark.name}</Text>
                  {profile.driverId ? (
                    <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                      {t('park.driverIdLabel')}: {profile.driverId}
                    </Text>
                  ) : null}
                </View>
                <StatusPill tone="success" label={t('park.active')} />
              </View>
              <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.md }}>
                {t('park.autoBody', { park: profile.activePark.name })}
              </Text>
            </>
          ) : (
            <Skeleton width="100%" height={48} />
          )}
        </Card>
      </View>
    </Screen>
  );
}
