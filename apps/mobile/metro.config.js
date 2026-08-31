// Metro configuration for running Expo inside the pnpm workspace.
//
// Without this, Metro infers the monorepo root as its server root (so
// `/index.bundle` 404s) and cannot reliably resolve pnpm's symlinked
// node_modules. Pinning projectRoot + watchFolders + nodeModulesPaths makes
// `expo start` and `expo export` behave identically to a standalone app
// while still picking up changes in packages/shared-types and packages/i18n.
const { getDefaultConfig } = require('expo/metro-config');
const { withSentryConfig } = require('@sentry/react-native/metro');
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

// Layered on top of the monorepo config above rather than built via
// `getSentryExpoConfig` (which calls `getDefaultConfig` itself and would
// duplicate/clash with the watchFolders and resolver overrides this file
// already needs for pnpm). This only adds the Metro serializer that attaches
// debug ids to the bundle so an uploaded source map can be matched back to
// it — it does not change what gets bundled or how it resolves modules.
//
// Applied only when a source map will actually be uploaded, because on this
// SDK it otherwise breaks the release bundle outright:
//
//   expo export:embed --eager --platform android --dev false
//   TypeError: Cannot read properties of undefined (reading 'match')
//     at determineDebugIdFromBundleSource (@sentry/react-native/dist/js/tools/utils.js:37)
//     at sentryMetroSerializer.js:63
//
// `extractSerializerResult` in @sentry/react-native 7.11.0 reads `.code` off
// the wrapped serializer's awaited result; Expo SDK 57's serializer returns a
// shape that does not carry one, so `code` is undefined and the debug-id scan
// throws. Version 8.x handles it — but SDK 57's own
// `expo/bundledNativeModules.json` pins `~7.11.0`, and `sdkVersions.test.ts`
// fails any dependency that drifts from that pin, so upgrading is a decision
// about leaving the SDK's tested set rather than a one-line bump.
//
// The serializer's whole job is attaching a debug id so an *uploaded* source
// map can be matched to the bundle. Uploading is what `SENTRY_AUTH_TOKEN`
// authorises, and the builds that do not set it — the staging APK among them,
// which also ships with no DSN at all, so Sentry never initialises in it —
// gain nothing from the serializer while being unable to build with it.
//
// This is a mitigation and not a fix: set `SENTRY_AUTH_TOKEN` for a release
// build that should carry readable stack traces and the crash comes back.
// Whoever does that first will need the version question settled.
const willUploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

module.exports = willUploadSourceMaps ? withSentryConfig(config) : config;
