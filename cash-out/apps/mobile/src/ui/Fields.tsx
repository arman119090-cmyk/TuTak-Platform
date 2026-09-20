import React, { forwardRef, useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Input, type InputProps, type TextInputHandle } from './Input';
import { Text } from './Text';

/** The design system's name for the text field. */
export const TextField = Input;

/**
 * A phone number field with the country prefix fixed: Armenia only, until a
 * second country ships. Digits are kept clean of separators; the visible
 * grouping is for reading, the value for sending.
 */
export const PhoneField = forwardRef<
  TextInputHandle,
  Omit<InputProps, 'value' | 'onChangeText'> & {
    digits: string;
    onDigitsChange: (digits: string) => void;
    countryCode?: string;
    maxDigits?: number;
  }
>(function PhoneField(
  { digits, onDigitsChange, countryCode = '+374', maxDigits = 8, ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      prefix={countryCode}
      value={digits}
      onChangeText={(text) => onDigitsChange(text.replace(/\D/g, '').slice(0, maxDigits))}
      keyboardType="phone-pad"
      inputMode="tel"
      autoComplete="tel"
      textContentType="telephoneNumber"
      placeholder="00 00 00 00"
      maxLength={maxDigits}
      {...rest}
    />
  );
});

/**
 * The one-time code as boxes. One hidden input holds the value — so SMS
 * autofill, paste and the system keyboard all work — and the boxes only
 * render it, one digit each, with the next empty box highlighted.
 */
export function OtpField({
  value,
  onChange,
  length,
  error,
  autoFocus = true,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  length: number;
  error?: string | null;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const input = useRef<TextInputHandle>(null);

  return (
    <View>
      <Pressable
        accessibilityRole="none"
        onPress={() => input.current?.focus()}
        style={[styles.boxes, { gap: theme.spacing.sm }]}
      >
        {Array.from({ length }, (_, index) => {
          const digit = value[index] ?? '';
          const active = index === value.length;
          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  borderRadius: theme.radius.control,
                  borderColor: error
                    ? theme.colors.danger
                    : active
                      ? theme.colors.primary
                      : theme.colors.borderStrong,
                  borderWidth: active || error ? 2 : 1,
                  backgroundColor: theme.colors.surface,
                  height: theme.touchTarget.primaryAction,
                },
              ]}
            >
              <Text variant="amountMedium" tabular>
                {digit}
              </Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus={autoFocus}
        editable={!disabled}
        maxLength={length}
        caretHidden
        style={styles.hidden}
        accessibilityLabel="One-time code"
      />
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.xs }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', justifyContent: 'center' },
  box: { flex: 1, maxWidth: 56, alignItems: 'center', justifyContent: 'center' },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
