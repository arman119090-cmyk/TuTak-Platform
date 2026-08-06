import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

interface Props {
  title: string;
  subtitle?: string;
  /** Right-aligned primary value, e.g. an amount. */
  value?: string;
  valueTone?: 'default' | 'positive' | 'negative' | 'muted';
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Hides the hairline on the final row of a group. */
  last?: boolean;
}

/**
 * The universal list row — transactions, notifications, invites, sessions
 * and settings all use this, so scanning any list in the app relies on the
 * same muscle memory.
 */
export function ListRow({
  title,
  subtitle,
  value,
  valueTone = 'default',
  leading,
  trailing,
  onPress,
  last,
}: Props) {
  const { color, space, text } = useTheme();

  const valueColor = {
    default: color.textPrimary,
    positive: color.availableText,
    negative: color.textPrimary,
    muted: color.textSecondary,
  }[valueTone];

  const body = (
    <View
      style={[
        styles.row,
        {
          paddingVertical: space[4],
          gap: space[3],
          borderBottomColor: color.border,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      {leading}
      <View style={styles.flex}>
        <Text style={[text.body, { color: color.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[text.headline, { color: valueColor }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
