import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeProvider';
import { JakoWatermark } from './Jako';
import { Skeleton } from './Skeleton';
import { formatPoints } from '../utils/format';

interface Props {
  available?: string;
  pending?: string;
  reserved?: string;
  loading?: boolean;
}

/**
 * The hero of the app.
 *
 * The blue→violet gradient, edge-to-edge, with the available balance set
 * very large and everything else deliberately quiet — the one number a user
 * opens the app to see. It is the only full-bleed gradient in the app; the
 * primary button borrows the same ramp at a fraction of the area, which is
 * what ties the screen together without two things competing to be the
 * brightest.
 *
 * Jako sits behind it as a large, cropped, 10%-opacity silhouette: present
 * enough to make the card unmistakably TuTak, faint enough that it never
 * competes with the balance. The opacity is up from 7% because the mark now
 * sits on saturated blue rather than flat green, where white loses contrast.
 */
export function BalanceCard({ available, pending, reserved, loading }: Props) {
  const { color, space, radius, text, gradients, glow } = useTheme();
  const { t } = useTranslation();

  return (
    <LinearGradient
      colors={[...gradients.primary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.card,
        glow.md.native,
        {
          borderRadius: radius['2xl'],
          padding: space[6],
        },
      ]}
    >
      <View style={styles.watermark} pointerEvents="none">
        <JakoWatermark size={260} color={color.textInverse} opacity={0.1} />
      </View>

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
    </LinearGradient>
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
