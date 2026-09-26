import { useContext } from 'react';
import { Platform } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { layout } from '@tutak/design';

/**
 * How much room a screen must leave at its bottom so its last row is not
 * underneath the tab bar.
 *
 * ## The bug this exists for
 *
 * This is `MainTabNavigator`'s own height expression, and it has to stay that
 * way — read `tabBarStyle.height` there and this next to it:
 *
 *     height: Platform.OS === 'android' ? layout.tabBarHeight + insets.bottom
 *                                       : layout.tabBarHeight
 *
 * Screens were reserving the bare `layout.tabBarHeight` instead. Expo enforces
 * edge-to-edge on Android from SDK 54, so the app draws behind the system
 * navigation bar and the tab bar grows by that inset to stay clear of it —
 * but the space reserved for it did not grow with it. The shortfall is exactly
 * `insets.bottom`: on a phone with a gesture pill or a Samsung navigation bar,
 * the last 20 to 48 points of every scrolling screen sat under the tab bar.
 *
 * It is least visible on an emulator, which often reports no inset at all, and
 * worst on the handsets people actually own. That is why it survived.
 *
 * ## Why the context rather than `useSafeAreaInsets`
 *
 * `useSafeAreaInsets` throws when no `SafeAreaProvider` is above it. Every
 * screen in this app now calls this, so that would turn one missing provider
 * into a crash on every screen at once — in an app whose recurring failure
 * mode is a blank screen with nothing to read. Reading the context directly
 * gives `null` in that case, and no inset is a safe answer: it reserves the
 * same room the app reserved before this function existed.
 */
export function useTabBarSpace(): number {
  const insets = useContext(SafeAreaInsetsContext);
  const bottom = Platform.OS === 'android' ? (insets?.bottom ?? 0) : 0;
  return layout.tabBarHeight + bottom;
}
