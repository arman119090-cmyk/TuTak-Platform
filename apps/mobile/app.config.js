/**
 * Dynamic config, not app.json, so the API target can vary by build profile.
 * `apiBaseUrl` used to be hardcoded to localhost — a build produced this way
 * could never reach anything but a developer's own machine. eas.json sets
 * API_BASE_URL per profile; this file just forwards whatever is in the
 * environment at build time.
 */
/**
 * `eas init` cannot write into a dynamic config — it can only edit app.json —
 * so it prints the project id and leaves placing it to you. Rather than make
 * that a manual edit of this file, the id is read from either the
 * EAS_PROJECT_ID environment variable or an `eas-project.json` next to this
 * file, whichever is present. `apps/mobile/README.md` has the one command
 * that writes it. A project id is not a secret; it is an account-specific
 * value, which is why the repository does not carry one.
 */
function easProjectId() {
  if (process.env.EAS_PROJECT_ID) return process.env.EAS_PROJECT_ID;
  try {
    return require('./eas-project.json').projectId;
  } catch {
    return undefined;
  }
}

module.exports = ({ config }) => ({
  ...config,
  name: 'TuTak',
  slug: 'tutak',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // The app is dark-only. 'automatic' let the OS hand a light system
  // background to anything the app had not painted itself.
  userInterfaceStyle: 'dark',
  scheme: 'tutak',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    // The app's own ground colour, so the splash does not flash a different
    // shade before the first frame renders.
    backgroundColor: '#0A0A0F',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'am.tutak.app',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0A0F',
    },
    package: 'am.tutak.app',
    permissions: ['CAMERA'],
  },
  // The browser target is a convenience for looking at the app on a laptop —
  // it is stated explicitly so a future Expo default cannot silently move the
  // build onto a different bundler than the one the native builds use.
  web: {
    bundler: 'metro',
    output: 'single',
    // Without this every page load logs a 404 for the favicon the browser
    // asks for on its own.
    favicon: './assets/icon.png',
  },
  plugins: [
    [
      'expo-camera',
      {
        cameraPermission: 'TuTak needs camera access to scan QR codes for payments.',
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000/v1',
    appEnv: process.env.APP_ENV ?? 'development',
    eas: {
      projectId: easProjectId(),
    },
  },
});
