import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * The home screen's header: who is signed in, and the way to notifications.
 *
 * It used to be a glass bar with a hairline edge and an avatar ring that
 * glowed at 80% opacity — the loudest element on a screen whose loudest
 * element should be the balance. It is now a plain row on the page ground:
 * a small greeting, the person's name set as the screen's title, and two
 * quiet round controls. The brand line is gone from here because the hero
 * card two hundred points below already says TuTak in a way a label never
 * could.
 */
export function HomeHeader({
  firstName,
  onNotifications,
  onProfile,
}: {
  firstName?: string;
  onNotifications: () => void;
  /**
   * Opens the profile. Required rather than optional: the avatar sits in
   * the corner where every other app puts an account button, so it reads as
   * tappable whether or not it is one.
   */
  onProfile: () => void;
}) {
  const { color, space, radius, text } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      <View style={styles.identity}>
        <Pressable
          onPress={onProfile}
          accessibilityRole="button"
          accessibilityLabel={t('nav.profile')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.avatar,
            { backgroundColor: color.availableSurface, borderRadius: radius.full, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../../../assets/logo-mark.png')}
            style={styles.avatarMark}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Pressable>

        <View style={[styles.flex, { marginLeft: space[3] }]}>
          <Text style={[text.caption, { color: color.textSecondary }]}>{t('home.greeting')}</Text>
          <Text style={[text.title, { color: color.textPrimary }]} numberOfLines={1}>
            {firstName ? firstName : 'TuTak'}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notifications.title')}
        onPress={onNotifications}
        hitSlop={8}
        style={({ pressed }) => [
          styles.bell,
          { backgroundColor: pressed ? color.fillSubtlePressed : color.fillSubtle, borderRadius: radius.full },
        ]}
      >
        <Ionicons name="notifications-outline" size={22} color={color.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1, flexShrink: 1 },
  flex: { flex: 1 },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  avatarMark: { width: 30, height: 30 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
