import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const OWNER = 'tutak.biometric.owner.v1';
const PROOF = 'tutak.biometric.proof.v1';
const options: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  keychainService: 'tutak.biometric.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export type BiometricKind = 'face' | 'fingerprint' | 'biometric';

export async function availableBiometrics(): Promise<BiometricKind | null> {
  // SecureStore requires an enrolled strong biometric on Android. Ordinary
  // camera face unlock must not be advertised as equivalent to Face ID.
  if (!SecureStore.canUseBiometricAuthentication()) return null;
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return Platform.OS === 'ios' && types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ? 'face'
    : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) ? 'fingerprint' : 'biometric';
}

// Do not swallow preference read errors: unreadable does not mean opted out.
export const readBiometricOwner = () => SecureStore.getItemAsync(OWNER);

export async function verifyBiometricProof(owner: string, prompt: string): Promise<boolean> {
  // The OS invalidates this entry when the enrolled biometric set changes.
  return (await SecureStore.getItemAsync(PROOF, { ...options, authenticationPrompt: prompt })) === owner;
}
export async function createBiometricProof(owner: string, prompt: string): Promise<void> {
  await SecureStore.setItemAsync(PROOF, owner, { ...options, authenticationPrompt: prompt });
  // iOS does not authenticate creation. A read proves consent with a scan.
  if (!(await verifyBiometricProof(owner, prompt))) throw new Error('Biometric verification failed');
  await SecureStore.setItemAsync(OWNER, owner);
}
export async function removeBiometricProof(): Promise<void> {
  // A partial removal retains the fail-closed marker.
  await SecureStore.deleteItemAsync(PROOF, options);
  await SecureStore.deleteItemAsync(OWNER);
}
