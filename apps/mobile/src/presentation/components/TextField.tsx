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
 * Focus is signalled by a brand-green border and a soft ring rather than a
 * colour flood, so the field stays quiet until the user is actually in it.
 */
export function TextField({ label, error, hint, prefix, style, ...rest }: Props) {
  const { color, space, radius, text } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? color.dangerFill : focused ? color.borderFocus : color.border;

  return (
    <View style={{ marginBottom: space[4] }}>
      <Text style={[text.label, { color: color.textSecondary, marginBottom: space[2] }]}>
        {label}
      </Text>

      <View
        style={[
          styles.field,
          {
            backgroundColor: color.surface,
            borderColor,
            borderRadius: radius.lg,
            paddingHorizontal: space[4],
            gap: space[1],
          },
          focused && !error ? styles.ringBrand : null,
          error ? styles.ringDanger : null,
        ]}
      >
        {prefix ? (
          <Text style={[text.body, { color: color.textSecondary }]}>{prefix}</Text>
        ) : null}
        <TextInput
          placeholderTextColor={color.textTertiary}
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
  ringBrand: {
    shadowColor: '#0B5D3B',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  ringDanger: {
    shadowColor: '#F04438',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
