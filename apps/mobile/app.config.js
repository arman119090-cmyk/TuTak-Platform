/**
 * Dynamic config, not app.json, so the API target can vary by build profile.
 * `apiBaseUrl` used to be hardcoded to localhost — a build produced this way
 * could never reach anything but a developer's own machine. eas.json sets
 * API_BASE_URL per profile; this file just forwards whatever is in the
 * environment at build time.
 */
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
      // Filled in by `eas init`; absent until the project is registered with EAS.
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
});
