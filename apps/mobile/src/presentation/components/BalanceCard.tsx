import React, { useState } from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeProvider';
import { JakoWatermark } from './Jako';
import { Skeleton } from './Skeleton';
import { formatPoints } from '../utils/format';

// `TUTAK_V2_UI_ASSET_MANIFEST.md` / `README_ASSETS_V2.md`: 1600×800,
// designed with the left side clear for app-rendered text and Jako at the
// right; "keep the original file dimensions; crop with resizeMode
// 'cover'... from the right-side subject position", and "do not put
// permanent text into the hero artwork — the app must render localized
// text over it" (already true here: every string below is `t(...)`).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const heroImage = require('../../../assets/tutak-home-hero-parrot-v2.jpg');

interface Props {
  available?: string;
  pending?: string;
  reserved?: string;
  loading?: boolean;
}

/**
 * The hero of the app — Home only (see `TUTAK_UI_UX_MASTER_SPEC_V2.md` §1
 * "Hero balance card... Jako artwork on the right, screen text on the
 * left"). Master spec: "The screen must still work if every external
 * partner image fails to load: use an initial/logo fallback with a neutral
 * tinted surface" — the hero art here is a bundled TuTak asset, not a
 * remote partner image, so it cannot fail to load the way a network image
 * can, but `onError` still degrades to the plain brand gradient + Jako
 * watermark this card used before the hero art existed, rather than an
 * empty background, in case a bundler/platform ever fails to resolve it.
 */
export function BalanceCard({ available, pending, reserved, loading }: Props) {
  const { color, space, radius, gradients, glow } = useTheme();
  const [heroFailed, setHeroFailed] = useState(false);

  if (heroFailed) {
    return (
      <LinearGradient
        colors={[...gradients.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, glow.md.native, { borderRadius: radius['2xl'], padding: space[6] }]}
      >
        <View style={styles.watermark} pointerEvents="none">
          <JakoWatermark size={260} color={color.textInverse} opacity={0.1} />
        </View>
        <BalanceCardBody
          available={available}
          pending={pending}
          reserved={reserved}
          loading={loading}
        />
      </LinearGradient>
    );
  }

  return (
    <ImageBackground
      source={heroImage}
      resizeMode="cover"
      onError={() => setHeroFailed(true)}
      style={[styles.card, glow.md.native, { borderRadius: radius['2xl'] }]}
      imageStyle={{ borderRadius: radius['2xl'] }}
    >
      {/* Accessibility-safe gradient scrim over the photo, left-weighted —
          the same "gradient overlay only when text is shown on it" rule the
          master spec gives partner cards, applied to TuTak's own hero. */}
      <LinearGradient
        colors={['rgba(11,93,59,0.82)', 'rgba(11,93,59,0.38)', 'rgba(11,93,59,0.05)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius['2xl'] }]}
      />
      <View style={{ padding: space[6] }}>
        <BalanceCardBody
          available={available}
          pending={pending}
          reserved={reserved}
          loading={loading}
        />
      </View>
    </ImageBackground>
  );
}

function BalanceCardBody({ available, pending, reserved, loading }: Props) {
  const { color, space, text } = useTheme();
  const { t } = useTranslation();

  return (
    <>
      <Text style={[text.caption, { color: 'rgba(255,255,255,0.72)' }]}>
        {t('wallet.available')}
      </Text>

      {loading ? (
        <View style={{ marginTop: space[3] }}>
          <Skeleton width="60%" height={44} />
        </View>
      ) : (
        <View style={[styles.amountRow, { marginTop: space[1], gap: space[2] }]}>
          <Text style={[text.balance, { color: color.textInverse }]}>
            {formatPoints(available ?? 0)}
          </Text>
          <Text style={[text.body, { color: 'rgba(255,255,255,0.72)', marginBottom: space[2] }]}>
            {t('common.points')}
          </Text>
        </View>
      )}

      <View style={{ marginTop: space[5] }}>
        <BonusCompositionOnBrand
          available={available ?? 0}
          pending={pending ?? 0}
          reserved={reserved ?? 0}
        />
      </View>
    </>
  );
}

/**
 * The composition bar restyled for the brand-green card: the track goes
 * translucent-white instead of grey so the three state hues stay vivid
 * against the dark surface.
 */
function BonusCompositionOnBrand({
  available,
  pending,
  reserved,
}: {
  available: string | number;
  pending: string | number;
  reserved: string | number;
}) {
  const { color, space, radius, text } = useTheme();
  const { t } = useTranslation();

  const a = Number(available) || 0;
  const p = Number(pending) || 0;
  const r = Number(reserved) || 0;
  const total = a + p + r;

  const segments = [
    { key: 'available', value: a, fill: color.availableFill, label: t('wallet.available') },
    { key: 'pending', value: p, fill: color.pendingFill, label: t('wallet.pending') },
    { key: 'reserved', value: r, fill: color.reservedFill, label: t('wallet.reserved') },
  ];

  return (
    <View>
      <View
        style={[
          styles.track,
          { borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.18)' },
        ]}
      >
        {total > 0 ? (
          <View style={styles.trackInner}>
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <View key={s.key} style={{ flex: s.value, backgroundColor: s.fill }} />
              ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.legend, { marginTop: space[4] }]}>
        {segments.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendHeader, { gap: space[2] - 2 }]}>
              <View style={[styles.dot, { backgroundColor: s.fill }]} />
              <Text style={[text.caption, { color: 'rgba(255,255,255,0.72)' }]}>{s.label}</Text>
            </View>
            <Text style={[text.label, { color: color.textInverse, marginTop: space[1] }]}>
              {formatPoints(s.value)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', position: 'relative' },
  watermark: { position: 'absolute', right: -70, top: -50 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end' },
  track: { height: 8, overflow: 'hidden', width: '100%' },
  trackInner: { flexDirection: 'row', height: '100%', width: '100%' },
  legend: { flexDirection: 'row' },
  legendItem: { flex: 1 },
  legendHeader: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
