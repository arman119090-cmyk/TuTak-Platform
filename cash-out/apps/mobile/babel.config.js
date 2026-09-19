// `react-native-worklets/plugin` must stay last: Reanimated arrives through
// expo-router's animations, and without the plugin its worklets compile to
// ordinary functions that then crash on the UI thread.
//
// Versions are pinned to the pair React Native 0.87 actually supports —
// reanimated 4.7 with worklets 0.13. `pnpm install` prints one peer warning
// from expo-modules-core 57.0.18, which still declares `react-native-worklets`
// as `^0.7 || … || ^0.10`; that range predates SDK 57's own React Native
// version and cannot be satisfied together with a Reanimated that supports
// React Native 0.87. The warning is stale metadata, not a real conflict.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
