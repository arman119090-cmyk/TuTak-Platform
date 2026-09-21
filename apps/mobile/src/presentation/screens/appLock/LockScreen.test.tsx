import React from 'react';
import { Alert, AppState } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LockScreen } from './LockScreen';
import { SetPinScreen } from './SetPinScreen';
import { useAppLockStore } from '../../../data/stores/appLockStore';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts?.count !== undefined ? `${key}:${opts.count}` : key) }),
}));
jest.mock('../../../data/api/authApi', () => ({ authApi: { logout: jest.fn(async () => undefined) } }));
jest.mock('../../../data/stores/appLockStore', () => {
  const state = {
    status: 'locked',
    busy: false,
    biometricsEnabled: false,
    biometricKind: null,
    attemptsLeft: 5,
    unlockWithPin: jest.fn(),
    unlockWithBiometrics: jest.fn(),
    createPin: jest.fn(),
    enableBiometrics: jest.fn(),
  };
  const useAppLockStore = Object.assign(() => state, { getState: () => state, setState: (p: object) => Object.assign(state, p) });
  return { useAppLockStore };
});

const store = () => useAppLockStore.getState();
const type = (digits: string) => {
  for (const d of digits) fireEvent.press(screen.getByTestId(`pin-key-${d}`));
};

beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  useAppLockStore.setState({ status: 'locked', busy: false, biometricsEnabled: false, biometricKind: null, attemptsLeft: 5 });
});

describe('LockScreen', () => {
  it('submits after the fourth digit and shows the attempts left on a wrong code', async () => {
    jest.mocked(store().unlockWithPin).mockResolvedValue('wrong');
    useAppLockStore.setState({ attemptsLeft: 4 });
    render(<LockScreen />);
    type('123');
    expect(store().unlockWithPin).not.toHaveBeenCalled();
    type('4');
    await waitFor(() => expect(store().unlockWithPin).toHaveBeenCalledWith('1234'));
    expect(await screen.findByText('appLock.wrongCode:4')).toBeTruthy();
    expect(screen.getAllByTestId('pin-dot-empty')).toHaveLength(4);
  });

  it('prompts the biometric by itself once, only while active, and offers it on the keypad', async () => {
    jest.mocked(store().unlockWithBiometrics).mockResolvedValue(false);
    useAppLockStore.setState({ biometricsEnabled: true, biometricKind: 'face' });
    AppState.currentState = 'background';
    render(<LockScreen />);
    expect(store().unlockWithBiometrics).not.toHaveBeenCalled();
    await act(async () => {
      AppState.currentState = 'active';
      (AppState as unknown as { emit?: (e: string, s: string) => void }).emit?.('change', 'active');
    });
    fireEvent.press(screen.getByLabelText('appLock.methodFace'));
    await waitFor(() => expect(store().unlockWithBiometrics).toHaveBeenCalled());
  });

  it('warns that the session ended after the last attempt', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.mocked(store().unlockWithPin).mockResolvedValue('signed-out');
    render(<LockScreen />);
    type('0000');
    await waitFor(() => expect(alert).toHaveBeenCalledWith('appLock.tooManyTitle', 'appLock.tooManyBody'));
  });
});

describe('SetPinScreen', () => {
  it('asks twice, refuses a mismatch, and saves a match', async () => {
    jest.mocked(store().createPin).mockResolvedValue(true);
    useAppLockStore.setState({ status: 'setup', biometricKind: null });
    render(<SetPinScreen />);
    expect(screen.getByText('appLock.setupTitle')).toBeTruthy();
    type('1234');
    expect(screen.getByText('appLock.confirmTitle')).toBeTruthy();
    type('1235');
    expect(await screen.findByText('appLock.mismatch')).toBeTruthy();
    expect(store().createPin).not.toHaveBeenCalled();
    expect(screen.getByText('appLock.setupTitle')).toBeTruthy();
    type('1234');
    type('1234');
    await waitFor(() => expect(store().createPin).toHaveBeenCalledWith('1234'));
  });

  it('offers the biometric after saving when the phone has one', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.mocked(store().createPin).mockResolvedValue(true);
    useAppLockStore.setState({ status: 'setup', biometricKind: 'fingerprint' });
    render(<SetPinScreen />);
    type('2468');
    type('2468');
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toBe('appLock.offerTitle');
  });
});
