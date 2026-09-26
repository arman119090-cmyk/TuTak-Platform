import React from 'react';
import { Platform, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { layout } from '@tutak/design';
import { useTabBarSpace } from './useTabBarSpace';

/**
 * The space a screen reserves and the height the tab bar draws are one
 * measurement. They were two, and they disagreed by exactly the Android
 * system inset — so the bottom of every scrolling screen was underneath the
 * bar on any device with a gesture pill or a navigation bar.
 *
 * These assertions are written against `MainTabNavigator`'s own height
 * expression. If that changes, one of these fails, which is the point.
 */

function Probe() {
  return <Text>{String(useTabBarSpace())}</Text>;
}

function asPlatform(os: 'ios' | 'android', run: () => void) {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  }
}

const withInsets = (bottom: number | null) =>
  render(
    bottom === null ? (
      <Probe />
    ) : (
      <SafeAreaInsetsContext.Provider value={{ top: 24, right: 0, bottom, left: 0 }}>
        <Probe />
      </SafeAreaInsetsContext.Provider>
    ),
  );

describe('useTabBarSpace', () => {
  it('reserves the bar plus the system inset on Android', () => {
    // A gesture pill. Reserving only `tabBarHeight` here is the bug: 48
    // points of the screen would be behind the bar.
    asPlatform('android', () => {
      withInsets(48);
      expect(screen.getByText(String(layout.tabBarHeight + 48))).toBeTruthy();
    });
  });

  it('reserves exactly the bar on Android when the device reports no inset', () => {
    // Matches `MainTabNavigator`, which draws a bar of exactly this height
    // for a zero inset — the 20pt floor there is padding inside the bar, not
    // extra height, so reserving more would leave a visible dead strip.
    asPlatform('android', () => {
      withInsets(0);
      expect(screen.getByText(String(layout.tabBarHeight))).toBeTruthy();
    });
  });

  it('ignores the inset on iOS, where the bar does not grow by it', () => {
    asPlatform('ios', () => {
      withInsets(34);
      expect(screen.getByText(String(layout.tabBarHeight))).toBeTruthy();
    });
  });

  it('does not throw when no SafeAreaProvider is above it', () => {
    // `useSafeAreaInsets` throws in this case. Every screen calls this, so
    // that would turn one missing provider into a blank app rather than one
    // slightly wrong padding.
    asPlatform('android', () => {
      expect(() => withInsets(null)).not.toThrow();
      expect(screen.getByText(String(layout.tabBarHeight))).toBeTruthy();
    });
  });
});
