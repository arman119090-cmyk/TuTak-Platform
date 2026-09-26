// Ordinary single-project Metro config, plus the aliases that let the
// copied source keep importing `@tutak/design` and friends without being
// edited. See scripts/build-demo-app.sh.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  '@tutak/design': path.resolve(__dirname, 'vendor/design'),
  '@tutak/i18n': path.resolve(__dirname, 'vendor/i18n'),
  '@tutak/shared-types': path.resolve(__dirname, 'vendor/shared-types'),
  '@tutak/observability': path.resolve(__dirname, 'vendor/observability'),
};

module.exports = config;
