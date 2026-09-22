import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OtpRegisterScreen } from './OtpRegisterScreen';

const mockSetSession = jest.fn();

jest.mock('../../../data/api/authApi', () => ({
  authApi: { requestRegistrationOtp: jest.fn(), verifyRegistrationOtp: jest.fn() },
}));
jest.mock('./useRegistrationConsents', () => ({
  // The legal package is not published in this fixture, so registration asks
  // nothing extra — exactly what these tests were written against.
  useRegistrationConsents: () => ({
    required: [],
    accepted: {},
    setAccepted: jest.fn(),
    satisfied: true,
    language: 'ru',
    payload: null,
  }),
}));
jest.mock('../../../data/stores/authStore', () => ({
  useAuthStore: () => ({ deviceId: 'test-device', setSession: mockSetSession }),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { authApi } = require('../../../data/api/authApi');
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');
/* eslint-enable @typescript-eslint/no-require-imports */

const renderScreen = () =>
  render(
    <ThemeProvider>
      <NavigationContainer>
        <OtpRegisterScreen
          navigation={{ navigate: jest.fn(), replace: jest.fn() } as never}
          route={{ key: 'OtpRegister', name: 'OtpRegister' } as never}
        />
      </NavigationContainer>
    </ThemeProvider>,
  );

/**
 * Asking a customer their name, and letting them decline.
 *
 * `POST /auth/register/verify-otp` has accepted `firstName` and `lastName`
 * since it was written, and this screen never sent them. The server does not
 * fail on that — it substitutes, writing `firstName` "Customer" and putting
 * the phone number where the surname goes. So every account registered by SMS
 * carried a placeholder name, which is what put "Привет, Customer" on the
 * home screen for everybody.
 *
 * These pin both halves of the fix: a name reaches the API when one is given,
 * and skipping sends nothing rather than sending blanks. The second half is
 * the one that could regress invisibly — an empty string is not "no name" to
 * a server that validates a present field as one to fifty characters, it is a
 * rejected registration.
 */
describe('the optional name step in registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authApi.requestRegistrationOtp.mockResolvedValue({ success: true });
    authApi.verifyRegistrationOtp.mockResolvedValue({
      user: { id: 'u1' },
      tokens: { accessToken: 'a', refreshToken: 'r' },
    });
  });

  const reachNameStep = async () => {
    fireEvent.changeText(screen.getByPlaceholderText('00 000 000'), '77123456');
    fireEvent.press(screen.getByText('auth.sendVerificationCode'));
    fireEvent.changeText(await screen.findByPlaceholderText('000000'), '123456');
    fireEvent.press(screen.getByText('common.next'));
  };

  const completeWithPassword = async () => {
    const fields = await screen.findAllByPlaceholderText('••••••••');
    fireEvent.changeText(fields[0]!, 'sup3rsecret');
    fireEvent.changeText(fields[1]!, 'sup3rsecret');
    fireEvent.press(screen.getByText('auth.registerButton'));
  };

  it('asks for a name after the code, before the password', async () => {
    renderScreen();
    await reachNameStep();

    expect(await screen.findByText('nameStep.skip')).toBeTruthy();
    // The password stage has not been reached yet.
    expect(screen.queryByText('auth.registerButton')).toBeNull();
  });

  it('sends the name it was given', async () => {
    renderScreen();
    await reachNameStep();

    fireEvent.changeText(await screen.findByLabelText('editProfile.firstName'), 'Արման');
    fireEvent.changeText(screen.getByLabelText('editProfile.lastName'), 'Սարգսյան');
    fireEvent.press(screen.getByText('nameStep.continue'));

    await completeWithPassword();

    await waitFor(() =>
      expect(authApi.verifyRegistrationOtp).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Արման', lastName: 'Սարգսյան' }),
      ),
    );
  });

  it('sends no name at all when the step is skipped', async () => {
    renderScreen();
    await reachNameStep();

    fireEvent.press(await screen.findByText('nameStep.skip'));
    await completeWithPassword();

    await waitFor(() => expect(authApi.verifyRegistrationOtp).toHaveBeenCalled());
    const sent = authApi.verifyRegistrationOtp.mock.calls[0]![0];
    // Absent, not empty. An empty string is a rejected registration, not a
    // way to say "no name given".
    expect(sent).not.toHaveProperty('firstName');
    expect(sent).not.toHaveProperty('lastName');
  });

  it('forgets a name typed and then skipped', async () => {
    renderScreen();
    await reachNameStep();

    fireEvent.changeText(await screen.findByLabelText('editProfile.firstName'), 'Արման');
    fireEvent.press(screen.getByText('nameStep.skip'));
    await completeWithPassword();

    await waitFor(() => expect(authApi.verifyRegistrationOtp).toHaveBeenCalled());
    expect(authApi.verifyRegistrationOtp.mock.calls[0]![0]).not.toHaveProperty('firstName');
  });
});
