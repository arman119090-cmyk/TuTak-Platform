import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';
import { Text } from './Text';

/**
 * A bottom sheet.
 *
 * Two deliberate choices: the backdrop dismisses only when `dismissable`, so a
 * confirmation cannot be dismissed by a stray tap, and the sheet is a real
 * `Modal`, so the OS back gesture and screen readers treat it as a layer rather
 * than as decoration drawn over the page.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  dismissable = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissable?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? theme.motion.base : theme.motion.fast,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide, theme.motion]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={dismissable ? onClose : undefined}
      statusBarTranslucent
    >
      <Animated.View
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay, opacity: slide }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissable ? onClose : undefined}
          accessibilityLabel={dismissable ? 'Close' : undefined}
        />
      </Animated.View>

      <View style={styles.anchor} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            theme.elevation.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xxl,
              borderTopRightRadius: theme.radius.xxl,
              paddingHorizontal: theme.spacing.base,
              paddingTop: theme.spacing.md,
              paddingBottom: Math.max(insets.bottom, theme.spacing.base),
              transform: [
                { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.grabber,
              { backgroundColor: theme.colors.borderStrong, borderRadius: theme.radius.pill },
            ]}
          />
          {title ? (
            <Text variant="title" align="center" style={{ marginBottom: theme.spacing.base }}>
              {title}
            </Text>
          ) : null}
          {children}
          {footer ? <View style={{ marginTop: theme.spacing.base }}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%' },
  grabber: { width: 40, height: 4, alignSelf: 'center', marginBottom: 12 },
});
