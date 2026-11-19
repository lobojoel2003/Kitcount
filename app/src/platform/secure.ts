import * as SecureStore from 'expo-secure-store';

/**
 * Secrets live in the platform keystore (iOS Keychain / Android Keystore),
 * bound to this device and only readable while it is unlocked. They are
 * never included in backups.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'org.kitcount.app',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secure = {
  get: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS),
  del: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};

export const SECURE_PERSISTENT = true;
