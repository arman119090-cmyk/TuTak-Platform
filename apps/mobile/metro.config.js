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
module.exports = config;
