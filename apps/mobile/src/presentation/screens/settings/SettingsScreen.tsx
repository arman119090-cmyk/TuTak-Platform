import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES } from '@tutak/i18n';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useAuthStore } from '../../../data/stores/authStore';
import { authApi } from '../../../data/api/authApi';

const LOCALE_LABELS: Record<string, string> = { hy: 'Հայերեն', ru: 'Русский', en: 'English' };

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { theme, spacing, typography, radius } = useAppTheme();
  const { user, deviceId, clear } = useAuthStore();

  const handleLogout = async () => {
    Alert.alert(t('settings.logout'), t('auth.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.logout'),
        style: 'destructive',
        onPress: async () => {
          try {
            await authApi.logout(deviceId);
          } finally {
            await clear();
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.lg }]}>
        {t('settings.title')}
      </Text>

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={[typography.headline, { color: theme.textPrimary }]}>
          {user?.firstName} {user?.lastName}
        </Text>
        <Text style={[typography.footnote, { color: theme.textSecondary, marginTop: spacing.xs }]}>
          {user?.phone}
        </Text>
      </Card>

      <Text style={[typography.footnote, { color: theme.textSecondary, marginBottom: spacing.sm }]}>
        {t('settings.language')}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }}>
        {SUPPORTED_LOCALES.map((locale) => (
          <Pressable
            key={locale}
            onPress={() => i18n.changeLanguage(locale)}
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.pill,
              backgroundColor: i18n.language === locale ? theme.primary : theme.surface,
            }}
          >
            <Text
              style={[
                typography.footnote,
                { color: i18n.language === locale ? theme.textInverse : theme.textPrimary },
              ]}
            >
              {LOCALE_LABELS[locale]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Button label={t('settings.logout')} variant="secondary" onPress={handleLogout} />
    </ScreenContainer>
  );
}
