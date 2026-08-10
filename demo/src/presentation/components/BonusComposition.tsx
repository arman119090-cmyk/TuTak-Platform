import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeProvider';
import { formatPoints } from '../utils/format';

interface Props {
  available: string | number;
  pending: string | number;
  reserved: string | number;
  /** Hides the legend when the bar is used inline in a dense list. */
  compact?: boolean;
}

/**
 * The single most important component in the product.
 *
 * TuTak's bonus model has three simultaneous states, and the original design
 * showed them as three disconnected pills — which tells you the numbers but
 * not the shape of your balance. This renders them as one continuous bar
 * whose segments are proportional, so "most of my points are still pending"
 * is legible in about a quarter of a second, before any number is read.
 *
 * The bar is the only place these three hues ever appear together, which is
 * what makes the colour coding learnable: see it once here, and the green
 * dot on a transaction row three screens away is already understood.
 */
export function BonusComposition({ available, pending, reserved, compact = false }: Props) {
  const { color, space, radius, text, motion } = useTheme();
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

  // Animate width changes so a payment visibly moves value between states
  // rather than teleporting it.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.duration.deliberate,
      useNativeDriver: false,
    }).start();
  }, [total, a, p, r, progress, motion.duration.deliberate]);

  return (
    <View accessible accessibilityLabel={buildA11yLabel(segments, total)}>
      <View
        style={[
          styles.track,
          { borderRadius: radius.full, backgroundColor: color.surfaceSunken },
        ]}
      >
        {total === 0 ? null : (
          <View style={styles.trackInner}>
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <Animated.View
                  key={s.key}
                  style={{
                    flex: s.value,
                    backgroundColor: s.fill,
                    opacity: progress,
                  }}
                />
              ))}
          </View>
        )}
      </View>

      {compact ? null : (
        <View style={[styles.legend, { marginTop: space[4], gap: space[5] }]}>
          {segments.map((s) => (
            <View key={s.key} style={styles.legendItem}>
              <View style={[styles.legendHeader, { gap: space[2] }]}>
                <View style={[styles.dot, { backgroundColor: s.fill }]} />
                <Text style={[text.caption, { color: color.textSecondary }]}>{s.label}</Text>
              </View>
              <Text
                style={[
                  text.headline,
                  { color: color.textPrimary, marginTop: space[1] },
                ]}
              >
                {formatPoints(s.value)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function buildA11yLabel(
  segments: { label: string; value: number }[],
  total: number,
): string {
  if (total === 0) return 'No bonus points yet';
  return segments
    .filter((s) => s.value > 0)
    .map((s) => `${s.label}: ${formatPoints(s.value)}`)
    .join(', ');
}

const styles = StyleSheet.create({
  track: { height: 10, overflow: 'hidden', width: '100%' },
  trackInner: { flexDirection: 'row', height: '100%', width: '100%' },
  legend: { flexDirection: 'row' },
  legendItem: { flex: 1 },
  legendHeader: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
