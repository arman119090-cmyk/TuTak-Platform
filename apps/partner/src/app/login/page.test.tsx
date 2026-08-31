import { act, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from './page';
import { authApi } from '@/lib/api/authApi';

/**
 * The password field had no visibility toggle at all — a real login failure
 * during staging verification traced back to a typo nobody could see. This
 * covers just the toggle itself, not the login request (`authApi`/router
 * ceremony that would need for a full submit flow).
 */

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/api/authApi', () => ({
  authApi: { login: jest.fn() },
}));

jest.mock('@/lib/stores/authStore', () => ({
  PARTNER_ROLES: ['PARTNER_OWNER', 'PARTNER_MANAGER', 'PARTNER_STAFF'],
  useAuthStore: () => ({ deviceId: 'test-device', setSession: jest.fn() }),
}));

describe('LoginPage password visibility', () => {
  it('starts masked and reveals the password on toggle, then re-masks on a second click', () => {
    render(<LoginPage />);

    const password = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    expect(password.type).toBe('password');

    fireEvent.click(screen.getByLabelText('Show password'));
    expect(password.type).toBe('text');

    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(password.type).toBe('password');
  });

  it('keeps whatever the user typed intact across a toggle', () => {
    render(<LoginPage />);

    const password = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'QarBergOwner!123' } });

    fireEvent.click(screen.getByLabelText('Show password'));
    expect(password.value).toBe('QarBergOwner!123');
  });
});

/**
 * A wrong password and an unreachable API (a CORS misconfiguration, in the
 * incident that prompted this) used to render the exact same text. A CORS
 * failure surfaces to axios as a plain Error with no `response` at all —
 * distinct from an actual 401/429 the API answered with.
 */
describe('LoginPage error messages', () => {
  const login = authApi.login as jest.Mock;

  beforeEach(() => {
    login.mockReset();
  });

  async function submit() {
    fireEvent.change(screen.getByPlaceholderText('+374 00 000 000'), {
      target: { value: '+37455501001' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'whatever' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Sign in'));
    });
  }

  it('reports a wrong password distinctly from a network failure', async () => {
    login.mockRejectedValue({ response: { status: 401 } });
    render(<LoginPage />);
    await submit();
    expect(screen.getByText('Incorrect phone number or password.')).toBeTruthy();
  });

  it('reports throttling distinctly from a wrong password', async () => {
    login.mockRejectedValue({ response: { status: 429 } });
    render(<LoginPage />);
    await submit();
    expect(screen.getByText('Too many attempts. Please wait a minute and try again.')).toBeTruthy();
  });

  it('does not blame the password for a CORS/network failure with no response at all', async () => {
    login.mockRejectedValue(new Error('Network Error'));
    render(<LoginPage />);
    await submit();
    expect(
      screen.getByText('Cannot reach the staging API. This is a deployment configuration issue, not a password error.'),
    ).toBeTruthy();
  });
});
