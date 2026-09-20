import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Text } from './Text';

export interface Segment<T extends string> {
  value: T;
  label: string;
}

/**
 * A row of mutually exclusive choices. Labels wrap rather than truncate —
 * Armenian words are long, and "Ամեն օր" cut to "Ամեն…" is not a choice.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  disabled = false,
}: {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.control,
          padding: theme.spacing.xs,
        },
      ]}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(segment.value)}
            style={[
              styles.segment,
              {
                backgroundColor: selected ? theme.colors.surface : 'transparent',
                borderRadius: theme.radius.md,
                minHeight: theme.touchTarget.minimum,
                paddingHorizontal: theme.spacing.sm,
              },
              selected ? theme.elevation.card : null,
            ]}
          >
            <Text variant="label" tone={selected ? 'primary' : 'secondary'} align="center">
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
});
