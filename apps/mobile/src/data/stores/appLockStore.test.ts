import type { AuthenticatedUserDto } from '@tutak/shared-types';
import { useAuthStore } from './authStore';
import { MAX_ATTEMPTS, useAppLockStore } from './appLockStore';
import * as storage from '../storage/secureStorage';
import * as device from '../biometrics/biometricDevice';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_alg: string, data: string) =>
    require('node:crypto').createHash('sha256').update(data).digest('hex'),
  ),
  getRandomBytes: jest.fn((n: number) => Uint8Array.from(require('node:crypto').randomBytes(n))),
}));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../biometrics/biometricDevice', () => ({
  availableBiometrics: jest.fn(),
  readBiometricOwner: jest.fn(),
  createBiometricProof: jest.fn(),
  verifyBiometricProof: jest.fn(),
  removeBiometricProof: jest.fn(),
}));
// An in-mockMemory keystore, so what the store writes is what it later reads.
const mockMemory = new Map<string, string>();
jest.mock('../storage/secureStorage', () => ({
  getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockMemory.set(key, value);
  }),
  deleteItem: jest.fn(async (key: string) => {
    mockMemory.delete(key);
  }),
}));

const mockedDevice = jest.mocked(device);
const mockedStorage = jest.mocked(storage);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const lock = () => useAppLockStore.getState();
const userA = { id: 'user-a' } as AuthenticatedUserDto;
const userB = { id: 'user-b' } as AuthenticatedUserDto;

async function signIn(user: AuthenticatedUserDto) {
  await useAuthStore.getState().setSession(user, {
    accessToken: 'a',
    refreshToken: 'r',
    accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
    refreshTokenExpiresAt: '2030-02-01T00:00:00.000Z',
  });
  await settle();
  await settle();
}

beforeEach(async () => {
  mockMemory.clear();
  jest.clearAllMocks();
  mockedDevice.availableBiometrics.mockResolvedValue('face');
  mockedDevice.readBiometricOwner.mockResolvedValue(null);
  mockedDevice.createBiometricProof.mockResolvedValue(undefined);
  mockedDevice.verifyBiometricProof.mockResolvedValue(true);
  mockedDevice.removeBiometricProof.mockResolvedValue(undefined);
  await useAuthStore.getState().clear();
  await settle();
  useAppLockStore.setState({ status: 'idle', busy: false, biometricsEnabled: false, biometricKind: null, attemptsLeft: MAX_ATTEMPTS });
});

