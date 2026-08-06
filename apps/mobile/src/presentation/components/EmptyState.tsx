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
  const { color, space, text } = useTheme();

  return (
    <View style={[styles.wrap, { paddingVertical: space[10], gap: space[3] }]}>
      <Jako
        size={56}
        colors={{ body: color.borderStrong, crown: color.border, brand: color.primarySurface }}
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
