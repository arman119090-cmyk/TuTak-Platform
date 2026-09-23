import { act, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from './page';
import { authApi } from '@/lib/api/authApi';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api/authApi', () => ({
  authApi: { login: jest.fn() },
}));

jest.mock('@/lib/stores/authStore', () => ({
  ADMIN_ROLES: ['SUPER_ADMIN', 'ADMIN'],
  useAuthStore: () => ({ deviceId: 'test-device', setSession: jest.fn() }),
}));

/**
 * The placeholder shows "+374 00 000 000" with spaces; the API accepts only
 * "+374XXXXXXXX". A number typed as shown used to come back as a 400 and be
 * reported as an unreachable API.
 */
describe('Admin LoginPage phone number', () => {
  const login = authApi.login as jest.Mock;

  beforeEach(() => {
    login.mockReset();
    mockPush.mockReset();
  });

  async function submit(phone: string) {
    fireEvent.change(screen.getByPlaceholderText('+374 00 000 000'), { target: { value: phone } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Sign in'));
    });
  }

  it('does not start with somebody else’s number filled in', () => {
    render(<LoginPage />);
    expect((screen.getByPlaceholderText('+374 00 000 000') as HTMLInputElement).value).toBe('+374');
  });

  it('sends a spaced number in the form the API accepts', async () => {
    login.mockResolvedValue({ user: { roles: ['ADMIN'] }, tokens: {} });
    render(<LoginPage />);
    await submit('+374 55 50 10 01');
    expect(login).toHaveBeenCalledWith('+37455501001', 'pw', 'test-device');
  });

  it('says the number is wrong instead of blaming the network', async () => {
    render(<LoginPage />);
    await submit('+374 55');
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByText('Enter an Armenian mobile number: +374 and 8 digits.')).toBeTruthy();
  });
});
