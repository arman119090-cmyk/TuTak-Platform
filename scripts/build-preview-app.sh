#!/usr/bin/env bash
#
# Generates `preview/` — the standalone Expo app.
#
# ## Why this exists
#
# `apps/mobile` lives in a pnpm workspace and depends on three workspace
# packages by `workspace:*`. Downloading the repository as a ZIP and running
# `npx expo start` inside it cannot work: that protocol means nothing to npm,
# there is no lockfile resolution for it, and Metro has to be told where the
# sibling packages are. Every one of those is a wall for somebody who wants to
# look at the interface on their phone.
#
# So `preview/` is an ordinary Expo app: plain dependencies, no workspace, no
# monorepo, no server. `npm install && npx expo start` and it runs.
#
# ## Why it is generated rather than written
#
# A hand-written second copy of an app is a copy that diverges, and the
# divergence is discovered by the person the copy was made for. This script
# copies; `preview/` is committed so that a ZIP download works; and CI
# regenerates and diffs, so a change to the app that is not reflected in the
# preview fails the build instead of being found on a phone.
#
# Run it after changing anything under apps/mobile or packages/{design,i18n,
# shared-types}:
#
#   scripts/build-preview-app.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/preview"

# Everything except `node_modules` and the lockfile. Neither is generated
# here: node_modules is expensive to rebuild, and package-lock.json is what
# makes the install reproducible for whoever downloads the ZIP — resolving
# ranges afresh on their machine is exactly the class of surprise this whole
# directory exists to avoid. Regenerate the lock with `npm install` in
# `preview/` after the dependency list changes.
if [ -d "$OUT" ]; then
  find "$OUT" -mindepth 1 -maxdepth 1 \
    ! -name node_modules ! -name package-lock.json -exec rm -rf {} +
fi
mkdir -p "$OUT/vendor"

# ── The app itself ─────────────────────────────────────────────────────────
# Source, entry point and assets, verbatim. No edits: an edit here is a
# divergence, and the aliasing below is what makes edits unnecessary.
cp -R "$ROOT/apps/mobile/src" "$OUT/src"
cp -R "$ROOT/apps/mobile/assets" "$OUT/assets"
cp "$ROOT/apps/mobile/App.tsx" "$OUT/App.tsx"
cp "$ROOT/apps/mobile/index.ts" "$OUT/index.ts"

# Tests are not part of a preview and they would drag in jest-expo, which is
# a large install for something nobody runs from here.
find "$OUT/src" -name '*.test.ts' -delete
find "$OUT/src" -name '*.test.tsx' -delete

# ── The workspace packages, vendored ───────────────────────────────────────
# Imports stay `@tutak/design` and so on; metro.config.js maps them to these
# folders. Rewriting the imports instead would mean the copied source differs
# from the original, which is the one thing this script must not do.
for pkg in design i18n shared-types; do
  cp -R "$ROOT/packages/$pkg/src" "$OUT/vendor/$pkg"
done

# ── package.json ───────────────────────────────────────────────────────────
# Dependencies come from apps/mobile with the three `workspace:*` entries
# removed, plus whatever the vendored packages need at runtime. Generated from
# the real file so a version bump in the app cannot leave the preview behind.
node - "$ROOT" "$OUT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, out] = process.argv.slice(2);

const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/mobile/package.json'), 'utf8'));

const deps = Object.fromEntries(
  Object.entries(app.dependencies).filter(([name]) => !name.startsWith('@tutak/')),
);

// The vendored packages bring their own runtime dependencies. Only i18n has
// any; design and shared-types are plain TypeScript with no imports.
for (const pkg of ['design', 'i18n', 'shared-types']) {
  const file = path.join(root, 'packages', pkg, 'package.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, range] of Object.entries(meta.dependencies ?? {})) {
    if (!name.startsWith('@tutak/')) deps[name] ??= range;
  }
}

fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'tutak-preview',
      version: app.version,
      private: true,
      main: 'index.ts',
      scripts: {
        start: 'expo start',
        android: 'expo start --android',
        ios: 'expo start --ios',
        web: 'expo start --web',
      },
      dependencies: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))),
      devDependencies: {
        '@babel/core': app.devDependencies['@babel/core'],
        '@types/react': app.devDependencies['@types/react'],
        'babel-preset-expo': app.devDependencies['babel-preset-expo'],
        typescript: app.devDependencies.typescript,
      },
    },
    null,
    2,
  ) + '\n',
);
NODE

# ── Static config ──────────────────────────────────────────────────────────
# app.json, not app.config.js: the dynamic config in apps/mobile refuses to
# build without an API address, which is correct there and exactly wrong here.
node - "$OUT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [out] = process.argv.slice(2);

fs.writeFileSync(
  path.join(out, 'app.json'),
  JSON.stringify(
    {
      expo: {
        name: 'TuTak',
        slug: 'tutak-preview',
        version: '0.1.0',
        orientation: 'portrait',
        icon: './assets/icon.png',
        userInterfaceStyle: 'dark',
        scheme: 'tutakpreview',
        splash: {
          image: './assets/splash-icon.png',
          resizeMode: 'contain',
          backgroundColor: '#0A0A0F',
        },
        assetBundlePatterns: ['**/*'],
        ios: { supportsTablet: false, bundleIdentifier: 'am.tutak.preview' },
        android: {
          adaptiveIcon: {
            foregroundImage: './assets/adaptive-icon.png',
            backgroundColor: '#0A0A0F',
          },
          package: 'am.tutak.preview',
          permissions: ['CAMERA'],
        },
        web: { bundler: 'metro', output: 'single', favicon: './assets/icon.png' },
        plugins: [
          [
            'expo-camera',
            {
              cameraPermission: 'TuTak needs camera access to scan QR codes for payments.',
              recordAudioAndroid: false,
            },
          ],
        ],
        extra: {
          // The whole reason this app needs nothing installed. Read by
          // src/data/api/httpClient.ts.
          useMocks: true,
          // Present but never reached: with `useMocks` the transport is
          // replaced before a request leaves the app.
          apiBaseUrl: 'http://offline.invalid/v1',
          appEnv: 'preview-mock',
        },
      },
    },
    null,
    2,
  ) + '\n',
);
NODE

# ── Metro: where `@tutak/*` lives now ──────────────────────────────────────
cat > "$OUT/metro.config.js" <<'JS'
// Ordinary single-project Metro config, plus the three aliases that let the
// copied source keep importing `@tutak/design` and friends without being
// edited. See scripts/build-preview-app.sh.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  '@tutak/design': path.resolve(__dirname, 'vendor/design'),
  '@tutak/i18n': path.resolve(__dirname, 'vendor/i18n'),
  '@tutak/shared-types': path.resolve(__dirname, 'vendor/shared-types'),
};

module.exports = config;
JS

cat > "$OUT/babel.config.js" <<'JS'
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
JS

cat > "$OUT/tsconfig.json" <<'JSON'
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@tutak/design": ["vendor/design"],
      "@tutak/i18n": ["vendor/i18n"],
      "@tutak/shared-types": ["vendor/shared-types"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
JSON

# The instructions the person downloading the ZIP reads first. Kept beside
# this script rather than inside `preview/`, because everything inside
# `preview/` is deleted and rewritten on every run.
cp "$ROOT/scripts/preview-README.md" "$OUT/README.md"

cat > "$OUT/.gitignore" <<'TXT'
node_modules/
.expo/
dist/
TXT

echo "preview/ regenerated from apps/mobile + packages/{design,i18n,shared-types}"
