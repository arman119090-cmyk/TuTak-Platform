import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { MembershipDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, ErrorState, Screen, Skeleton, TaxiParkCard, Text } from '../../src/ui';

/**
 * Choosing — or changing — the taxi park.
 *
 * The list comes from the server's roster; the app never offers a park the
 * server did not. Activation is a server call that verifies eligibility and
 * invalidates the previous park's balance; on success the home screen is
 * reloaded so that nothing from the old park survives on screen.
 */
export default function ParkSelectScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api, profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [items, setItems] = useState<MembershipDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await endpoints.parks(api);
      setItems(result.items);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [api, describeError]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const choose = async (membership: MembershipDto) => {
    setSwitchingTo(membership.park.id);
    setError(null);
    try {
      await endpoints.activatePark(api, membership.park.id);
      await refreshProfile();
      router.replace('/(tabs)');
    } catch (caught) {
      setError(describeError(caught));
      await load();
    } finally {
      setSwitchingTo(null);
    }
  };

  const changing = profile?.resolution === 'ACTIVE';

  return (
    <Screen
      footer={
        changing ? (
          <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
        ) : undefined
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{changing ? t('park.changePark') : t('park.selectTitle')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('park.selectSubtitle')}
        </Text>
      </View>

      {error ? (
        <ErrorState
          title={t('common.error')}
          body={error}
          retryLabel={t('common.retry')}
          onRetry={() => void load()}
        />
      ) : null}

      {items === null ? (
        <View style={{ gap: theme.spacing.md }}>
          <Skeleton width="100%" height={96} />
          <Skeleton width="100%" height={96} />
        </View>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {items.map((membership) => (
            <TaxiParkCard
              key={membership.id}
              membership={membership}
              busy={switchingTo === membership.park.id}
              onPress={membership.isActive ? undefined : () => void choose(membership)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
