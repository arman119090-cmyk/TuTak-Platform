import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/theme';
import { Text } from './Text';

export const PIN_LENGTH = 6;

/**
 * Six dots and a keypad.
 *
 * The system keyboard is not used: it autocorrects, it remembers, it can be a
 * third-party keyboard that logs. The pad's keys are 64pt tall so a driver can
 * enter a PIN with one thumb, in a car, without looking closely. Completion is
 * reported through `onComplete`; the parent decides what "complete" means.
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  disabled = false,
  error,
  shake = 0,
  extraKey,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  error?: string | null;
  /** Bump to trigger a haptic on a wrong PIN. */
  shake?: number;
  /** An optional third key on the bottom row, e.g. "use biometrics". */
  extraKey?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();

  useEffect(() => {
    if (shake > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [shake]);

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    void Haptics.selectionAsync();
    const next = value + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  };

  const erase = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];

  return (
    <View style={styles.root}>
      <View
        style={[styles.dots, { gap: theme.spacing.md }]}
        accessibilityLabel={`${value.length} of ${PIN_LENGTH}`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              {
                borderRadius: theme.radius.pill,
                borderColor: error ? theme.colors.danger : theme.colors.borderStrong,
                backgroundColor:
                  index < value.length
                    ? error
                      ? theme.colors.danger
                      : theme.colors.primary
                    : 'transparent',
              },
            ]}
          />
        ))}
      </View>

      <Text
        variant="caption"
        tone={error ? 'danger' : 'tertiary'}
        align="center"
        style={{ marginTop: theme.spacing.sm, minHeight: 18 }}
      >
        {error ?? ' '}
      </Text>

      <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
        {rows.map((row) => (
          <View key={row.join('')} style={[styles.row, { gap: theme.spacing.sm }]}>
            {row.map((digit) => (
              <Key key={digit} label={digit} onPress={() => press(digit)} disabled={disabled} />
            ))}
          </View>
        ))}
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          {extraKey ? (
            <Key label={extraKey.label} onPress={extraKey.onPress} disabled={disabled} small />
          ) : (
            <View style={styles.spacer} />
          )}
          <Key label="0" onPress={() => press('0')} disabled={disabled} />
          <Key label="⌫" onPress={erase} disabled={disabled || value.length === 0} />
        </View>
      </View>
    </View>
  );
}

function Key({
  label,
  onPress,
  disabled,
  small = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        {
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderRadius: theme.radius.xl,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text
        variant={small ? 'label' : 'titleLarge'}
        tone={small ? 'brand' : 'primary'}
        align="center"
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'stretch' },
  dots: { flexDirection: 'row', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderWidth: 2 },
  row: { flexDirection: 'row' },
  key: {
    flex: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  spacer: { flex: 1 },
});
