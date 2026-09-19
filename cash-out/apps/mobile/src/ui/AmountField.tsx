import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { useI18n } from '../i18n/i18n';
import { Text } from './Text';

export interface AmountFieldProps {
  /** The raw digits the driver has typed, in major units (e.g. "12500"). */
  value: string;
  onChange: (next: string) => void;
  currency: string;
  error?: string | null;
  /** Quick-pick amounts, in major units. */
  presets?: number[];
  onPresetPress?: (value: number) => void;
  allLabel: string;
  onAllPress: () => void;
  autoFocus?: boolean;
}

/**
 * The amount entry.
 *
 * The field is the size of a headline and uses the numeric keypad, because this
 * is the one number the driver types and it must be readable at arm's length.
 * The presets and "withdraw everything" exist because most drivers want either
 * a round number or all of it, and neither should require typing.
 */
export function AmountField({
  value,
  onChange,
  currency,
  error,
  presets = [],
  onPresetPress,
  allLabel,
  onAllPress,
  autoFocus = true,
}: AmountFieldProps) {
  const theme = useTheme();
  const { locale } = useI18n();

  const formatted = value
    ? new Intl.NumberFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US').format(
        Number(value),
      )
    : '';

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          value={formatted}
          onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 12))}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="0"
          placeholderTextColor={theme.colors.textTertiary}
          autoFocus={autoFocus}
          accessibilityLabel="Amount"
          style={[
            styles.input,
            {
              color: error ? theme.colors.danger : theme.colors.textPrimary,
              fontSize: theme.typography.amountHero.fontSize,
              lineHeight: theme.typography.amountHero.lineHeight,
              fontWeight: '700',
            },
          ]}
        />
        <Text variant="titleLarge" tone="secondary" style={{ marginLeft: theme.spacing.sm }}>
          {currency === 'AMD' ? '֏' : currency}
        </Text>
      </View>

      {error ? (
        <Text variant="body" tone="danger" align="center" style={{ marginTop: theme.spacing.sm }}>
          {error}
        </Text>
      ) : null}

      <View style={[styles.presets, { marginTop: theme.spacing.xl, gap: theme.spacing.sm }]}>
        {presets.map((preset) => (
          <Chip
            key={preset}
            label={new Intl.NumberFormat(
              locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US',
            ).format(preset)}
            onPress={() => onPresetPress?.(preset)}
          />
        ))}
        <Chip label={allLabel} onPress={onAllPress} emphasis />
      </View>
    </View>
  );
}

function Chip({
  label,
  onPress,
  emphasis = false,
}: {
  label: string;
  onPress: () => void;
  emphasis?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget.minimum,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.base,
        borderRadius: theme.radius.pill,
        backgroundColor: emphasis
          ? pressed
            ? theme.colors.primary
            : theme.colors.primarySoft
          : pressed
            ? theme.colors.border
            : theme.colors.surfaceMuted,
      })}
    >
      <Text variant="label" tone={emphasis ? 'brand' : 'primary'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  input: { minWidth: 120, textAlign: 'center', paddingVertical: 8 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