describe('appLockStore', () => {
  it('is idle without a session and asks for a code after a sign-in', async () => {
    await lock().hydrate();
    expect(lock().status).toBe('idle');
    await signIn(userA);
    expect(lock().status).toBe('setup');
  });

  it('saves a code for the signed-in account, unlocks, and never stores the digits', async () => {
    await signIn(userA);
    expect(await lock().createPin('1234')).toBe(true);
    expect(lock().status).toBe('unlocked');
    expect(mockMemory.get('tutak.appLock.owner.v1')).toBe('user-a');
    expect(mockMemory.get('tutak.appLock.pin.v1')).not.toContain('1234');
    expect(await lock().createPin('12')).toBe(false);
  });

  it('locks on demand and opens only with the right code', async () => {
    await signIn(userA);
    await lock().createPin('1234');
    lock().lock();
    expect(lock().status).toBe('locked');
    expect(await lock().unlockWithPin('0000')).toBe('wrong');
    expect(lock().attemptsLeft).toBe(MAX_ATTEMPTS - 1);
    expect(lock().status).toBe('locked');
    expect(await lock().unlockWithPin('1234')).toBe('ok');
    expect(lock().status).toBe('unlocked');
    expect(lock().attemptsLeft).toBe(MAX_ATTEMPTS);
    expect(mockMemory.get('tutak.appLock.attempts.v1')).toBe('0');
  });

  it('signs the session out on the last wrong attempt and wipes the code', async () => {
    await signIn(userA);
    await lock().createPin('1234');
    lock().lock();
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) expect(await lock().unlockWithPin('9999')).toBe('wrong');
    expect(lock().attemptsLeft).toBe(1);
    expect(await lock().unlockWithPin('9999')).toBe('signed-out');
    expect(useAuthStore.getState().user).toBeNull();
    await settle();
    await settle();
    expect(lock().status).toBe('idle');
    expect(mockMemory.has('tutak.appLock.pin.v1')).toBe(false);
    expect(mockedDevice.removeBiometricProof).toHaveBeenCalled();
  });

  it('counts a wrong code in Settings against the same limit and survives a restart', async () => {
    await signIn(userA);
    await lock().createPin('1234');
    expect(await lock().verifyPin('0000')).toBe('wrong');
    expect(lock().attemptsLeft).toBe(MAX_ATTEMPTS - 1);
    expect(lock().status).toBe('unlocked');
    // Cold start: the counter comes back from storage, not from mockMemory.
    useAppLockStore.setState({ status: 'idle', attemptsLeft: MAX_ATTEMPTS });
    await lock().hydrate();
    expect(lock().status).toBe('locked');
    expect(lock().attemptsLeft).toBe(MAX_ATTEMPTS - 1);
  });

  it('at cold start: locked when this account has a code, setup when it does not', async () => {
    await signIn(userA);
    await lock().createPin('4321');
    useAppLockStore.setState({ status: 'idle' });
    await lock().hydrate();
    expect(lock().status).toBe('locked');
    // The same phone, a different account: the stored code is not theirs.
    useAuthStore.setState({ user: userB });
    useAppLockStore.setState({ status: 'idle' });
    await lock().hydrate();
    expect(lock().status).toBe('setup');
    expect(await lock().unlockWithPin('4321')).toBe('not-locked');
  });

  it('remembers the biometric choice per account and unlocks with a proof', async () => {
    await signIn(userA);
    await lock().createPin('1234');
    expect(await lock().enableBiometrics('prompt')).toBe(true);
    expect(mockedDevice.createBiometricProof).toHaveBeenCalledWith('user-a', 'prompt');
    lock().lock();
    expect(await lock().unlockWithBiometrics('prompt')).toBe(true);
    expect(lock().status).toBe('unlocked');
    // Cold start reads the choice back from the biometric owner marker.
    mockedDevice.readBiometricOwner.mockResolvedValue('user-a');
    useAppLockStore.setState({ status: 'idle', biometricsEnabled: false });
    await lock().hydrate();
    expect(lock()).toMatchObject({ status: 'locked', biometricsEnabled: true, biometricKind: 'face' });
  });

  it('keeps the lock when the scan is refused, cancelled, or answers after a background', async () => {
    await signIn(userA);
    await lock().createPin('1234');
    await lock().enableBiometrics('prompt');
    lock().lock();
    mockedDevice.verifyBiometricProof.mockResolvedValueOnce(false);
    expect(await lock().unlockWithBiometrics('prompt')).toBe(false);
    mockedDevice.verifyBiometricProof.mockRejectedValueOnce(new Error('cancel'));
    expect(await lock().unlockWithBiometrics('prompt')).toBe(false);
    let accept!: (v: boolean) => void;
    mockedDevice.verifyBiometricProof.mockReturnValueOnce(new Promise<boolean>((r) => { accept = r; }));
    const late = lock().unlockWithBiometrics('prompt');
    lock().lock(); // the app went to the background mid-scan
    accept(true);
    expect(await late).toBe(false);
    expect(lock().status).toBe('locked');
  });

  it('does not offer biometrics on a phone without a strong one', async () => {
    mockedDevice.availableBiometrics.mockResolvedValue(null);
    await signIn(userA);
    await lock().createPin('1234');
    expect(lock().biometricKind).toBeNull();
    expect(await lock().enableBiometrics('prompt')).toBe(false);
    expect(lock().biometricsEnabled).toBe(false);
  });

  it('a sign-out wipes the code and the proof, and a late code write for the old session is refused', async () => {
    await signIn(userA);
    await lock().createPin('1234');
    // Block the keystore, ask for a new code, sign out while it is queued.
    let release!: () => void;
    mockedStorage.setItem.mockImplementationOnce(() => new Promise((r) => { release = () => r(undefined); }));
    const pending = lock().createPin('5678');
    await settle();
    await useAuthStore.getState().clear();
    release();
    expect(await pending).toBe(false);
    await settle();
    await settle();
    expect(lock().status).toBe('idle');
    expect(mockMemory.has('tutak.appLock.pin.v1')).toBe(false);
    expect(mockMemory.has('tutak.appLock.owner.v1')).toBe(false);
  });
});
