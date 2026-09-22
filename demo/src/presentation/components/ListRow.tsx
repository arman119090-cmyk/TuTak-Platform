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
  /** Hides the separator on the final row of a group. */
  last?: boolean;
}

/**
 * The universal list row — transactions, notifications, invites, sessions
 * and settings all use this, so scanning any list in the app relies on the
 * same muscle memory.
 *
 * The separator is inset to the text column (it starts where the title
 * starts, not at the row's edge) and drawn in the lightest neutral. A
 * full-width hairline under every row turned every list into a table; an
 * inset one reads as grouping, which is all a separator is for.
 *
 * Pressing dims the row's own background rather than its content: a row
 * that fades to 60% on touch looks like it is being disabled.
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

  const body = (pressed: boolean) => (
    <View
      style={[
        styles.row,
        {
          paddingVertical: space[4] - 2,
          gap: space[3],
          backgroundColor: pressed ? color.fillSubtle : 'transparent',
          marginHorizontal: -space[2],
          paddingHorizontal: space[2],
          borderRadius: space[3],
        },
      ]}
    >
      {leading}
      <View style={styles.flex}>
        <View style={styles.textRow}>
          <View style={styles.flex}>
            <Text style={[text.body, { color: color.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={[text.caption, { color: color.textSecondary, marginTop: 2 }]}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {value ? (
            <Text
              style={[text.headline, styles.value, { color: valueColor, marginLeft: space[3] }]}
              numberOfLines={1}
            >
              {value}
            </Text>
          ) : null}
          {trailing ? <View style={{ marginLeft: space[3] }}>{trailing}</View> : null}
        </View>
        {last ? null : (
          <View
            style={[
              styles.separator,
              { backgroundColor: color.divider, marginTop: space[4] - 2 },
            ]}
          />
        )}
      </View>
    </View>
  );

  if (!onPress) return body(false);

  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  textRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  value: { fontVariant: ['tabular-nums'] },
  separator: { height: StyleSheet.hairlineWidth, marginBottom: -(16 - 2) },
});
