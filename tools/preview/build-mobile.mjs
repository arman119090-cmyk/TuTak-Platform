/**
 * Bundles the mobile preview harness with esbuild, aliasing react-native to
 * react-native-web and swapping the four native-only Expo modules for
 * preview stubs. Application code is untouched.
 */
import * as esbuild from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const stubs = join(here, 'mobile', 'stubs');

await esbuild.build({
  entryPoints: [join(here, 'mobile', 'entry.tsx')],
  outfile: join(here, 'mobile', 'bundle.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  jsx: 'automatic',
  // `.jpg`/`.jpeg` added alongside the pre-existing `.png`/`.ttf` for the v2
  // Home hero (`docs/design/assets/tutak-home-hero-parrot-v2.jpg`,
  // `BalanceCard.tsx`) — the first JPEG `require()`d from application code;
  // everything else here is unchanged.
  loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.ttf': 'dataurl' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  alias: {
    // `apps/mobile` pins its own React (matching the Expo SDK) separately
    // from this tool's own devDependency on React for react-dom/
    // react-native-web. Left unaliased, esbuild bundles both copies, and any
    // component that calls a hook — starting with
    // `react-native-safe-area-context`'s own provider — throws
    // "Cannot read properties of null (reading 'useContext')" against
    // whichever copy it did not get its context from. Forcing every import
    // of `react`/`react-dom` in the whole graph to this one copy is what
    // keeps it to a single React tree.
    react: join(root, 'node_modules', 'react'),
    'react-dom': join(root, 'node_modules', 'react-dom'),
    'react-native': 'react-native-web',
    'expo-secure-store': join(stubs, 'expo-secure-store.js'),
    'expo-localization': join(stubs, 'expo-localization.js'),
    'expo-constants': join(stubs, 'expo-constants.js'),
    'expo-camera': join(stubs, 'expo-camera.jsx'),
    'expo-status-bar': join(stubs, 'expo-status-bar.js'),
    // Screens that read navigation from context rather than from props throw
    // without a navigator above them, and a throwing screen photographs as a
    // blank page. See the stub for the full reasoning.
    '@react-navigation/native': join(stubs, 'react-navigation-native.js'),
    'node:async_hooks': join(stubs, 'async-hooks.js'),
    async_hooks: join(stubs, 'async-hooks.js'),
    '@tutak/design': join(root, 'packages', 'design', 'src', 'index.ts'),
    '@tutak/i18n': join(root, 'packages', 'i18n', 'src', 'index.ts'),
    '@tutak/shared-types': join(root, 'packages', 'shared-types', 'src', 'index.ts'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    __DEV__: 'false',
    global: 'window',
  },
  // Several React Native packages touch `process` at runtime rather than
  // only through process.env, which esbuild's define cannot rewrite.
  banner: {
    js: `window.global = window;
window.process = window.process || {
  env: { NODE_ENV: 'production' },
  browser: true,
  platform: 'browser',
  version: '',
  nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
};`,
  },
  nodePaths: [join(root, 'apps', 'mobile', 'node_modules'), join(root, 'node_modules')],
  logLevel: 'info',
});

console.log('bundled → tools/preview/mobile/bundle.js');
