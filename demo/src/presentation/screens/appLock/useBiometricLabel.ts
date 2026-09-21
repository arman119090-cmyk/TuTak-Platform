import { useTranslation } from 'react-i18next';
import type { BiometricKind } from '../../../data/biometrics/biometricDevice';

/** "Face ID", "Fingerprint" or the generic word, in the interface language. */
export function useBiometricLabel(kind: BiometricKind | null): string {
  const { t } = useTranslation();
  if (kind === 'face') return t('appLock.methodFace');
  if (kind === 'fingerprint') return t('appLock.methodFingerprint');
  return t('appLock.methodBiometric');
}
