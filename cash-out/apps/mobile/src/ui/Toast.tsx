import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';
import { Text } from './Text';

export type ToastTone = 'neutral' | 'success' | 'danger';

interface ToastValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastValue>({ show: () => undefined });

/**
 * A short, non-blocking confirmation: "Language changed", "Account linked".
 * Never used for anything the driver must act on — that is a Dialog — and
 * never for money outcomes, which have screens of their own.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = 'neutral') => {
    setToast({ message, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: toast ? 1 : 0,
      duration: theme.motion.fast,
      useNativeDriver: true,
    }).start();
  }, [toast, opacity, theme.motion.fast]);

  const background =
    toast?.tone === 'success'
      ? theme.colors.success
      : toast?.tone === 'danger'
        ? theme.colors.danger
        : theme.colors.surfaceInverse;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <View pointerEvents="none" style={[styles.anchor, { top: insets.top + theme.spacing.md }]}>
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            theme.elevation.sheet,
            {
              opacity,
              backgroundColor: background,
              borderRadius: theme.radius.control,
              paddingHorizontal: theme.spacing.base,
              paddingVertical: theme.spacing.md,
            },
          ]}
        >
          <Text variant="label" tone="inverse" align="center">
            {toast?.message ?? ''}
          </Text>
        </Animated.View>
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { maxWidth: 480, minWidth: 160 },
});
