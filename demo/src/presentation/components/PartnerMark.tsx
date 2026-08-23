import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §4: "create one reusable `PartnerMark`
 * component that renders a logo, loading/error state, and [a] fallback...
 * Do not paste separate image-loading logic into each screen." Every
 * customer-facing operation surface the spec's §1 lists (map/directory
 * card, PurchaseIntent, transaction/wallet rows, EV-session history, refund
 * rows) is meant to render a partner identity through this one component.
 *
 * The fallback is the same glossy Jako lockup `UserAvatar` and `SplashScreen`
 * use (`assets/logo-mark.png`, not the small flat vector mark), on a
 * blue-tinted surface so a partner without a logo is still visually
 * distinguishable at a glance from `UserAvatar`'s green-tinted customer
 * fallback — per Arman's explicit request, 2026-08-23 (first as the small
 * vector mark recoloured, then corrected to this exact logo image on a
 * tinted background instead), which supersedes this component's earlier
 * initials-only fallback (the spec's written "initials" instruction
 * predates that request).
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
  circular = false,
  fallback,
  fallbackBackgroundColor,
}: {
  /** The partner's display name — used for the accessibility label. */
  name: string;
  logoUrl?: string | null;
  size?: number;
  /**
   * Renders fully round (`radius.full`) instead of this component's usual
   * soft-square `radius.md`. Added for `PartnerPin`: the map pin needs "a
   * small circular avatar" per Arman's request, 2026-08-23, while every
   * other surface (list cards, the detail header) keeps the rounded-square
   * logo treatment this component has always used.
   */
  circular?: boolean;
  /**
   * What to render instead of the glossy Jako lockup when there is no logo
   * (or it failed to load). Added for `PartnerPin` — the map pin's confirmed
   * behaviour is "the partner's own logo, falling back to the *category*
   * icon", not this component's generic neutral mark, per Arman's request,
   * 2026-08-23. Every other call site omits this and keeps the original
   * fallback unchanged.
   */
  fallback?: React.ReactNode;
  /** Paired with a custom `fallback` that wants a different tint than the
   * default blue-tinted surface — e.g. the map pin's own disc colour, so the
   * category icon sits on the same background the pin already renders on
   * rather than a mismatched square behind a round disc. */
  fallbackBackgroundColor?: string;
}) {
  const { color, radius } = useTheme();
  const [failed, setFailed] = useState(false);
  const cornerRadius = circular ? radius.full : radius.md;

  if (logoUrl && !failed) {
    return (
      <Image
        source={{ uri: logoUrl }}
        onError={() => setFailed(true)}
        accessibilityLabel={name}
        style={[styles.mark, { width: size, height: size, borderRadius: cornerRadius }]}
      />
    );
  }

  if (fallback) {
    return (
      <View
        accessibilityLabel={name}
        style={[
          styles.mark,
          styles.fallback,
          {
            width: size,
            height: size,
            borderRadius: cornerRadius,
            backgroundColor: fallbackBackgroundColor ?? color.reservedSurface,
          },
        ]}
      >
        {fallback}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={name}
      style={[
        styles.mark,
        styles.fallback,
        { width: size, height: size, borderRadius: cornerRadius, backgroundColor: color.reservedSurface },
      ]}
    >
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../../assets/logo-mark.png')}
        style={{ width: size * 0.72, height: size * 0.72 }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
