import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Text } from './Text';

/**
 * A radio row: label, optional description, a ring that fills when selected.
 * 48pt tall at least, the whole row is the target.
 */
export function Radio({
  label,
  description,
  selected,
  onPress,
  disabled = false,
  first = false,
  last = false,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.touchTarget.comfortable,
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.md,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderTopLeftRadius: first ? theme.radius.card : 0,
          borderTopRightRadius: first ? theme.radius.card : 0,
          borderBottomLeftRadius: last ? theme.radius.card : 0,
          borderBottomRightRadius: last ? theme.radius.card : 0,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View style={{ flex: 1, marginRight: theme.spacing.md }}>
        <Text variant="body">{label}</Text>
        {description ? (
          <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.ring,
          {
            borderRadius: theme.radius.pill,
            borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
          },
        ]}
      >
        {selected ? (
          <View
            style={[
              styles.dot,
              { borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary },
            ]}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * A strip of tabs for switching between views on one screen (not the app's
 * bottom navigation). Labels wrap; the active tab is underlined in emerald.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.tabs, { borderBottomColor: theme.colors.border }]}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.value)}
            style={[
              styles.tab,
              {
                minHeight: theme.touchTarget.minimum,
                borderBottomColor: active ? theme.colors.primary : 'transparent',
              },
            ]}
          >
            <Text variant="label" tone={active ? 'brand' : 'secondary'} align="center">
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  ring: {
    width: 24,
    height: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 12, height: 12 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
});
