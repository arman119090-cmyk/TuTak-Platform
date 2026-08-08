import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * Loading placeholders rather than spinners: the layout never jumps when
 * data lands, which is most of what makes an app feel fast.
 *
 * The placeholder is a wash of white, not the sunken surface colour the
 * light theme used. On #0A0A0F a "sunken" panel is within a couple of
 * percent of the background — the skeleton was there, and invisible, which
 * is the same as having no loading state at all.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
}) {
  const { glass, radius } = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, backgroundColor: glass.light, borderRadius: radius.sm, opacity: pulse },
        style,
      ]}
    />
  );
}
