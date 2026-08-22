import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { SUPPORTED_LOCALES } from '@tutak/i18n';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { ListRow } from '../../components/ListRow';
import { SectionHeader } from '../../components/SectionHeader';
import { Button } from '../../components/Button';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuthStore } from '../../../data/stores/authStore';
import { authApi } from '../../../data/api/authApi';
import type { RootStackParamList } from '../../../app/navigation/types';

const LOCALE_LABELS: Record<string, string> = {
  hy: 'Հայերեն',
  ru: 'Русский',
  en: 'English',
};

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { color, space, text } = useTheme();
  const { user, deviceId, clear } = useAuthStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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
      {/* Identity card. `UserAvatar` falls back to initials on the brand
          gradient today — no `avatarUrl` field exists yet on
          `AuthenticatedUserDto` (the optional avatar-upload backend from
          `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §3 is not implemented in this
          delivery; see the completion report) — and starts showing a real
          photo the moment that field lands, with no change here. */}
      <Surface>
        <View style={styles.profile}>
          <UserAvatar firstName={user?.firstName} lastName={user?.lastName} size={56} />
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
          {/*
            A second way in. Inviting people is how a loyalty programme grows,
            and it was reachable from exactly one place: a tile on the home
            screen. Somebody who did not happen to notice that tile concluded
            the feature did not exist — which is what happened.
          */}
          <ListRow
            title={t('referral.inviteFriends')}
            leading={<SettingIcon name="gift-outline" />}
            trailing={<Ionicons name="chevron-forward" size={18} color={color.textTertiary} />}
            onPress={() => navigation.navigate('Referral')}
          />
          <ListRow
            title={t('settings.notifications')}
            leading={<SettingIcon name="notifications-outline" />}
            trailing={<Ionicons name="chevron-forward" size={18} color={color.textTertiary} />}
          />
          {!user?.isPhoneVerified ? (
            <ListRow
              title={t('settings.verifyPhone')}
              leading={<SettingIcon name="shield-checkmark-outline" />}
              trailing={<Ionicons name="chevron-forward" size={18} color={color.textTertiary} />}
              onPress={() => navigation.navigate('VerifyPhone')}
            />
          ) : null}
          <ListRow
            title={t('settings.changePassword')}
            leading={<SettingIcon name="lock-closed-outline" />}
            trailing={<Ionicons name="chevron-forward" size={18} color={color.textTertiary} />}
            onPress={() => navigation.navigate('ChangePassword')}
          />
          {/* Required by both app stores to be reachable from inside the app.
              Styled as an ordinary row rather than hidden behind a warning:
              hard to find is its own kind of dark pattern, and the screen it
              opens does the explaining. */}
          <ListRow
            title={t('settings.deleteAccount')}
            leading={<SettingIcon name="trash-outline" />}
            trailing={<Ionicons name="chevron-forward" size={18} color={color.textTertiary} />}
            onPress={() => navigation.navigate('DeleteAccount')}
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
  settingIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
