/**
 * Deliberately *not* `/// <reference types="expo/types" />`.
 *
 * Expo 57 ships `expo/types/react-native-web.d.ts`, which augments the
 * `react-native` module with `interface ViewStyle { … }` to add the web-only
 * style properties. That was correct when React Native declared `ViewStyle` as
 * an interface. React Native 0.87 generates its types from Flow and declares
 * `ViewStyle` as a *type alias*, so the augmentation does not merge with it —
 * it shadows it. The result is a `ViewStyle` containing only the web
 * properties, which makes `{ marginTop: 8 }` a type error in every file in the
 * app.
 *
 * This app does not target react-native-web, does not import CSS modules and
 * does not use `require.context`, so nothing in `expo/types` is needed here.
 * Once Expo's web typings are updated for the generated React Native types,
 * this file can go back to referencing them.
 *
 * Verified against expo 57.0.24 / react-native 0.87.1 / typescript 5.9.
 */

/** Public environment variables, inlined by Metro at build time. */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_API_BASE_URL?: string;
  }
}
