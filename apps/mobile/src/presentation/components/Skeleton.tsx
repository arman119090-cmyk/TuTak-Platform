import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * Loading placeholders rather than spinners: the layout never jumps when
 * data lands, which is most of what makes an app feel fast.
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
  const { color, radius } = useTheme();
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
        { width, height, backgroundColor: color.surfaceSunken, borderRadius: radius.sm, opacity: pulse },
        style,
      ]}
    />
  );
}
