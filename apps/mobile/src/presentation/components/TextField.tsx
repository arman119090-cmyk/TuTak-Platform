import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { useAppTheme } from '../../app/theme/ThemeProvider';

interface Props extends TextInputProps {
  label: string;
  error?: string;
}

export function TextField({ label, error, style, ...rest }: Props) {
  const { theme, spacing, radius, typography } = useAppTheme();

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.footnote, { color: theme.textSecondary, marginBottom: spacing.xs }]}>
        {label}
      </Text>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          typography.body,
          {
            color: theme.textPrimary,
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : theme.border,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[typography.caption, { color: theme.danger, marginTop: spacing.xs }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { height: 48, borderWidth: StyleSheet.hairlineWidth },
});
