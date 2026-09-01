// Metro configuration for running Expo inside the pnpm workspace.
//
// Without this, Metro infers the monorepo root as its server root (so
// `/index.bundle` 404s) and cannot reliably resolve pnpm's symlinked
// node_modules. Pinning projectRoot + watchFolders + nodeModulesPaths makes
// `expo start` and `expo export` behave identically to a standalone app
// while still picking up changes in packages/shared-types and packages/i18n.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits to the shared packages hot-reload.
config.watchFolders = [workspaceRoot];

// Resolve from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// NOTE: do NOT set `resolver.disableHierarchicalLookup = true` here. That is
// the usual npm/yarn-workspace recommendation, but it breaks pnpm: packages
// in pnpm's symlinked store resolve their own dependencies from a nested
// node_modules alongside them (e.g. expo -> expo-modules-core), which is only
// reachable via the upward directory walk that flag disables.

// Previously wrapped with `@sentry/react-native/metro`'s `withSentryConfig`
// to attach a debug id to the bundle, so an uploaded source map could later
// be matched back to it. Removed: that serializer wraps whatever custom
// serializer is already on the config, which here is Expo Router's — and at
// @sentry/react-native@7.11.0 that combination throws `Cannot read
// properties of undefined (reading 'match')` in `determineDebugIdFromBundleSource`
// (reproduced locally with a plain `expo export --platform android`, and on
// EAS: every attempted Android build failed in the "Bundle JavaScript" phase
// before Gradle ever ran). The debug id has nothing to match anyway — every
// build profile in this repo (see eas.json) uploads no source maps, the same
// deliberate policy apps/admin and apps/partner already carry in
// next.config.ts. Sentry error/crash reporting itself is unaffected: this
// only removed the Metro-time bundle annotation, not the runtime SDK.
module.exports = config;
