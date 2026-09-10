/**
 * The web build of the focus-command trace: nothing at all.
 *
 * The Android version reaches into `react-native/Libraries/…` to wrap
 * `TextInputState`, which is what lets a focus *command* be told apart from a
 * focus *report*. That path exists only in React Native proper. Under
 * `react-native-web` the same specifier resolves to the real React Native
 * package, whose `NativeModules` throws on import — `__fbBatchedBridgeConfig
 * is not set` — and the whole app fails to mount before a single screen
 * renders.
 *
 * The `isDiagnosticBuild()` guard inside the native version does not save it:
 * Metro decides what goes into the bundle by reading the `require` call, not
 * by running it, so the module is pulled in and evaluated no matter what the
 * guard would have answered.
 *
 * Hence a platform file rather than a runtime check. `focusCommandTrace.web.ts`
 * wins over `focusCommandTrace.ts` when the platform is web, so the Android
 * instrument keeps working exactly as it did and the browser never sees the
 * specifier at all.
 *
 * Found by `scripts/mobile-web-serve.sh` and the CI step that drives it: the
 * app served a blank page, and every screen the mobile drive tried to reach
 * reported that the element was not there.
 */

/** No-op. There are no native focus commands in a browser to wrap. */
export function installFocusCommandTrace(): void {}

/** No-op, for parity with the native module's test hook. */
export function resetFocusCommandTrace(): void {}
