import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { reserved } from '@tutak/design';
import { useTheme } from '../../app/theme/ThemeProvider';
import { Jako } from './Jako';

/**
 * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §4: "create one reusable `PartnerMark`
 * component that renders a logo, loading/error state, and [a] fallback...
 * Do not paste separate image-loading logic into each screen." Every
 * customer-facing operation surface the spec's §1 lists (map/directory
 * card, PurchaseIntent, transaction/wallet rows, EV-session history, refund
 * rows) is meant to render a partner identity through this one component.
 *
 * The fallback is the Jako mark, recoloured to a distinct blue accent so a
 * partner without a logo is still visually distinguishable at a glance from
 * `UserAvatar`'s green customer fallback — per Arman's explicit request,
 * 2026-08-23, which supersedes this component's earlier initials-only
 * fallback (the spec's written "initials" instruction predates that
 * request).
 *
 * `logoUrl` is intentionally optional and currently unused by every caller
 * in this delivery: no DTO in `@tutak/shared-types` yet returns a partner
 * logo or brand snapshot (`PartnerPublicDto`, `NearbyPartnerDto` and
 * `TransactionDto` carry no such field) — that requires the `MediaAsset`
 * migration, storage backend, and DTO extension the spec's §2-§4 describe,
 * which this visual-and-media-boundary delivery does not implement (see
 * the completion report). Every current call site therefore renders the
 * fallback deterministically, which is correct today and becomes the real
 * logo/fallback pair for free once a caller starts passing a real
 * `logoUrl` — no call site needs to change.
 */
export function PartnerMark({
  name,
  logoUrl,
  size = 40,
}: {
  /** The partner's display name — used for the accessibility label. */
  name: string;
  logoUrl?: string | null;
  size?: number;
}) {
  const { color, radius } = useTheme();
  const [failed, setFailed] = useState(false);

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
      <Jako size={size * 0.72} colors={{ brand: reserved[600] }} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
