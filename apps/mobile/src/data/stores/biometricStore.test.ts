import type { AuthenticatedUserDto } from '@tutak/shared-types';
import { useAuthStore } from './authStore';
import { useBiometricStore } from './biometricStore';
import * as device from '../biometrics/biometricDevice';

jest.mock('../biometrics/biometricDevice', () => ({
  availableBiometrics: jest.fn(), readBiometricOwner: jest.fn(),
  createBiometricProof: jest.fn(), verifyBiometricProof: jest.fn(), removeBiometricProof: jest.fn(),
}));
jest.mock('../storage/secureStorage', () => ({
  getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn().mockResolvedValue(undefined),
  deleteItem: jest.fn().mockResolvedValue(undefined),
}));
const mocked = jest.mocked(device);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const state = () => useBiometricStore.getState();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(async () => {
  await useAuthStore.getState().clear();
  await settle();
  jest.clearAllMocks();
  mocked.availableBiometrics.mockResolvedValue('face');
  mocked.readBiometricOwner.mockResolvedValue(null);
  mocked.createBiometricProof.mockResolvedValue(undefined);
  mocked.verifyBiometricProof.mockResolvedValue(true);
  mocked.removeBiometricProof.mockResolvedValue(undefined);
  useAuthStore.setState({ user: { id: 'a' } as AuthenticatedUserDto });
  useBiometricStore.setState({ enabled: false, locked: false, busy: false, kind: null });
});
it('is opt-in: hydration with no preference does not prompt or enroll', async () => {
  await state().hydrate();
  expect(state()).toMatchObject({ enabled: false, locked: false });
  expect(mocked.createBiometricProof).not.toHaveBeenCalled();
  expect(mocked.verifyBiometricProof).not.toHaveBeenCalled();
});
it('enrolls explicitly, locks on background and unlocks only with proof', async () => {
  expect(await state().configure(true, 'prompt')).toBe(true);
  expect(mocked.createBiometricProof).toHaveBeenCalledWith('a', 'prompt');
  state().lock();
  expect(state().locked).toBe(true);
  expect(await state().unlock('prompt')).toBe(true);
  expect(state().locked).toBe(false);
});
it('locks the enrolled account at cold start, but never adopts another account preference', async () => {
  mocked.readBiometricOwner.mockResolvedValue('a');
  await state().hydrate();
  expect(state().locked).toBe(true);
  mocked.readBiometricOwner.mockResolvedValue('b');
  await state().hydrate();
  expect(state()).toMatchObject({ enabled: false, locked: false });
});
it('fails closed on unreadable preference but permits logout', async () => {
  mocked.readBiometricOwner.mockRejectedValueOnce(new Error('keystore unavailable'));
  await state().hydrate();
  expect(state().locked).toBe(true);
  await useAuthStore.getState().clear();
  expect(useAuthStore.getState().user).toBeNull();
  expect(state().enabled).toBe(false);
});
it.each(['rejected', 'cancelled'])('keeps private screens locked when proof is %s', async reason => {
  useBiometricStore.setState({ enabled: true, locked: true });
  if (reason === 'cancelled') mocked.verifyBiometricProof.mockRejectedValueOnce(new Error('cancel'));
  else mocked.verifyBiometricProof.mockResolvedValueOnce(false);
  expect(await state().unlock('prompt')).toBe(false);
  expect(state()).toMatchObject({ locked: true, busy: false });
});
it('does not enable on unsupported device or cancelled enrollment', async () => {
  mocked.availableBiometrics.mockResolvedValueOnce(null);
  expect(await state().configure(true, 'prompt')).toBe(false);
  mocked.createBiometricProof.mockRejectedValueOnce(new Error('cancel'));
  expect(await state().configure(true, 'prompt')).toBe(false);
  expect(state().enabled).toBe(false);
});
it('requires proof before disabling protection', async () => {
  useBiometricStore.setState({ enabled: true });
  mocked.verifyBiometricProof.mockResolvedValueOnce(false);
  expect(await state().configure(false, 'prompt')).toBe(false);
  expect(state().enabled).toBe(true);
  expect(mocked.removeBiometricProof).not.toHaveBeenCalled();
  expect(await state().configure(false, 'prompt')).toBe(true);
  expect(state().enabled).toBe(false);
});
it.each(['logout', 'background'])('discards a late unlock after %s', async reason => {
  const scan = deferred<boolean>();
  mocked.verifyBiometricProof.mockReturnValueOnce(scan.promise);
  useBiometricStore.setState({ enabled: true, locked: true });
  const attempt = state().unlock('prompt');
  expect(await state().unlock('prompt')).toBe(false);
  if (reason === 'logout') {
    await useAuthStore.getState().clear();
    useAuthStore.setState({ user: { id: 'b' } as AuthenticatedUserDto });
    useBiometricStore.setState({ enabled: true, locked: true });
  } else state().lock();
  scan.resolve(true);
  expect(await attempt).toBe(false);
  expect(state().locked).toBe(true);
});
it('removes a late enrollment after logout instead of recreating the old account setting', async () => {
  const enrollment = deferred<void>();
  mocked.createBiometricProof.mockReturnValueOnce(enrollment.promise);
  const attempt = state().configure(true, 'prompt');
  await settle();
  await useAuthStore.getState().clear();
  enrollment.resolve(undefined);
  expect(await attempt).toBe(false);
  await settle();
  expect(state().enabled).toBe(false);
  expect(mocked.removeBiometricProof).toHaveBeenCalled();
});
