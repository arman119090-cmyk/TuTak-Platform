import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * A way off a screen, for the screens that do not use `Screen`.
 *
 * Every navigator in this app sets `headerShown: false`, so React Navigation
 * never draws its own back arrow. `Screen` now draws one; the sign-in screens
 * build their own layout and so need this.
 *
 * Renders nothing when there is nowhere to go — which is what makes it safe to
 * place unconditionally, including on the first screen of a stack.
 */
export function BackButton({ style }: { style?: object }) {
  const navigation = useNavigation();
  const { color, space } = useTheme();

  if (!navigation.canGoBack()) return null;

  return (
    <Pressable
      onPress={() => navigation.goBack()}
      // Generous, because this is the control people reach for when they are
      // lost, and a 26pt icon is a small target for a thumb.
      hitSlop={16}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={[{ alignSelf: 'flex-start', marginBottom: space[3] }, style]}
    >
      <Ionicons name="chevron-back" size={26} color={color.textPrimary} />
    </Pressable>
  );
}
