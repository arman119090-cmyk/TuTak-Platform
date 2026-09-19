import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * A section's name, set as a quiet headline with a little more air above
 * it than below — the title belongs to what follows, not to what came
 * before. The optional action is a plain brand-coloured label; no chevron,
 * no pill.
 */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { color, space, text } = useTheme();

  return (
    <View style={[styles.row, { marginTop: space[6], marginBottom: space[3] }]}>
      <Text style={[text.headline, { color: color.textPrimary }]}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <Text style={[text.label, { color: color.primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
