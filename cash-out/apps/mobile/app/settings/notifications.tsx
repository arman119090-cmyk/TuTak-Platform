import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Screen, StateView, Text, Toggle, useToast } from '../../src/ui';

type Category = keyof UpdateNotificationPreferencesDto;

const CATEGORIES: ReadonlyArray<{
  key: Category;
  label:
    | 'notifications.payoutStatus'
    | 'notifications.autoPayout'
    | 'notifications.securityAlerts'
    | 'notifications.parkChanges';
  hint:
    | 'notifications.payoutStatusHint'
    | 'notifications.autoPayoutHint'
    | 'notifications.securityAlertsHint'
    | 'notifications.parkChangesHint';
}> = [
  {
    key: 'payoutStatus',
    label: 'notifications.payoutStatus',
    hint: 'notifications.payoutStatusHint',
  },
  { key: 'autoPayout', label: 'notifications.autoPayout', hint: 'notifications.autoPayoutHint' },
  {
    key: 'securityAlerts',
    label: 'notifications.securityAlerts',
    hint: 'notifications.securityAlertsHint',
  },
  { key: 'parkChanges', label: 'notifications.parkChanges', hint: 'notifications.parkChangesHint' },
];

/**
 * Four switches, saved on each flip. The server applies them at delivery time,
 * so turning a category off silences anything still queued as well. The mock
 * delivery mode is shown as what it is: preferences are real, pushes are not.
 */
export default function NotificationsSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const toast = useToast();

  const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState<Category | null>(null);

  const load = useCallback(async () => {
    try {
      setPrefs(await endpoints.notificationPreferences(api));
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const flip = async (key: Category, value: boolean) => {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSaving(key);
    try {
      setPrefs(await endpoints.updateNotificationPreferences(api, { [key]: value }));
      toast.show(t('notifications.saved'), 'success');
    } catch {
      setPrefs(previous);
      toast.show(t('common.error'), 'danger');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Screen
      footer={<Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('notifications.title')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('notifications.intro')}
        </Text>
      </View>

      {error ? (
        <View style={{ marginTop: theme.spacing.base }}>
          <StateView state={{ kind: 'error', error, onRetry: () => void load() }} />
        </View>
      ) : prefs === null ? (
        <StateView state={{ kind: 'loading' }} />
      ) : (
        <>
          <Card padded={false} style={{ marginTop: theme.spacing.base }}>
            {CATEGORIES.map((category, index) => (
              <View
                key={category.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: theme.touchTarget.comfortable,
                  paddingHorizontal: theme.spacing.base,
                  paddingVertical: theme.spacing.md,
                  borderBottomWidth: index === CATEGORIES.length - 1 ? 0 : 1,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <View style={{ flex: 1, marginRight: theme.spacing.md }}>
                  <Text variant="body">{t(category.label)}</Text>
                  <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                    {t(category.hint)}
                  </Text>
                </View>
                <Toggle
                  value={prefs[category.key]}
                  disabled={saving !== null}
                  accessibilityLabel={t(category.label)}
                  onValueChange={(value) => void flip(category.key, value)}
                />
              </View>
            ))}
          </Card>

          <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
            <Text variant="caption" tone="secondary">
              {prefs.pushRegistered
                ? t('notifications.pushRegistered')
                : t('notifications.pushNotRegistered')}
            </Text>
            {prefs.deliveryMode === 'mock' ? (
              <Text variant="caption" tone="warning" style={{ marginTop: theme.spacing.xs }}>
                {t('notifications.mockNote')}
              </Text>
            ) : null}
          </Card>
        </>
      )}
    </Screen>
  );
}
