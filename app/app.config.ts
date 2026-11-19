import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Versioning:
 *  - The marketing version comes from /VERSION (single source of truth for
 *    the app, the server and release tags).
 *  - The build number (Android versionCode / iOS buildNumber) comes from CI
 *    (KITCOUNT_BUILD_NUMBER, derived from the GitHub run number) so every
 *    published build is strictly increasing.
 */
const version = readFileSync(join(__dirname, '..', 'VERSION'), 'utf8').trim();
const buildNumber = Math.max(1, Number.parseInt(process.env.KITCOUNT_BUILD_NUMBER ?? '1', 10) || 1);
const commit = (process.env.KITCOUNT_COMMIT ?? process.env.GITHUB_SHA ?? 'dev').slice(0, 12);

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`VERSION must be MAJOR.MINOR.PATCH, got "${version}"`);
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Kitcount',
  slug: 'kitcount',
  scheme: 'kitcount',
  version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'org.kitcount.app',
    buildNumber: String(buildNumber),
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'Kitcount uses the camera only to scan the enrollment QR code when you add this device to a program.',
    },
  },
  android: {
    package: 'org.kitcount.app',
    versionCode: buildNumber,
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#0F766E',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.READ_CONTACTS',
    ],
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
    output: 'single',
    name: 'Kitcount demo',
    themeColor: '#0F766E',
  },
  plugins: [
    'expo-router',
    // Encrypt the on-device database with SQLCipher.
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-secure-store', { faceIDPermission: false, configureAndroidBackup: true }],
    [
      'expo-camera',
      {
        cameraPermission: 'Kitcount uses the camera only to scan the enrollment QR code when you add this device to a program.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    'expo-sharing',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#F3F7F6',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#0A1513' },
      },
    ],
  ],
  extra: {
    buildNumber: String(buildNumber),
    commit,
  },
});
