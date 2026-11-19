// Expo config plugin: sign Android release builds with an upload key taken
// from environment variables (set from GitHub Actions secrets). Without them,
// release builds fall back to the debug key so CI can still produce an
// installable APK for testing.
//
//   KITCOUNT_UPLOAD_STORE_FILE      absolute path to the .jks/.keystore
//   KITCOUNT_UPLOAD_STORE_PASSWORD
//   KITCOUNT_UPLOAD_KEY_ALIAS
//   KITCOUNT_UPLOAD_KEY_PASSWORD
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'KITCOUNT_UPLOAD_STORE_FILE';

const RELEASE_CONFIG = `
        release {
            if (System.getenv('KITCOUNT_UPLOAD_STORE_FILE')) {
                storeFile file(System.getenv('KITCOUNT_UPLOAD_STORE_FILE'))
                storePassword System.getenv('KITCOUNT_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('KITCOUNT_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('KITCOUNT_UPLOAD_KEY_PASSWORD')
            }
        }`;

function applySigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  if (!/signingConfigs \{/.test(gradle) || !/buildTypes \{[\s\S]*?release \{/.test(gradle)) {
    throw new Error('withReleaseSigning: unexpected android/app/build.gradle layout');
  }
  let out = gradle.replace(/signingConfigs \{/, `signingConfigs {${RELEASE_CONFIG}`);
  // Point the release build type at the upload key when it is configured.
  out = out.replace(
    /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
    `$1signingConfig System.getenv('${MARKER}') ? signingConfigs.release : signingConfigs.debug`,
  );
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') throw new Error('withReleaseSigning: only Groovy build.gradle is supported');
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applySigning = applySigning;
