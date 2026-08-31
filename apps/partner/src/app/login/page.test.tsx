import { fireEvent, render, screen } from '@testing-library/react';
import LoginPage from './page';

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
