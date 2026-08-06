import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SUPPORTED_LOCALES } from '@tutak/i18n';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { ListRow } from '../../components/ListRow';
import { SectionHeader } from '../../components/SectionHeader';
import { Button } from '../../components/Button';
import { useAuthStore } from '../../../data/stores/authStore';
import { authApi } from '../../../data/api/authApi';

const LOCALE_LABELS: Record<string, string> = {
  hy: 'Հայերեն',
  ru: 'Русский',
  en: 'English',
};

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const { user, deviceId, clear } = useAuthStore();

  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase();

  const handleLogout = () => {
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
    <Screen title={t('settings.title')}>
      {/* Identity card — initials avatar avoids demanding a photo upload. */}
      <Surface>
        <View style={styles.profile}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: color.primarySurface, borderRadius: radius.full },
            ]}
          >
            <Text style={[text.title, { color: color.primary }]}>{initials || '—'}</Text>
          </View>
          <View style={[styles.flex, { marginLeft: space[4] }]}>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[1] }]}>
              {user?.phone}
            </Text>
          </View>
        </View>
      </Surface>

      <SectionHeader title={t('settings.language')} />
      <Surface padded={false}>
        <View style={{ paddingHorizontal: space[5] }}>
          {SUPPORTED_LOCALES.map((locale, i) => {
            const active = i18n.language === locale;
            return (
              <ListRow
                key={locale}
                title={LOCALE_LABELS[locale] ?? locale}
                onPress={() => i18n.changeLanguage(locale)}
                trailing={
                  active ? (
                    <Ionicons name="checkmark" size={20} color={color.primary} />
                  ) : undefined
                }
                last={i === SUPPORTED_LOCALES.length - 1}
              />
            );
          })}
        </View>
      </Surface>

      <SectionHeader title={t('settings.security')} />
      <Surface padded={false}>
        <View style={{ paddingHorizontal: space[5] }}>
          <ListRow
            title={t('settings.notifications')}
            leading={<SettingIcon name="notifications-outline" />}
            trailing={<Ionicons name="chevron-forward" size={18} color={color.textTertiary} />}
          />
          <ListRow
            title={t('settings.changePassword')}
            leading={<SettingIcon name="lock-closed-outline" />}
            trailing={<Ionicons name="chevron-forward" size={18} color={color.textTertiary} />}
            last
          />
        </View>
      </Surface>

      <View style={{ marginTop: space[7] }}>
        <Button label={t('settings.logout')} onPress={handleLogout} variant="destructive" />
      </View>

      <Text
        style={[
          text.caption,
          { color: color.textTertiary, textAlign: 'center', marginTop: space[6] },
        ]}
      >
        TuTak · v0.1.0
      </Text>
    </Screen>
  );
}

function SettingIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const { color, radius } = useTheme();
  return (
    <View
      style={[
        styles.settingIcon,
        { backgroundColor: color.surfaceSunken, borderRadius: radius.md },
      ]}
    >
      <Ionicons name={name} size={18} color={color.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  profile: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  settingIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
