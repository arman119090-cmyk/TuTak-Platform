// No Reanimated: the animations this app needs (a sheet sliding up, a spinner,
// a number ticking) are all served by React Native's own Animated API, and
// Reanimated's worklets runtime currently disagrees with expo-modules-core
// about which version of react-native-worklets to use. One fewer native
// dependency is also one fewer thing to break an EAS build.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
