import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { availableBiometrics, createBiometricProof, verifyBiometricProof } from './biometricDevice';
jest.mock('expo-secure-store', () => ({
  canUseBiometricAuthentication: jest.fn(), getItemAsync: jest.fn(), setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
}));
jest.mock('expo-local-authentication', () => ({
  supportedAuthenticationTypesAsync: jest.fn(), AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
}));
const secure = jest.mocked(SecureStore);
beforeEach(() => {
  jest.clearAllMocks();
  secure.canUseBiometricAuthentication.mockReturnValue(true);
  secure.getItemAsync.mockResolvedValue('a');
  secure.setItemAsync.mockResolvedValue(undefined);
  jest.mocked(LocalAuthentication.supportedAuthenticationTypesAsync).mockResolvedValue([2]);
});
it('requires a protected read after creation before persisting opt-in, including on iOS', async () => {
  await createBiometricProof('a', 'prompt');
  expect(secure.getItemAsync).toHaveBeenCalledWith('tutak.biometric.proof.v1', expect.objectContaining({
    requireAuthentication: true, keychainAccessible: 6, authenticationPrompt: 'prompt',
  }));
  const write = secure.setItemAsync.mock.calls.findIndex(([key]) => key === 'tutak.biometric.owner.v1');
  expect(write).toBeGreaterThanOrEqual(0);
  expect(secure.setItemAsync.mock.invocationCallOrder[write]).toBeGreaterThan(secure.getItemAsync.mock.invocationCallOrder[0]);
});
it('cannot enroll or unlock with an invalidated biometric key', async () => {
  secure.getItemAsync.mockResolvedValue(null);
  await expect(createBiometricProof('a', 'prompt')).rejects.toThrow();
  expect(secure.setItemAsync).not.toHaveBeenCalledWith('tutak.biometric.owner.v1', expect.anything());
  expect(await verifyBiometricProof('a', 'prompt')).toBe(false);
});
it('does not offer unsupported or weak-only biometric authentication', async () => {
  secure.canUseBiometricAuthentication.mockReturnValue(false);
  expect(await availableBiometrics()).toBeNull();
  expect(LocalAuthentication.supportedAuthenticationTypesAsync).not.toHaveBeenCalled();
});
it('uses the Face ID name only on iOS', async () => {
  const original = Platform.OS;
  try {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    expect(await availableBiometrics()).toBe('face');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    expect(await availableBiometrics()).toBe('biometric');
  } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
});
