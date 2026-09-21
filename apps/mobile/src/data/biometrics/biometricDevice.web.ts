export type BiometricKind = 'face' | 'fingerprint' | 'biometric';
export const availableBiometrics = async (): Promise<BiometricKind | null> => null;
export const readBiometricOwner = async (): Promise<string | null> => null;
export const createBiometricProof = async (_owner: string, _prompt: string): Promise<void> => {
  throw new Error('Native biometrics are unavailable in a browser');
};
export const verifyBiometricProof = async (_owner: string, _prompt: string): Promise<boolean> => false;
export const removeBiometricProof = async (): Promise<void> => undefined;
