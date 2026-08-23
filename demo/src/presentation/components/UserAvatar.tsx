import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';
import { Jako } from './Jako';

/**
 * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §4: "Create one `UserAvatar` component
 * that uses the same safe fallback [as `PartnerMark`]." Renders a photo when
 * one is supplied and loads successfully, otherwise the Jako mark on a
 * neutral surface — a customer without a photo still gets a recognisably
 * TuTak avatar rather than a generic placeholder, and `PartnerMark`'s
 * distinct accent colour is what tells the two apart at a glance (per
 * Arman's explicit request, 2026-08-23 — supersedes this component's
 * earlier initials-only fallback).
 *
 * `avatarUrl` has no live data source yet: `AuthenticatedUserDto` and the
 * Level-1 referral DTO carry no avatar field in this delivery (the upload/
 * consent backend from the spec's §2-§3 is not implemented — see the
 * completion report), so every current call site renders the fallback. A
 * caller passing a real URL later needs no further change here — the photo
 * always wins over the mark.
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
  const { color, radius } = useTheme();
  const [failed, setFailed] = useState(false);
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
    <View
      accessibilityLabel={label}
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius.full, backgroundColor: color.surfaceSunken },
      ]}
    >
      <Jako size={size * 0.72} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
