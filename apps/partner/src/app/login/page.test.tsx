import { act, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from './page';
import { acceptInvitation, authApi } from '@/lib/api/authApi';

/**
 * The password field had no visibility toggle at all — a real login failure
 * during staging verification traced back to a typo nobody could see. This
 * covers just the toggle itself, not the login request (`authApi`/router
 * ceremony that would need for a full submit flow).
 */

const mockPush = jest.fn();
const mockSetSession = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api/authApi', () => ({
  authApi: { login: jest.fn() },
  acceptInvitation: jest.fn(),
}));

jest.mock('@/lib/stores/authStore', () => ({
  PARTNER_ROLES: ['PARTNER_OWNER', 'PARTNER_MANAGER', 'PARTNER_STAFF'],
  useAuthStore: () => ({ deviceId: 'test-device', setSession: mockSetSession }),
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
      screen.getByText('Cannot reach the API. This is a deployment configuration issue, not a password error.'),
    ).toBeTruthy();
  });
});

const session = (roles: string[]) => ({
  user: { id: 'u-1', phone: '+37491234567', roles },
  tokens: { accessToken: `access-${roles.join('-') || 'none'}`, refreshToken: 'r' },
});

describe('LoginPage phone number', () => {
  const login = authApi.login as jest.Mock;

  beforeEach(() => {
    login.mockReset();
    mockPush.mockReset();
    mockSetSession.mockReset();
  });

  it('sends a number typed with spaces, as the placeholder shows it, in the form the API accepts', async () => {
    login.mockResolvedValue(session(['PARTNER_OWNER']));
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('+374 00 000 000'), {
      target: { value: '+374 91 23 45 67' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Sign in'));
    });
    expect(login).toHaveBeenCalledWith('+37491234567', 'pw', 'test-device');
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('says the number is wrong instead of blaming the network', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('+374 00 000 000'), {
      target: { value: '+374 91 23' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Sign in'));
    });
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByText('Enter an Armenian mobile number: +374 and 8 digits.')).toBeTruthy();
  });
});

/**
 * The invited person's half of a staff invitation had no screen at all: the
 * code arrived by SMS and only somebody who could call the API could use it.
 */
describe('LoginPage invitation acceptance', () => {
  const login = authApi.login as jest.Mock;
  const accept = acceptInvitation as jest.Mock;

  beforeEach(() => {
    login.mockReset();
    accept.mockReset();
    mockPush.mockReset();
    mockSetSession.mockReset();
  });

  async function signInWithoutRole() {
    login.mockResolvedValueOnce(session([]));
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('+374 00 000 000'), {
      target: { value: '+37491234567' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Sign in'));
    });
  }

  it('offers the invitation code to an account that belongs to no business, and stores no session', async () => {
    await signInWithoutRole();
    expect(screen.getByText('Invitation code')).toBeTruthy();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('accepts the code with the new sign-in token, then signs in again to pick the role up', async () => {
    await signInWithoutRole();
    accept.mockResolvedValue({ partnerId: 'p-1', role: 'PARTNER_STAFF', employeeCode: 'EMP-001', branchIds: [] });
    login.mockResolvedValueOnce(session(['PARTNER_STAFF']));
    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '  tok_abc  ' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Accept invitation'));
    });
    expect(accept).toHaveBeenCalledWith('tok_abc', 'access-none');
    expect(login).toHaveBeenCalledTimes(2);
    expect(mockSetSession).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['PARTNER_STAFF'] }),
      expect.anything(),
    );
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('explains a refused code without signing anybody in', async () => {
    await signInWithoutRole();
    accept.mockRejectedValue({ response: { status: 400 } });
    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: 'wrong' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Accept invitation'));
    });
    expect(screen.getByText(/This invitation is not valid/)).toBeTruthy();
    expect(login).toHaveBeenCalledTimes(1);
    expect(mockSetSession).not.toHaveBeenCalled();
  });
});
