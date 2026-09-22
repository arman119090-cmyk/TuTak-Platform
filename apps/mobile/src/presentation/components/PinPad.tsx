import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';
import type { BiometricKind } from '../../data/biometrics/biometricDevice';
import { PIN_LENGTH } from '../../data/appLock/pinCode';

interface Props {
  /** Digits typed so far; only its length is shown. */
  value: string;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  /** When set, the bottom-left key offers the biometric instead of staying empty. */
  onBiometric?: () => void;
  biometricKind?: BiometricKind | null;
  disabled?: boolean;
  /** Turns the dots red for a wrong code. */
  error?: boolean;
  /** Accessibility label for the biometric key. */
  biometricLabel?: string;
}

/**
 * The code keypad: four dots and twelve keys, drawn by the app.
 *
 * Not a `TextInput`. A hidden text field with `keyboardType="number-pad"`
 * is the usual shortcut and it drags in the system keyboard — which on the
 * Android handsets this product has been tested on is exactly the component
 * whose focus misbehaves (see `docs/ANDROID_KEYBOARD_*`). A lock screen is
 * shown on every cold start; it cannot be the screen that flickers. Twelve
 * pressables have no focus, no IME, and no keyboard animation to wait for.
 *
 * Layout: 3×4 grid, 72pt targets, a comfortable gap. The bottom row is
 * biometric · 0 · backspace, matching what a phone's own lock screen does,
 * so nobody has to learn it.
 */
export function PinPad({
  value,
  onDigit,
  onBackspace,
  onBiometric,
  biometricKind,
  disabled,
  error,
  biometricLabel,
}: Props) {
  const { color, space, text } = useTheme();
  const rows: (string | 'bio' | 'back' | null)[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [onBiometric ? 'bio' : null, '0', 'back'],
  ];
  const biometricIcon = biometricKind === 'face' ? 'scan-outline' : 'finger-print-outline';

  return (
    <View style={styles.wrap}>
      <View style={[styles.dots, { gap: space[4], marginBottom: space[8] }]} accessibilityLabel={`${value.length}/${PIN_LENGTH}`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              testID={`pin-dot-${filled ? 'filled' : 'empty'}`}
              style={[
                styles.dot,
                {
                  borderColor: error ? color.dangerFill : filled ? color.primary : color.borderStrong,
                  backgroundColor: error ? color.dangerFill : filled ? color.primary : 'transparent',
                },
              ]}
            />
          );
        })}
      </View>
      <View style={{ gap: space[3] }}>
        {rows.map((row, r) => (
          <View key={r} style={[styles.row, { gap: space[5] }]}>
            {row.map((key, c) => {
              if (key === null) return <View key={c} style={styles.key} />;
              const isDigit = key !== 'bio' && key !== 'back';
              const label = isDigit ? key : key === 'back' ? 'backspace' : (biometricLabel ?? 'biometric');
              return (
                <Pressable
                  key={c}
                  testID={`pin-key-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  disabled={disabled}
                  onPress={() => {
                    if (isDigit) onDigit(key);
                    else if (key === 'back') onBackspace();
                    else onBiometric?.();
                  }}
                  style={({ pressed }) => [
                    styles.key,
                    {
                      backgroundColor: pressed ? color.surfaceSunken : isDigit ? color.surface : 'transparent',
                      borderColor: isDigit ? color.border : 'transparent',
                      opacity: disabled ? 0.5 : 1,
                    },
                  ]}
                >
                  {isDigit ? (
                    <Text style={[text.title, styles.digit, { color: color.textPrimary }]}>{key}</Text>
                  ) : (
                    <Ionicons name={key === 'back' ? 'backspace-outline' : biometricIcon} size={28} color={color.textPrimary} />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  row: { flexDirection: 'row', justifyContent: 'center' },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontSize: 28, lineHeight: 34 },
});
