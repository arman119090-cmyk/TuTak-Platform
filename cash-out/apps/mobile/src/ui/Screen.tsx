import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';

export interface ScreenProps {
  children: React.ReactNode;
  /** Pinned to the bottom, above the safe area. The main CTA lives here. */
  footer?: React.ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  /** Uses the brand colour as the background — the splash and result screens. */
  tone?: 'default' | 'brand';
}

/**
 * Every screen's frame: safe areas, keyboard avoidance, an optional pinned
 * footer, and the 16pt side gutter the whole product uses.
 *
 * The footer is pinned rather than scrolled with the content because the
 * primary action must be reachable with a thumb without hunting for it — on a
 * small phone the review screen's content can exceed the viewport, and a CTA
 * that scrolls off is a CTA that gets missed.
 */
export function Screen({
  children,
  footer,
  scroll = true,
  onRefresh,
  refreshing = false,
  style,
  contentStyle,
  tone = 'default',
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const background = tone === 'brand' ? theme.colors.primary : theme.colors.background;

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingHorizontal: theme.spacing.base, paddingBottom: theme.spacing.xl },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[styles.content, { flex: 1, paddingHorizontal: theme.spacing.base }, contentStyle]}
    >
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: background, paddingTop: insets.top }, style]}
    >
      {body}
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              paddingHorizontal: theme.spacing.base,
              paddingTop: theme.spacing.md,
              paddingBottom: Math.max(insets.bottom, theme.spacing.base),
              backgroundColor: background,
              borderTopColor: theme.colors.border,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});
