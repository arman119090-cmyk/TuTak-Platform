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

/**
 * A read that fails is "no session", not a crash.
 *
 * The Keystore is not merely a map that always answers. An entry written
 * before an OS upgrade, or restored onto a different handset from a backup,
 * can no longer be decrypted, and `getItemAsync` throws rather than returning
 * null. That throw arrives during hydration — before the first screen — and
 * the app stops on its splash with the logo showing and no way forward, not
 * even to log out.
 *
 * The web adapter has been defended against exactly this since the browser
 * build hit it. The native one had not been, on the platform the product
 * actually ships to.
 *
 * Degrading to null puts the person on the login screen, where signing in
 * writes a fresh value over the unreadable one. They lose a session; they do
 * not lose the app.
 */
export async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

/**
 * Writes and deletes still throw, deliberately.
 *
 * A swallowed write would let a login look successful and then vanish on the
 * next launch, with nothing anywhere saying why; a swallowed delete would
 * leave a refresh token on a phone whose owner pressed "log out". Both are
 * called from screens that can report a failure to the person in front of
 * them, which hydration cannot.
 */
export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
