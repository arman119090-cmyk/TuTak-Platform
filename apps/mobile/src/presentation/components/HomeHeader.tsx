import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * The home screen's glass header bar.
 *
 * A single pane holding the product's name, who is signed in, and the way to
 * notifications. Two details do most of the work and both are easy to drop:
 *
 * The avatar is a solid blue disc inside a wider, translucent ring, and the
 * *ring* is what carries the glow. Putting the shadow on the disc itself
 * makes it a blurry disc; putting it on a ring around the disc makes the
 * disc look lit. It is the only element on the home screen that glows this
 * strongly, which is what makes it read as the user's own corner of the app.
 *
 * This header has no photo source to fall back from yet (no avatarUrl is
 * threaded in here — see `UserAvatar`'s doc comment), so the disc always
 * shows the Jako mark, same as every other avatar fallback in the app
 * (Arman, 2026-08-23: emblem everywhere a photo is missing, not initials).
 *
 * The brand line sits above the greeting rather than below it. On a screen
 * whose whole job is to show a balance, the person already knows their own
 * name — what they occasionally need is confirmation of which app they are
 * looking at, and it costs one line to say so.
 */
export function HomeHeader({
  firstName,
  onNotifications,
  onProfile,
}: {
  firstName?: string;
  onNotifications: () => void;
  /**
   * Opens the profile. Required rather than optional: the avatar is round,
   * brand-coloured and sits in the corner where every other app puts an
   * account button, so it reads as tappable whether or not it is one. It was
   * not — a plain `View` — and people tapped it and nothing happened.
   */
  onProfile: () => void;
}) {
  const { color, space, radius, text, glass, premium } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.wrapper, { borderRadius: radius.xl, borderColor: glass.border }]}>
      <GlassBar>
        <View style={[styles.row, { paddingHorizontal: space[4] }]}>
          <View style={styles.identity}>
            {/* Ring first, disc inside it — see the note above. */}
            <Pressable
              onPress={onProfile}
              accessibilityRole="button"
              accessibilityLabel={t('nav.profile')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.ring,
                { opacity: pressed ? 0.7 : 1 },
                {
                  backgroundColor: premium.brand.primary + '2E', // ~18% alpha
                  shadowColor: premium.brand.primary,
                },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: premium.brand.primary + 'BF' }]}>
                <Image
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require('../../../assets/logo-mark.png')}
                  style={styles.avatarMark}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
              </View>
            </Pressable>

            <View style={{ marginLeft: space[3] }}>
              <Text style={[text.title, { color: color.textPrimary }]}>TuTak</Text>
              <Text style={[text.label, { color: color.textSecondary, marginTop: 2 }]}>
                {firstName ? t('home.greetingNamed', { name: firstName }) : t('home.greeting')}
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
              {
                backgroundColor: glass.background,
                borderColor: glass.border,
                borderRadius: radius.full,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="notifications-outline" size={20} color={color.textPrimary} />
          </Pressable>
        </View>
      </GlassBar>
    </View>
  );
}

/** Blurred on iOS, flat translucent on Android — same reasoning as `Surface`. */
function GlassBar({ children }: { children: React.ReactNode }) {
  const { premium } = useTheme();

  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={65} tint={premium.blurTint} style={styles.bar}>
        {children}
      </BlurView>
    );
  }
  return <View style={[styles.bar, { backgroundColor: premium.card.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  wrapper: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  bar: { height: 82, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  ring: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.8,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarMark: { width: 28, height: 28 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
