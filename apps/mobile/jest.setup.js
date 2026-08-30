/* global jest */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * NetInfo talks to a native module, and there is none in a Jest process: its
 * own reachability poller then dereferences an undefined state and throws
 * inside the library, which surfaces as every test that renders `App`
 * failing for a reason that has nothing to do with what it was testing.
 *
 * The package ships the mock for exactly this; using it keeps the real module
 * in place everywhere else, including the network-state tests, which mock it
 * themselves to drive specific transitions.
 */
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

/**
 * `expo-image` is a native view; under Jest it has no native side and its own
 * module initialisation throws before a single component renders. Rendering
 * React Native's `Image` in its place keeps these tests about the screens
 * they are testing — what they assert (a logo is shown, a fallback replaces
 * it on error) is identical in both, and the part that differs, the disk
 * cache, is not something a JS test could observe anyway.
 */
jest.mock('expo-image', () => {
  const { Image } = require('react-native');
  return { __esModule: true, Image };
});
