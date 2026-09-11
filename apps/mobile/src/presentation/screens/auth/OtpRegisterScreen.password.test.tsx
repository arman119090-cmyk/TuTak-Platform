import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OtpRegisterScreen } from './OtpRegisterScreen';

// `mock`-prefixed so Jest allows the factory below to close over it: the
// factory is hoisted above every other statement in this file.
const mockSetSession = jest.fn();

jest.mock('../../../data/api/authApi', () => ({
  authApi: { requestRegistrationOtp: jest.fn(), verifyRegistrationOtp: jest.fn() },
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
 * The business rule this screen exists to satisfy: nobody ends up with an
 * account whose password they do not know.
 *
 * The flow it replaced created the account the moment the code was accepted,
 * signed the customer in, and gave them a random password they had never
 * seen — so the sign-in screen they met next asked for something that did not
 * exist. These pin the three properties that make that impossible now: a
 * password stage exists, no session is created before it, and the password
 * reaches the API.
 */
describe('registration asks for a password before it creates anything', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authApi.requestRegistrationOtp.mockResolvedValue({ success: true });
  });

  const sendCode = () => {
    fireEvent.changeText(screen.getByPlaceholderText('00 000 000'), '77123456');
    fireEvent.press(screen.getByText('auth.sendVerificationCode'));
  };

  const enterCode = async (code = '123456') => {
    fireEvent.changeText(await screen.findByPlaceholderText('000000'), code);
    fireEvent.press(screen.getByText('common.next'));
  };

  const passwordFields = async () => screen.findAllByPlaceholderText('••••••••');

  it('does not create a session when the code alone has been entered', async () => {
    renderScreen();
    sendCode();
    await enterCode();

    // The stage moved on, which is all it may do.
    expect(await screen.findByText('auth.createPasswordTitle')).toBeTruthy();
    // No account, no session: entering a code is not registering.
    expect(authApi.verifyRegistrationOtp).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('refuses to submit until both passwords are filled and equal', async () => {
    renderScreen();
    sendCode();
    await enterCode();
    const [password, confirmation] = await passwordFields();

    // Too short.
    fireEvent.changeText(password, 'short');
    fireEvent.changeText(confirmation, 'short');
    fireEvent.press(screen.getByText('auth.registerButton'));
    expect(authApi.verifyRegistrationOtp).not.toHaveBeenCalled();

    // Long enough, but not the same string.
    fireEvent.changeText(password, 'correct-horse');
    fireEvent.changeText(confirmation, 'correct-house');
    fireEvent.press(screen.getByText('auth.registerButton'));
    expect(authApi.verifyRegistrationOtp).not.toHaveBeenCalled();

    // The mismatch is named while it is being typed rather than left as a
    // dead button — a disabled control cannot explain why it is disabled.
    await waitFor(() => expect(screen.getByText('auth.passwordsDoNotMatch')).toBeTruthy());

    // And it goes away on its own once the two agree.
    fireEvent.changeText(confirmation, 'correct-horse');
    await waitFor(() => expect(screen.queryByText('auth.passwordsDoNotMatch')).toBeNull());
  });

  it('sends the code and the password together, and only then signs in', async () => {
    authApi.verifyRegistrationOtp.mockResolvedValue({
      user: { id: 'u1' },
      tokens: { accessToken: 'a', refreshToken: 'r' },
    });
    renderScreen();
    sendCode();
    await enterCode('654321');
    const [password, confirmation] = await passwordFields();
    fireEvent.changeText(password, 'correct-horse');
    fireEvent.changeText(confirmation, 'correct-horse');
    fireEvent.press(screen.getByText('auth.registerButton'));

    await waitFor(() => expect(authApi.verifyRegistrationOtp).toHaveBeenCalledTimes(1));
    expect(authApi.verifyRegistrationOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+37477123456',
        code: '654321',
        password: 'correct-horse',
        deviceId: 'test-device',
      }),
    );
    // The session is created exactly once, and only after the account exists.
    await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));
  });

  it('can reveal the password, because it is being chosen rather than recalled', async () => {
    renderScreen();
    sendCode();
    await enterCode();
    const [password] = await passwordFields();

    expect(password.props.secureTextEntry).toBe(true);
    // Found by its accessible name rather than by its glyph: the control is an
    // eye, and an icon that cannot be named is a control a screen reader
    // cannot offer.
    // Both fields carry the control; either one moves the pair.
    expect(screen.getAllByLabelText('auth.showPassword')).toHaveLength(2);
    fireEvent.press(screen.getAllByLabelText('auth.showPassword')[1]);
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('••••••••')[0].props.secureTextEntry).toBe(false);
    });
    // Both fields follow the one control — a form that shows one and hides the
    // other cannot be used to compare them.
    expect(screen.getAllByPlaceholderText('••••••••')[1].props.secureTextEntry).toBe(false);

    // And the button renames itself, so the next press is described correctly.
    expect(screen.getAllByLabelText('auth.hidePassword')).toHaveLength(2);
  });
});
