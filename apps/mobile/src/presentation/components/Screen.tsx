import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../app/theme/ThemeProvider';
import { KeyboardAwareScroll } from './KeyboardAwareScroll';
import { useTabBarSpace } from './useTabBarSpace';

interface Props {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  /** Rendered flush to the right of the title, e.g. an action or avatar. */
  headerAccessory?: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Content that should sit outside the horizontal gutter (edge-to-edge). */
  bleed?: React.ReactNode;
  /**
   * Hides the back arrow on a screen that could otherwise go back.
   *
   * For the rare screen that must not be left by the obvious route — a step
   * that has to be finished or explicitly cancelled. Nothing uses it yet; it
   * exists so that a future screen does not reach for `headerShown: false`
   * again, which is what caused every pushed screen in this app to have no way
   * back at all.
   */
  hideBack?: boolean;
}

/**
 * Every screen in the app is built from this, which is what makes the
 * product feel like one thing: identical gutters, identical title
 * treatment, identical scroll behaviour, everywhere.
 */
export function Screen({
  children,
  title,
  subtitle,
  scroll = true,
  headerAccessory,
  contentStyle,
  bleed,
  hideBack = false,
}: Props) {
  const { color, space, text, layout } = useTheme();
  const navigation = useNavigation();
  // Not `layout.tabBarHeight`: on Android the tab bar is that plus the system
  // navigation inset, so the bare constant left the last rows of every
  // scrolling screen underneath it. See `useTabBarSpace`.
  const tabBarSpace = useTabBarSpace();

  /**
   * Every pushed screen in this app sets `headerShown: false`, so React
   * Navigation's own back arrow is never drawn — and this component drew a
   * title without one. The result was a screen you could enter and not leave:
   * reported from "Invite a friend", and true of all nine.
   *
   * `canGoBack` rather than a prop on every screen, because a prop is
   * something the next screen can forget.
   *
   * The tab roots are excluded by navigator type, not by `canGoBack`. A bottom
   * tab navigator keeps a history of visited tabs and answers `canGoBack()`
   * with true once you have switched once — so Wallet drew an arrow that
   * jumped sideways to whichever tab you came from. That is not what a back
   * arrow means anywhere else in the app, and it appeared and disappeared
   * depending on route taken, which is worse than either.
   *
   * The Android hardware back button always worked. This is for the people who
   * do not use it, and for iOS, which has none.
   */
  const isTabRoot = navigation.getState()?.type === 'tab';
  const canGoBack = !hideBack && !isTabRoot && navigation.canGoBack();

  // A scrolling screen gets the app's keyboard behaviour for free — several
  // settings screens used to wrap this component in a `KeyboardAvoidingView`
  // of their own, each one repeating the same Android mistake.
  const body = (
    <>
        {title ? (
          <View
            style={[
              styles.header,
              { paddingHorizontal: layout.screenPaddingX, paddingTop: space[4], paddingBottom: space[5] },
            ]}
          >
            {canGoBack ? (
              <Pressable
                onPress={() => navigation.goBack()}
                // Generous, because this is the control people reach for when
                // they are lost, and a 24pt icon is a small target.
                hitSlop={16}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={{ marginRight: space[3], marginTop: space[1] }}
              >
                <Ionicons name="chevron-back" size={26} color={color.textPrimary} />
              </Pressable>
            ) : null}

            <View style={styles.flex}>
              <Text style={[text.titleLg, { color: color.textPrimary }]}>{title}</Text>
              {subtitle ? (
                <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[1] }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {headerAccessory}
          </View>
        ) : null}

        {bleed}

        <View
          style={[
            { paddingHorizontal: layout.screenPaddingX },
            !scroll && styles.flex,
            contentStyle,
          ]}
        >
          {children}
        </View>
    </>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: color.background }]} edges={['top']}>
      {scroll ? (
        <KeyboardAwareScroll contentContainerStyle={{ paddingBottom: tabBarSpace }}>
          {body}
        </KeyboardAwareScroll>
      ) : (
        <View style={styles.flex}>{body}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
});
