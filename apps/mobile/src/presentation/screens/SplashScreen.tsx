import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * Shown while the persisted session is rehydrated. The full glossy Jako
 * lockup fades and settles upward once — a single, quiet gesture rather than
 * a looping animation, so a fast launch never looks like it is waiting on
 * something.
 *
 * The splash is the one full-size logo placement inside the app itself (as
 * opposed to the OS-level app icon), which is why it reaches for the glossy
 * illustration in `assets/logo-mark.png` rather than the small flat `Jako`
 * vector mark every other screen uses — see `packages/design/src/brand/assets/README.md`
 * for where that image came from.
 */
export function SplashScreen() {
  const { color, space, text } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 18,
        stiffness: 180,
        mass: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <View style={[styles.wrap, { backgroundColor: color.background }]}>
      <Animated.View style={{ opacity, transform: [{ translateY }], alignItems: 'center' }}>
        <Image
          // Metro's static-asset pipeline is require()-based — there is no
          // ESM import for a local image without an ambient module
          // declaration this codebase does not otherwise need, for the one
          // place it is used.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../../assets/logo-mark.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text
          style={[
            text.title,
            { color: color.textPrimary, marginTop: space[4], letterSpacing: -0.4 },
          ]}
        >
          TuTak
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 96, height: 96 },
});
