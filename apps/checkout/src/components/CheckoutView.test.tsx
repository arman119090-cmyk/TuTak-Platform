import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckoutView } from './CheckoutView';
import { checkoutApi } from '@/lib/api/checkoutApi';

jest.mock('@/lib/api/checkoutApi', () => {
  const actual = jest.requireActual('@/lib/api/checkoutApi');
  return { ...actual, checkoutApi: { getCheckout: jest.fn(), submit: jest.fn() } };
});

const ORDER_ID = '4f1d9d6c-0000-4000-8000-000000000001';

function checkoutFixture(overrides: { submittedAt?: string | null; prepayment?: string; terms?: string | null } = {}) {
  return {
    order: {
      id: ORDER_ID,
      orderNumber: 18472,
      totalAmount: '100000.0000',
      submittedAt: overrides.submittedAt ?? null,
      items: [{ id: 'i1', name: 'Brake pads', quantity: 1, totalPrice: '100000.0000' }],
    },
    partner: { id: 'p1', displayName: 'Euro Import' },
    balances: { discountAvailable: '20000.0000', tutakMoney: '30000.0000' },
    limits: { maxDiscountAmount: '100000.0000', prepaymentRequiredAmount: overrides.prepayment ?? '20000.0000', prepaymentCountsFrom: 'TUTAK_MONEY' },
    cancellationTerms: overrides.terms ?? null,
  };
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CheckoutView orderId={ORDER_ID} locale="en" />
    </QueryClientProvider>,
  );
}

describe('TuTak Web Checkout — CheckoutView', () => {
  const getCheckout = checkoutApi.getCheckout as jest.Mock;
  const submit = checkoutApi.submit as jest.Mock;

  beforeEach(() => {
    getCheckout.mockReset();
    submit.mockReset();
  });

  it('shows the order review, the prepayment rule and the disclosed cancellation terms before any confirmation', async () => {
    getCheckout.mockResolvedValue(checkoutFixture({ terms: 'Delivery cost is kept once the courier left' }));
    renderView();
    expect(await screen.findByText(/Euro Import/)).toBeTruthy();
    expect(screen.getByText(/Brake pads/)).toBeTruthy();
    expect(screen.getByText(/paid in advance from your TuTak money/)).toBeTruthy();
    expect(screen.getByText(/discount balance lowers the price but is not a prepayment/)).toBeTruthy();
    expect(screen.getByText(/Delivery cost is kept once the courier left/)).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('Q13: 20 000 green discount alone does not satisfy a 20 000 prepayment — "Confirm order" stays disabled', async () => {
    getCheckout.mockResolvedValue(checkoutFixture());
    renderView();
    fireEvent.change(await screen.findByLabelText('Discount balance'), { target: { value: '20000' } });
    expect(screen.getByTestId('prepayment-short').textContent).toMatch(/20 000/);
    const confirm = screen.getByRole('button', { name: /Confirm order/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('confirms through the shared API with the app’s idempotency key once TuTak money covers the prepayment', async () => {
    getCheckout.mockResolvedValue(checkoutFixture());
    submit.mockResolvedValue({ id: ORDER_ID });
    renderView();
    fireEvent.change(await screen.findByLabelText('Discount balance'), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText('TuTak money'), { target: { value: '20000' } });
    expect(screen.getByTestId('external').textContent).toMatch(/60 000/);
    const confirm = screen.getByRole('button', { name: /Confirm order/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(ORDER_ID, {
      discountAmount: '20000',
      tutakMoneyAmount: '20000',
      idempotencyKey: `checkout-${ORDER_ID}-20000-20000`,
    });
  });

  it('offers "Open in TuTak" as an option, never a requirement', async () => {
    getCheckout.mockResolvedValue(checkoutFixture());
    renderView();
    const link = (await screen.findByText('Open in the TuTak app')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`tutak://checkout/${ORDER_ID}`);
    expect(screen.getByText(/You do not need the app/)).toBeTruthy();
  });

  it('an already-confirmed order shows its state, not a second confirmation', async () => {
    getCheckout.mockResolvedValue(checkoutFixture({ submittedAt: '2026-09-26T10:00:00Z' }));
    renderView();
    expect(await screen.findByTestId('confirmed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm order/ })).toBeNull();
  });

  it('a link that is not the customer’s (or expired) shows the unavailable notice', async () => {
    getCheckout.mockRejectedValue(Object.assign(new Error('not found'), { response: { status: 404 } }));
    renderView();
    expect(await screen.findByText(/This order is not available/)).toBeTruthy();
  });
});
