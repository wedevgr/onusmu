import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage adapter for the Supabase auth session, backed by the device
 * keystore (Android Keystore / iOS Keychain) instead of plain AsyncStorage.
 *
 * The keystore limits a single value to roughly 2 KB and a session is larger,
 * so values are split across `<key>.0 … <key>.N-1` with the count in `<key>.n`.
 * Sessions saved by older app versions in AsyncStorage are moved over on
 * first read, so nobody is signed out by the upgrade.
 */

// UTF-16 units per part; stays under the limit even for 3-byte characters.
const PART_SIZE = 600;

// Background recording refreshes the token while the phone is locked.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const countKey = (key: string): string => `${key}.n`;
const partKey = (key: string, index: number): string => `${key}.${index}`;

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  const count = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

async function getItem(key: string): Promise<string | null> {
  try {
    const count = await readCount(key);
    if (count > 0) {
      const parts = await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(partKey(key, i), OPTIONS)),
      );
      return parts.some((p) => p === null) ? null : parts.join('');
    }
  } catch {
    // Keystore entries can become unreadable (e.g. after a device restore): treat as signed out.
    return null;
  }

  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;
  try {
    await setItem(key, legacy);
    await AsyncStorage.removeItem(key);
  } catch {
    // Keep the legacy copy if the move failed; it is retried on the next read.
  }
  return legacy;
}

async function setItem(key: string, value: string): Promise<void> {
  const previous = await readCount(key).catch(() => 0);
  const count = Math.max(1, Math.ceil(value.length / PART_SIZE));
  for (let i = 0; i < count; i += 1) {
    await SecureStore.setItemAsync(
      partKey(key, i),
      value.slice(i * PART_SIZE, (i + 1) * PART_SIZE),
      OPTIONS,
    );
  }
  await SecureStore.setItemAsync(countKey(key), String(count), OPTIONS);
  for (let i = count; i < previous; i += 1) {
    await SecureStore.deleteItemAsync(partKey(key, i), OPTIONS);
  }
}

async function removeItem(key: string): Promise<void> {
  const count = await readCount(key).catch(() => 0);
  await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
  for (let i = 0; i < count; i += 1) {
    await SecureStore.deleteItemAsync(partKey(key, i), OPTIONS);
  }
  await AsyncStorage.removeItem(key);
}

// The keystore does not exist on web; the browser build keeps using AsyncStorage.
export const secureSessionStorage =
  Platform.OS === 'web' ? AsyncStorage : { getItem, setItem, removeItem };
