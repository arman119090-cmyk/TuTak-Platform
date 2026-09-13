import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import ChangePasswordPage from './page';
import { passwordApi } from '@/lib/api/passwordApi';
import { useAuthStore } from '@/lib/stores/authStore';

/**
 * The screen that unlocks a seeded administrator.
 *
 * A seeded or admin-reset account carries `mustChangePassword`, and
 * `PasswordRotationGuard` then refuses every endpoint except this one. Until
 * this page existed the operator signed in successfully and met nothing but
 * 403s, with no way to call the one endpoint that would have fixed it.
 */

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/lib/api/passwordApi', () => ({ passwordApi: { change: jest.fn() } }));

const adminUser = (overrides: Partial<AuthenticatedUserDto> = {}): AuthenticatedUserDto => ({
  id: 'admin-1',
  phone: '+37400000000',
  email: null,
  firstName: 'Super',
  lastName: 'Admin',
  roles: [Role.SUPER_ADMIN],
  partnerScopes: {},
  locale: 'hy',
  isPhoneVerified: true,
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
  mustChangePassword: true,
  ...overrides,
});

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    (passwordApi.change as jest.Mock).mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({ user: adminUser() });
  });

  it('explains why nothing else opens when the change is forced', () => {
    render(<ChangePasswordPage />);
    expect(screen.getByText(/temporary password/i)).toBeTruthy();
  });

  it('refuses to submit until the two new passwords match and are long enough', () => {
    render(<ChangePasswordPage />);
    const submit = screen.getByRole('button', { name: /change password/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'seeded-one' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'short' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'long-enough-1' } });
    fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'different-one' } });
    expect(screen.getByText(/do not match/i)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('changes the password and sends the operator back to sign in', async () => {
    render(<ChangePasswordPage />);
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'seeded-one' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'long-enough-1' } });
    fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'long-enough-1' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() =>
      expect(passwordApi.change).toHaveBeenCalledWith('seeded-one', 'long-enough-1'),
    );
    // The session in hand still carries the old flag; a fresh sign-in is the
    // honest way to get one that does not.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('says plainly when the current password is wrong', async () => {
    (passwordApi.change as jest.Mock).mockRejectedValue({ response: { status: 401 } });
    render(<ChangePasswordPage />);
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'long-enough-1' } });
    fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'long-enough-1' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await screen.findByText(/not the current password/i);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
