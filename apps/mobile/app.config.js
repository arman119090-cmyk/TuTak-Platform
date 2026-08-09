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

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

/**
 * Where this build will send its requests — and a refusal to produce a build
 * that cannot send them anywhere.
 *
 * A development build is different from every other kind: it is installed
 * next to a Metro server on the same network, and `localhost` is rewritten at
 * runtime to the address the bundle arrived from (see
 * `src/data/api/apiBaseUrl.ts`). So localhost is correct there and only
 * there.
 *
 * A preview or production build has no Metro server. Nothing rewrites the
 * address, so `localhost` means the phone itself and every request fails
 * against a device with no API on it. The app installs, opens, looks right
 * and does nothing — which costs a cloud build, an install, and the time of
 * whoever was being shown it before anyone works out why.
 *
 * Failing here instead is much cheaper. EAS evaluates this file before it
 * queues the build, so a missing API_BASE_URL is a message in the first
 * seconds rather than a dead APK twenty minutes later.
 */
function apiBaseUrl() {
  const appEnv = process.env.APP_ENV ?? 'development';
  const configured = process.env.API_BASE_URL;

  if (appEnv === 'development') {
    return configured ?? 'http://localhost:4000/v1';
  }

  if (!configured) {
    throw new Error(
      `API_BASE_URL is not set and APP_ENV is "${appEnv}". A ${appEnv} build has no Metro ` +
        'server to borrow an address from, so it would ship pointing at the phone itself and ' +
        'every request would fail.\n\n' +
        'Set it for this build profile, e.g.\n' +
        '  eas env:create --name API_BASE_URL --value https://your-api.example.com/v1 ' +
        '--environment preview\n\n' +
        'If you deployed the demonstration described in docs/INVESTOR_DEMO_RU.md, the value is ' +
        'the API service URL Render assigned, with /v1 on the end.',
    );
  }

  if (LOCAL_HOST.test(configured)) {
    throw new Error(
      `API_BASE_URL is "${configured}" and APP_ENV is "${appEnv}". On a phone, localhost is the ` +
        'phone — this build could only ever talk to itself. Point it at a reachable address.',
    );
  }

  return configured;
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
        // `expo-camera` can record video, so its plugin adds RECORD_AUDIO on
        // Android by default. This app points the camera at a QR code and
        // reads it; it has never recorded anything. A loyalty app asking for
        // the microphone is a reason to decline the install, and a question
        // at store review that has no good answer.
        recordAudioAndroid: false,
      },
    ],
  ],
  extra: {
    apiBaseUrl: apiBaseUrl(),
    appEnv: process.env.APP_ENV ?? 'development',
    eas: {
      projectId: easProjectId(),
    },
  },
});
