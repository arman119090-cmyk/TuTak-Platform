import * as SecureStore from 'expo-secure-store';

/**
 * Where the app keeps its tokens — the native implementation.
 *
 * There is a sibling `secureStorage.web.ts`. Metro picks the `.web` file when
 * it bundles for a browser and this one everywhere else, so the two platforms
 * never share a line of code and `expo-secure-store` never reaches the web
 * bundle at all. That matters: `expo-secure-store` is a native module with no
 * web implementation, and calling it in a browser does not fail politely — it
 * throws `getValueWithKeyAsync is not a function` from inside the first
 * `await`, which happens during hydration, before the first screen renders.
 * The app showed its logo and stopped there.
 *
 * A runtime `Platform.OS === 'web'` branch would have fixed the symptom while
 * still shipping the native module to the browser. Splitting the file removes
 * it from the graph instead.
 *
 * On iOS and Android this is the Keychain and the Keystore: storage the OS
 * encrypts, backed by hardware on most devices, unreadable by other apps.
 * That is where a refresh token belongs, and it is the platform the product
 * actually ships on. Read the web file for what is given up there.
 */

export async function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
