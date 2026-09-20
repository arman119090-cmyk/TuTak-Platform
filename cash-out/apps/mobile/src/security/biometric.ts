import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const SECRET_KEY = 'cashout.biometric.deviceSecret';

/**
 * Biometrics on the phone, honestly described.
 *
 * Cash Out stores no biometric data. What it keeps is a random device secret
 * the server issued at enrolment, placed in the platform keystore with
 * `requireAuthentication`, so the OS itself demands Face ID / Touch ID / the
 * Android biometric prompt before releasing it. Authorising a withdrawal
 * means reading that secret (which triggers the prompt) and sending it to the
 * server, which checks its hash against the enrolled device. The server never
 * trusts a bare "the face matched" from this code.
 *
 * Limitation, stated plainly: this proves possession of a device-bound secret
 * released after an OS biometric check. It is not a hardware-attested
 * signature over a server challenge; that needs a native key-pair module the
 * current Expo stack does not ship, and is tracked in docs/SECURITY.md.
 */
export const biometric = {
  async isAvailable(): Promise<boolean> {
    try {
      return (
        (await LocalAuthentication.hasHardwareAsync()) &&
        (await LocalAuthentication.isEnrolledAsync())
      );
    } catch {
      return false;
    }
  },

  async kind(): Promise<'face' | 'fingerprint' | 'other'> {
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
      return 'other';
    } catch {
      return 'other';
    }
  },

  /** Stores the server-issued secret behind the OS biometric check. */
  async enrol(deviceSecret: string, prompt: string): Promise<void> {
    await SecureStore.setItemAsync(SECRET_KEY, deviceSecret, {
      requireAuthentication: true,
      authenticationPrompt: prompt,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async hasEnrolment(): Promise<boolean> {
    try {
      // `getItemAsync` would prompt; the metadata check does not.
      return await SecureStore.canUseBiometricAuthentication();
    } catch {
      return false;
    }
  },

  /**
   * Prompts the OS and returns the secret, or `null` when the driver cancelled
   * or the keystore refused. `null` means "fall back to the PIN", never "skip".
   */
  async unlock(prompt: string): Promise<string | null> {
    try {
      const secret = await SecureStore.getItemAsync(SECRET_KEY, {
        requireAuthentication: true,
        authenticationPrompt: prompt,
      });
      return secret ?? null;
    } catch {
      return null;
    }
  },

  async forget(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(SECRET_KEY);
    } catch {
      // Nothing to forget.
    }
  },
};
