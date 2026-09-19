import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/theme';

type Variant = keyof ReturnType<typeof useTheme>['typography'];
type Tone = 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'brand' | 'danger' | 'success' | 'warning';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  align?: TextStyle['textAlign'];
  /**
   * Renders digits in a fixed-width face so an amount does not jiggle as it
   * changes. Used by every screen that shows money.
   */
  tabular?: boolean;
}

/**
 * The only text primitive in the app.
 *
 * Screens choose a role ("titleLarge", "caption") and a tone ("secondary"),
 * never a font size or a hex value; the design tokens decide what those mean.
 * That is what keeps the type scale and the contrast guarantees intact when a
 * screen is written in a hurry.
 */
export function Text({
  variant = 'body',
  tone = 'primary',
  align,
  tabular,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const token = theme.typography[variant];

  const color: Record<Tone, string> = {
    primary: theme.colors.textPrimary,
    secondary: theme.colors.textSecondary,
    tertiary: theme.colors.textTertiary,
    inverse: theme.colors.textInverse,
    brand: theme.colors.primary,
    danger: theme.colors.danger,
    success: theme.colors.success,
    warning: theme.colors.warning,
  };

  return (
    <RNText
      // Amounts and labels must stay legible when the driver has bumped the
      // system font size, but the balance hero must not wrap into three lines.
      maxFontSizeMultiplier={variant.startsWith('amount') ? 1.3 : 1.8}
      style={[
        {
          fontSize: token.fontSize,
          lineHeight: token.lineHeight,
          fontWeight: token.fontWeight as TextStyle['fontWeight'],
          letterSpacing: token.letterSpacing,
          color: color[tone],
          textAlign: align,
        },
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
      {...rest}
    />
  );
}
