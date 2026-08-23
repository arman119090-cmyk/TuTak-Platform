import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';
import { Button } from './Button';
import { JakoWingMark } from './V2NavIcon';

/**
 * Empty states are the one place the mark earns its keep in-product: a real
 * illustration would be decoration, but here the logo gives an otherwise
 * blank screen a moment of brand warmth without adding noise. Renders the
 * same glossy Jako lockup as `UserAvatar`/`SplashScreen` (`assets/logo-mark.png`),
 * dimmed via opacity rather than the small flat vector mark this used to
 * draw — per Arman's request, 2026-08-23, that the actual logo photo appear
 * everywhere a bird does, not a separately-drawn approximation of it.
 */
export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { color, space, text } = useTheme();

  return (
    <View style={[styles.wrap, { paddingVertical: space[10], gap: space[3] }]}>
      {/* Dimmed, not full-strength — an empty state should be quiet, not
          empty of its own illustration. */}
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../../assets/logo-mark.png')}
        style={styles.mark}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      <Text style={[text.headline, { color: color.textPrimary, marginTop: space[2] }]}>
        {title}
      </Text>
      {message ? (
        <Text style={[text.bodySm, { color: color.textSecondary, textAlign: 'center' }]}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: space[4] }}>
          <Button
            label={actionLabel}
            onPress={onAction}
            variant="secondary"
            size="md"
            fullWidth={false}
            icon={<JakoWingMark size={14} color={color.textPrimary} />}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  mark: { width: 56, height: 56, opacity: 0.55 },
});
