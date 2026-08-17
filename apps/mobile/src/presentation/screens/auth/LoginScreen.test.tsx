import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LoginScreen } from './LoginScreen';
import { authApi } from '../../../data/api/authApi';

/**
 * Item 3 / GitHub issue #28: a normal new customer's only path to
 * registration is OTP-first (`OtpRegisterScreen`) — phone verified before
 * any session exists. `RegisterScreen` (password-first, a usable session
 * the moment the form submits, no phone verification at all) used to be
 * where this same link went. This proves the link now points at the
 * OTP-first screen and never at the password-first one.
 */

jest.mock('../../../data/api/authApi', () => ({
  authApi: {
    isDemoDeployment: jest.fn().mockResolvedValue(false),
    login: jest.fn(),
    demoSession: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

function renderScreen(navigate: jest.Mock) {
  return render(
    <ThemeProvider>
      <LoginScreen
        navigation={{ navigate, replace: jest.fn() } as never}
        route={{ key: 'Login', name: 'Login' } as never}
      />
    </ThemeProvider>,
  );
}

describe('LoginScreen', () => {
  beforeEach(() => {
    (authApi.isDemoDeployment as jest.Mock).mockClear();
  });

  it('sends a new customer to OTP-first registration, not the password form', () => {
    const navigate = jest.fn();
    const { getByText } = renderScreen(navigate);

    fireEvent.press(getByText('auth.register'));

    expect(navigate).toHaveBeenCalledWith('OtpRegister');
    expect(navigate).not.toHaveBeenCalledWith('Register');
  });
});
