import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';
import { Jako } from './Jako';
import { Button } from './Button';

/**
 * Empty states are the one place Jako earns his keep in-product: a real
 * illustration would be decoration, but here the mark gives an otherwise
 * blank screen a moment of brand warmth without adding noise.
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
  const { color, space, text, premium } = useTheme();

  return (
    <View style={[styles.wrap, { paddingVertical: space[10], gap: space[3] }]}>
      {/* Dimmed one step from the mark's normal plumage, not two. The
          border tokens this used to reach for are 8-10% white — a bird
          nobody can see — and the tertiary/muted pair was barely better.
          An empty state should be quiet, not empty of its own illustration. */}
      <Jako
        size={56}
        colors={{ body: color.textSecondary, crown: color.textTertiary, brand: premium.brand.dark }}
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
          <Button label={actionLabel} onPress={onAction} variant="secondary" size="md" fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
});
