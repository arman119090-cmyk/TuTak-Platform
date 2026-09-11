import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AxiosError, AxiosHeaders } from 'axios';
import { OtpRegisterScreen } from './OtpRegisterScreen';

jest.mock('../../../data/api/authApi', () => ({
  authApi: { requestRegistrationOtp: jest.fn(), verifyRegistrationOtp: jest.fn() },
}));
jest.mock('../../../data/stores/authStore', () => ({
  useAuthStore: () => ({ deviceId: 'test-device', setSession: jest.fn() }),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { authApi } = require('../../../data/api/authApi');
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');
/* eslint-enable @typescript-eslint/no-require-imports */

const renderScreen = () =>
  render(
    <ThemeProvider>
      {/* `BackButton` asks the navigator whether it can go back, so the screen
          needs a real navigation context to render at all. */}
      <NavigationContainer>
        <OtpRegisterScreen
          navigation={{ navigate: jest.fn(), replace: jest.fn() } as never}
          route={{ key: 'OtpRegister', name: 'OtpRegister' } as never}
        />
      </NavigationContainer>
    </ThemeProvider>,
  );

/** An error the API answered with, carrying its machine-readable code. */
const apiError = (status: number, code: string, message: string) => {
  const error = new AxiosError(message, 'ERR_BAD_REQUEST');
  error.response = {
    status,
    statusText: '',
    data: { code, message },
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return error;
};

/** A request that never reached the API — a timeout or a sleeping service. */
const timeout = () => new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED');

/**
 * Which field an error is allowed to mark.
 *
 * One error state was being handed to whichever field happened to be last on
 * the step, and on step one that is the **referral code**. "Could not send the
 * verification code" was therefore drawn under the referral field, in the
 * field's own error colour, and read as "your referral code is wrong".
 *
 * It was not a near-miss. `handleSendCode` does not send the referral code at
 * all, and the API treats an unknown referral code as a silent no-op rather
 * than an error, so no failure of this flow has ever been that field's fault.
 * These pin the rule that replaced it: a field is marked only when the API
 * says that field is the problem.
 */
describe('where a registration error is shown', () => {
  beforeEach(() => jest.clearAllMocks());

  const sendCode = () => {
    fireEvent.changeText(screen.getByPlaceholderText('00 000 000'), '77123456');
    fireEvent.press(screen.getByText('auth.sendVerificationCode'));
  };

  /** Code stage -> password stage. Advancing costs no request; see the screen. */
  const enterCode = async (code = '123456') => {
    fireEvent.changeText(await screen.findByPlaceholderText('000000'), code);
    fireEvent.press(screen.getByText('common.next'));
  };

  /** Fills both password fields and submits the one request this flow makes. */
  const createAccount = async (password = 'correct-horse', confirmation = password) => {
    const fields = await screen.findAllByPlaceholderText('••••••••');
    fireEvent.changeText(fields[0], password);
    fireEvent.changeText(fields[1], confirmation);
    fireEvent.press(screen.getByText('auth.registerButton'));
  };

  it('shows a failed send as a form error, never on the referral field', async () => {
    authApi.requestRegistrationOtp.mockRejectedValue(
      apiError(503, 'SERVICE_UNAVAILABLE', 'Verification code delivery is temporarily unavailable.'),
    );
    renderScreen();
    sendCode();

    const message = 'Verification code delivery is temporarily unavailable.';
    // The banner carries the alert role; a field's error text does not. Before
    // this fix `getByRole('alert')` found nothing, because the only place the
    // message appeared was under the referral field.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    // And it appears once: not on the banner *and* on a field.
    expect(screen.getAllByText(message)).toHaveLength(1);
    // The referral field is on screen throughout and keeps its own value.
    expect(screen.getByPlaceholderText('TT-XXXXXXXX').props.value).toBe('');
  });

  it('shows a timeout as a form error too — nothing typed was ever judged', async () => {
    authApi.requestRegistrationOtp.mockRejectedValue(timeout());
    renderScreen();
    sendCode();

    // A timeout carries no API body, so the screen falls back to its own
    // wording — which is a *form* message, not a field one.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('auth.sendCodeFailed'));
    expect(screen.getAllByText('auth.sendCodeFailed')).toHaveLength(1);
  });

  it('marks the code field when the API rejects the code', async () => {
    authApi.requestRegistrationOtp.mockResolvedValue({ success: true });
    authApi.verifyRegistrationOtp.mockRejectedValue(
      apiError(401, 'UNAUTHORIZED', 'Code is invalid or has expired'),
    );
    renderScreen();
    sendCode();

    await enterCode();
    await createAccount();

    await waitFor(() => expect(screen.getByText('Code is invalid or has expired')).toBeTruthy());
    // On the field, not in the banner: this one really is the code's fault.
    expect(screen.queryByRole('alert')).toBeNull();
    // And the form went back to the stage that can fix it.
    expect(screen.getByPlaceholderText('000000')).toBeTruthy();
  });

  it('does not mark the code field when the verify request never arrived', async () => {
    authApi.requestRegistrationOtp.mockResolvedValue({ success: true });
    authApi.verifyRegistrationOtp.mockRejectedValue(timeout());
    renderScreen();
    sendCode();

    await enterCode();
    await createAccount();

    // Shown, but as a form error rather than as the code being wrong.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('auth.confirmCodeFailed'),
    );
    expect(screen.getAllByText('auth.confirmCodeFailed')).toHaveLength(1);
    // A network failure judged nothing, so the password the customer already
    // typed is still there to submit again.
    expect(screen.getAllByPlaceholderText('••••••••')).toHaveLength(2);
  });

  it('keeps a rejected password on the stage that owns it', async () => {
    authApi.requestRegistrationOtp.mockResolvedValue({ success: true });
    // Exactly what the API's global ValidationPipe answers when the body is
    // the wrong shape: a 400 whose `message` is an array. The only field this
    // form can send in a shape the API refuses is the password — it is the one
    // input with a bound the screen does not enforce.
    const validationError = apiError(400, 'Bad Request', 'x');
    (validationError.response as { data: unknown }).data = {
      code: 'Bad Request',
      message: ['password must be shorter than or equal to 128 characters'],
    };
    authApi.verifyRegistrationOtp.mockRejectedValue(validationError);

    renderScreen();
    sendCode();
    await enterCode();
    await createAccount();

    const text = 'password must be shorter than or equal to 128 characters';
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
    // The password stage is still on screen: the code was never the problem,
    // and sending the customer back to re-enter it explains nothing.
    expect(screen.getAllByPlaceholderText('••••••••')).toHaveLength(2);
    expect(screen.queryByPlaceholderText('000000')).toBeNull();
  });

  it('keeps the password when a bad code sends the form back a stage', async () => {
    authApi.requestRegistrationOtp.mockResolvedValue({ success: true });
    authApi.verifyRegistrationOtp.mockRejectedValue(
      apiError(401, 'UNAUTHORIZED', 'Code is invalid or has expired'),
    );
    renderScreen();
    sendCode();
    await enterCode('111111');
    await createAccount('correct-horse');

    // Back on the code stage…
    await waitFor(() => expect(screen.getByText('Code is invalid or has expired')).toBeTruthy());
    // …and forward again without retyping anything but the code.
    await enterCode('222222');
    fireEvent.press(screen.getByText('auth.registerButton'));

    await waitFor(() => expect(authApi.verifyRegistrationOtp).toHaveBeenCalledTimes(2));
    expect(authApi.verifyRegistrationOtp).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: '222222', password: 'correct-horse' }),
    );
  });
});
