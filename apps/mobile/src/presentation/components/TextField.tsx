import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  /** Rendered inside the field, before the input (e.g. a "+374" prefix). */
  prefix?: string;
}

/**
 * Focus is signalled by the brand blue arriving on the border and a soft
 * glow behind it, rather than by a colour flood — the field stays quiet
 * until the user is actually in it.
 *
 * The resting fill is a 5%-white wash rather than a solid panel. On a dark
 * UI a field filled with a lighter grey reads as *disabled*, because that is
 * what a greyed control looks like everywhere else; a barely-lit well reads
 * as empty and waiting, which is what it is.
 */
export function TextField({ label, error, hint, prefix, style, ...rest }: Props) {
  const { color, space, radius, text, glass, premium } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? color.dangerFill : focused ? color.borderFocus : glass.border;

  return (
    <View style={{ marginBottom: space[4] }}>
      <Text style={[text.label, { color: color.textSecondary, marginBottom: space[2] }]}>
        {label}
      </Text>

      <View
        style={[
          styles.field,
          {
            backgroundColor: focused ? glass.light : glass.background,
            borderColor,
            borderRadius: radius.md,
            paddingHorizontal: space[4],
            gap: space[1],
          },
          focused && !error
            ? { shadowColor: premium.brand.primary, ...styles.ring }
            : null,
          error ? { shadowColor: color.dangerFill, ...styles.ring } : null,
        ]}
      >
        {prefix ? (
          <Text style={[text.body, { color: color.textSecondary }]}>{prefix}</Text>
        ) : null}
        <TextInput
          placeholderTextColor={color.textTertiary}
          // Without this the OS paints a black caret on a black field, and
          // the user cannot see where they are typing.
          selectionColor={premium.brand.light}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, text.body, { color: color.textPrimary }, style]}
          {...rest}
        />
      </View>

      {error ? (
        <Text style={[text.caption, { color: color.dangerText, marginTop: space[2] }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[text.caption, { color: color.textTertiary, marginTop: space[2] }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', height: 54, borderWidth: 1 },
  input: { flex: 1, height: '100%' },
  ring: {
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});
