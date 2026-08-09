import bundledNativeModules from 'expo/bundledNativeModules.json';
import packageJson from '../package.json';

/**
 * Every native package must be on the version this Expo SDK was tested with.
 *
 * This is not tidiness. `react-native-gesture-handler` sat a whole major
 * version ahead of what SDK 57 pins, imported for its side effect on the first
 * line of `App.tsx` and used nowhere else, and `react` was three patches off a
 * version Expo pins *exactly* because React Native's renderer is built against
 * one specific React. The APK compiled, installed, opened — and then flickered
 * and refused to accept typing on a real phone.
 *
 * `expo-doctor` says all of this. It says it on the EAS build server, in the
 * middle of a log nobody reads, as a warning that does not fail the build. The
 * first person to find out was the one holding the phone.
 *
 * So it is a test. A version that drifts from the SDK now fails in CI, which
 * is the only place a warning of this kind gets acted on.
 */
describe('Expo SDK version alignment', () => {
  const declared: Record<string, string> = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const pinned = bundledNativeModules as Record<string, string>;

  const drift = Object.entries(declared)
    .filter(([name, version]) => pinned[name] && pinned[name] !== version)
    .map(([name, version]) => `${name}: declared ${version}, SDK pins ${pinned[name]}`);

  it('declares every SDK package at the version the SDK pins', () => {
    // Listed rather than counted, so a failure names what to change.
    expect(drift).toEqual([]);
  });

  it('keeps react and react-test-renderer on the same version', () => {
    // A renderer built against a different React than the one running is a
    // source of rendering faults that look like anything but a version
    // mismatch.
    expect(declared['react-test-renderer']).toBe(declared.react);
  });
});
