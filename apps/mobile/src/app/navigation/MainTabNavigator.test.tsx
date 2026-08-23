import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { layout } from '@tutak/design';

/**
 * `TUTAK_V2_ANDROID_SYSTEM_UI_QA.md`, "Required implementation checks":
 * "Add a regression test that mounts the tab shell with both zero and a
 * non-zero Android bottom inset; verify the rendered bottom-bar
 * dimensions/clearance derive from the inset rather than a fixed device
 * constant." This is that test.
 *
 * `@react-navigation/bottom-tabs` is mocked so the real tab bar never
 * mounts (it needs a `NavigationContainer` and would otherwise pull in
 * every tab screen's own data dependencies) — the mock's `Navigator`
 * captures the `screenOptions` function `MainTabNavigator` builds from
 * `useTheme()`/`useSafeAreaInsets()` on every render, so the test can call
 * it directly and inspect exactly the `tabBarStyle` React Navigation would
 * have received.
 */

let capturedScreenOptions:
  | ((props: { route: { name: string } }) => Record<string, unknown>)
  | undefined;

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({
      screenOptions,
    }: {
      screenOptions: (props: { route: { name: string } }) => Record<string, unknown>;
    }) => {
      capturedScreenOptions = screenOptions;
      return null;
    },
    Screen: () => null,
  }),
}));

let mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => mockInsets };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../theme/ThemeProvider');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MainTabNavigator } = require('./MainTabNavigator');

function renderShell() {
  return render(
    <ThemeProvider>
      <MainTabNavigator />
    </ThemeProvider>,
  );
}

function tabBarStyleFor(bottomInset: number) {
  mockInsets = { top: 0, right: 0, bottom: bottomInset, left: 0 };
  renderShell();
  const options = capturedScreenOptions?.({ route: { name: 'Home' } });
  return options?.tabBarStyle as { height: number; paddingBottom: number };
}

describe('MainTabNavigator — Android bottom safe-area clearance', () => {
  const platformOSDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', platformOSDescriptor);
  });

  afterEach(() => {
    capturedScreenOptions = undefined;
  });

  it('renders exactly the fixed bar height when the device reports zero bottom inset', () => {
    const style = tabBarStyleFor(0);
    expect(style.height).toBe(layout.tabBarHeight);
    // Math.max(20, insets.bottom) — a zero inset still gets the 20px floor.
    // Raised from 12: a real 3-button-nav device reporting ~zero inset still
    // put its own back/home/recent row close enough beneath ours to read as
    // one row (Arman, 2026-08-23).
    expect(style.paddingBottom).toBe(20);
  });

  it('grows by the live inset — three-button nav (small inset)', () => {
    const style = tabBarStyleFor(16);
    expect(style.height).toBe(layout.tabBarHeight + 16);
    // The 20px floor still wins over a 16px live inset that's smaller than it.
    expect(style.paddingBottom).toBe(20);
  });

  it('grows by the live inset — gesture nav (larger inset), not a fixed device constant', () => {
    const style = tabBarStyleFor(34);
    expect(style.height).toBe(layout.tabBarHeight + 34);
    expect(style.paddingBottom).toBe(34);
    // Different from the small-inset case above: proves the bar tracks the
    // *live* measurement rather than converging on one hardcoded number.
    expect(style.height).not.toBe(layout.tabBarHeight + 16);
  });
});
