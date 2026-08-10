import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';
import { Jako } from '../components/Jako';

/**
 * Shown while the persisted session is rehydrated. Jako fades and settles
 * upward once — a single, quiet gesture rather than a looping animation, so
 * a fast launch never looks like it is waiting on something.
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
        <Jako size={64} />
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
});
