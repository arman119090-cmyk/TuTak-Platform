import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §4: "create one reusable `PartnerMark`
 * component that renders a logo, loading/error state, and deterministic
 * initial fallback... Do not paste separate image-loading logic into each
 * screen." Every customer-facing operation surface the spec's §1 lists
 * (map/directory card, PurchaseIntent, transaction/wallet rows, EV-session
 * history, refund rows) is meant to render a partner identity through this
 * one component.
 *
 * `logoUrl` is intentionally optional and currently unused by every caller
 * in this delivery: no DTO in `@tutak/shared-types` yet returns a partner
 * logo or brand snapshot (`PartnerPublicDto`, `NearbyPartnerDto` and
 * `TransactionDto` carry no such field) — that requires the `MediaAsset`
 * migration, storage backend, and DTO extension the spec's §2-§4 describe,
 * which this visual-and-media-boundary delivery does not implement (see
 * the completion report). Every current call site therefore renders the
 * initials fallback deterministically, which is correct today and becomes
 * the real logo/fallback pair for free once a caller starts passing a real
 * `logoUrl` — no call site needs to change.
 *
 * Deliberately initials, not the Jako brand mark: `TUTAK_V2_MEDIA_SYSTEM_SPEC.md`
 * says so explicitly and three times over ("initials remain the fallback
 * everywhere" §1.2; "neutral initial/logo fallback" §2.1; "deterministic
 * initial fallback" §4) — see the completion report for the reconciliation
 * against a later verbal request for a Jako-mark fallback.
 */
export function PartnerMark({
  name,
  logoUrl,
  size = 40,
}: {
  /** The partner's display name — source of the deterministic initial. */
  name: string;
  logoUrl?: string | null;
  size?: number;
}) {
  const { color, radius } = useTheme();
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  if (logoUrl && !failed) {
    return (
      <Image
        source={{ uri: logoUrl }}
        onError={() => setFailed(true)}
        accessibilityLabel={name}
        style={[styles.mark, { width: size, height: size, borderRadius: radius.md }]}
      />
    );
  }

  return (
    <View
      accessibilityLabel={name}
      style={[
        styles.mark,
        styles.fallback,
        { width: size, height: size, borderRadius: radius.md, backgroundColor: color.surfaceSunken },
      ]}
    >
      <Text style={{ color: color.textSecondary, fontWeight: '700', fontSize: size * 0.4 }}>
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
