import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { restoreSession } from '@tutak/design/web';
import { CheckoutGate } from './CheckoutGate';
import { checkoutApi } from '@/lib/api/checkoutApi';
import { useAuthStore } from '@/lib/stores/authStore';

jest.mock('@tutak/design/web', () => {
  const actual = jest.requireActual('@tutak/design/web');
  return { ...actual, restoreSession: jest.fn() };
});

jest.mock('@/lib/api/checkoutApi', () => {
  const actual = jest.requireActual('@/lib/api/checkoutApi');
  return {
    ...actual,
    checkoutApi: { getCheckout: jest.fn(), submit: jest.fn(), requestLoginOtp: jest.fn(), verifyLoginOtp: jest.fn() },
  };
});

const ORDER_ID = '4f1d9d6c-0000-4000-8000-000000000002';

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CheckoutGate orderId={ORDER_ID} initialLocale="en" />
    </QueryClientProvider>,
  );
}

describe('TuTak Web Checkout — sign-in gate (no guest checkout)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ user: null, accessToken: null, hasRestored: false });
  });

  it('without a TuTak session it asks to sign in and never loads the order', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(false);
    renderGate();
    expect(await screen.findByText('Sign in with your TuTak account')).toBeTruthy();
    expect(screen.getByText(/There is no guest checkout/)).toBeTruthy();
    expect(checkoutApi.getCheckout).not.toHaveBeenCalled();
    expect(checkoutApi.submit).not.toHaveBeenCalled();
  });

  it('signs in with an SMS code, then opens the checkout for that account', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(false);
    (checkoutApi.requestLoginOtp as jest.Mock).mockResolvedValue(undefined);
    (checkoutApi.verifyLoginOtp as jest.Mock).mockResolvedValue({
      user: { id: 'u1', phone: '+37499000000' },
      tokens: { accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: '', refreshTokenExpiresAt: '' },
    });
    (checkoutApi.getCheckout as jest.Mock).mockReturnValue(new Promise(() => undefined));
    renderGate();
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+37499000000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    });
    expect(checkoutApi.requestLoginOtp).toHaveBeenCalledWith('+37499000000');
    fireEvent.change(screen.getByLabelText('Code from SMS'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    const deviceId = useAuthStore.getState().deviceId;
    expect(checkoutApi.verifyLoginOtp).toHaveBeenCalledWith('+37499000000', '123456', deviceId);
    await waitFor(() => expect(screen.getByText('Signed in as +37499000000')).toBeTruthy());
    expect(checkoutApi.getCheckout).toHaveBeenCalledWith(ORDER_ID);
  });

  it('an existing session (httpOnly refresh cookie) goes straight to the checkout', async () => {
    (restoreSession as jest.Mock).mockImplementation(async () => {
      useAuthStore.setState({ user: { id: 'u2', phone: '+37477000000' } as never, accessToken: 'a' });
      return true;
    });
    (checkoutApi.getCheckout as jest.Mock).mockReturnValue(new Promise(() => undefined));
    renderGate();
    await waitFor(() => expect(checkoutApi.getCheckout).toHaveBeenCalledWith(ORDER_ID));
    expect(screen.queryByText('Sign in with your TuTak account')).toBeNull();
  });
});
