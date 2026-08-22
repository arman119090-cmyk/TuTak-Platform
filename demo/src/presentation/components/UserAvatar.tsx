import React, { useState } from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §4: "Create one `UserAvatar` component
 * that uses the same safe fallback [as `PartnerMark`]." Renders a photo when
 * one is supplied and loads successfully, otherwise deterministic initials
 * on the identity gradient — the same treatment `SettingsScreen`'s own
 * profile card already used inline before this component existed to share
 * it.
 *
 * `avatarUrl` has no live data source yet: `AuthenticatedUserDto` and the
 * Level-1 referral DTO carry no avatar field in this delivery (the upload/
 * consent backend from the spec's §2-§3 is not implemented — see the
 * completion report), so every current call site renders initials. A
 * caller passing a real URL later needs no further change here.
 *
 * `firstName`/`lastName` are optional so a Level-1 referral row — which per
 * spec must show only first name + last *initial*, never the full surname —
 * can pass just what it is allowed to show without inventing a fake full
 * name for this component's own sake.
 */
export function UserAvatar({
  firstName,
  lastName,
  avatarUrl,
  size = 44,
}: {
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  size?: number;
}) {
  const { color, text, radius, gradients } = useTheme();
  const [failed, setFailed] = useState(false);
  const initials = `${firstName?.trim().charAt(0) ?? ''}${lastName?.trim().charAt(0) ?? ''}`.toUpperCase();
  const label = [firstName, lastName].filter(Boolean).join(' ') || 'User';

  if (avatarUrl && !failed) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        onError={() => setFailed(true)}
        accessibilityLabel={label}
        style={{ width: size, height: size, borderRadius: radius.full }}
      />
    );
  }

  return (
    <LinearGradient
      colors={[...gradients.primary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      accessibilityLabel={label}
      style={[styles.fallback, { width: size, height: size, borderRadius: radius.full }]}
    >
      <Text style={[text.label, { color: color.textInverse, fontSize: size * 0.36 }]}>
        {initials || '—'}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
