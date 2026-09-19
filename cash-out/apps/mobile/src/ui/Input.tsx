import React, { forwardRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

/** React Native 0.87 no longer exports the instance type under `TextInput`. */
export type TextInputHandle = ComponentRef<typeof TextInput>;
import { useTheme } from '../theme/theme';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Rendered inside the field, before the text — "+374", "֏". */
  prefix?: string;
}

export const Input = forwardRef<TextInputHandle, InputProps>(function Input(
  { label, hint, error, prefix, style, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.borderStrong;

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            minHeight: theme.touchTarget.comfortable,
            borderRadius: theme.radius.md,
            borderColor,
            borderWidth: focused || error ? 2 : 1,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.spacing.base,
          },
        ]}
      >
        {prefix ? (
          <Text variant="bodyLarge" tone="secondary" style={{ marginRight: theme.spacing.xs }}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          style={[
            styles.input,
            {
              color: theme.colors.textPrimary,
              fontSize: theme.typography.bodyLarge.fontSize,
            },
            style,
          ]}
          placeholderTextColor={theme.colors.textTertiary}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
      </View>

      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.xs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary" style={{ marginTop: theme.spacing.xs }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  field: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, paddingVertical: 12 },
});
