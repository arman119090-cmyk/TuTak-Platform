import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RefundsPage from './page';
import { financeApi, type PaymentRow, type RefundResult } from '@/lib/api/financeApi';
import { partnersApi } from '@/lib/api/partnersApi';

/**
 * The refund screen, attacked the way the network actually fails.
 *
 * `httpClient` gives up after fifteen seconds. A refund that commits on the
 * server at sixteen — a cold instance, a slow ledger transaction, a proxy
 * that drops the connection — reaches the operator as
 * "timeout of 15000ms exceeded". Nothing on that screen distinguishes it from
 * a refusal, and the only reasonable thing to do with a refund that appears
 * to have failed is to try it again.
 *
 * Everything the server grew to survive that (`AUDIT_FINANCIAL_2026-08.md`,
 * F-9 and F-10) matches on the idempotency key. This file exists to prove the
 * second attempt carries the first attempt's key, because until it does, all
 * of that protection is unreachable from the screen where refunds are made.
 */

jest.mock('@/lib/api/financeApi', () => ({
  financeApi: {
    searchPayments: jest.fn(),
    refund: jest.fn(),
  },
}));

jest.mock('@/lib/api/partnersApi', () => ({
  partnersApi: { list: jest.fn(async () => []) },
}));

const mockedFinance = financeApi as jest.Mocked<typeof financeApi>;
const mockedPartners = partnersApi as jest.Mocked<typeof partnersApi>;

const payment: PaymentRow = {
  id: 'payment-1',
  amount: '1000.00',
  refundedAmount: '0.00',
  status: 'CAPTURED',
  createdAt: '2026-08-09T10:00:00.000Z',
  partner: { displayName: 'Coffee Bar' },
  user: { firstName: 'Ani', lastName: 'Sargsyan', phone: '+37455123456' },
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RefundsPage />
    </QueryClientProvider>,
  );
}

/** Opens the refund form for the seeded payment and fills in a reason. */
async function openRefundForm() {
  const open = await screen.findByRole('button', { name: /Refund Ani Sargsyan/i });
  fireEvent.click(open);

  const reason = await screen.findByPlaceholderText('Goods returned');
  fireEvent.change(reason, { target: { value: 'Goods returned' } });
}

/** The one button that submits, as opposed to the row buttons that open the form. */
const submitButton = () =>
  screen.getAllByRole('button').find((b) => b.textContent === 'Refund' && !b.getAttribute('aria-label'))!;

describe('RefundsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPartners.list.mockResolvedValue([]);
    mockedFinance.searchPayments.mockResolvedValue([payment]);
  });

  it('retries a timed-out refund with the key the first attempt used', async () => {
    mockedFinance.refund
      .mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'))
      .mockResolvedValueOnce({
        refundId: 'refund-1',
        amount: '1000.00',
        totalRefunded: '1000.00',
        bonusClawedBack: '0',
      });

    renderPage();
    await openRefundForm();

    fireEvent.click(submitButton());
    await screen.findByText('timeout of 15000ms exceeded');

    // The operator, who has no way to know the money already moved, tries again.
    fireEvent.click(submitButton());
    await waitFor(() => expect(mockedFinance.refund).toHaveBeenCalledTimes(2));

    const [, , firstKey] = mockedFinance.refund.mock.calls[0]!;
    const [, , secondKey] = mockedFinance.refund.mock.calls[1]!;

    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });

  it('does not reuse a key once the amount has been changed', async () => {
    // The mirror-image mistake. A key held across a changed amount would have
    // the server answer a 200 refund with the result of the 1000 one, and the
    // screen would report money moved that never did.
    mockedFinance.refund.mockRejectedValue(new Error('declined'));

    renderPage();
    await openRefundForm();

    fireEvent.click(submitButton());
    await waitFor(() => expect(mockedFinance.refund).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('1000.00'), { target: { value: '200' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(mockedFinance.refund).toHaveBeenCalledTimes(2));

    const [, , firstKey] = mockedFinance.refund.mock.calls[0]!;
    const [, , secondKey, secondAmount] = mockedFinance.refund.mock.calls[1]!;

    expect(secondAmount).toBe('200');
    expect(secondKey).not.toBe(firstKey);
  });

  it('keeps the key when only the reason is reworded', async () => {
    // A note is not an authorisation. An operator who improves the wording
    // after a timeout is still talking about the same refund.
    mockedFinance.refund.mockRejectedValue(new Error('timeout of 15000ms exceeded'));

    renderPage();
    await openRefundForm();

    fireEvent.click(submitButton());
    await waitFor(() => expect(mockedFinance.refund).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('Goods returned'), {
      target: { value: 'Goods returned, customer dissatisfied' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(mockedFinance.refund).toHaveBeenCalledTimes(2));

    const [, , firstKey] = mockedFinance.refund.mock.calls[0]!;
    const [, secondReason, secondKey] = mockedFinance.refund.mock.calls[1]!;

    expect(secondReason).toBe('Goods returned, customer dissatisfied');
    expect(secondKey).toBe(firstKey);
  });

  it('will not submit while a refund is in flight', async () => {
    // The cheap half of the protection, and still worth pinning: without it
    // a double-click sends two requests before either has answered.
    let release: (v: RefundResult) => void = () => {};
    mockedFinance.refund.mockImplementation(
      () =>
        new Promise<RefundResult>((resolve) => {
          release = resolve;
        }),
    );

    renderPage();
    await openRefundForm();

    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText('Refunding…')).toBeTruthy());

    fireEvent.click(screen.getByText('Refunding…'));
    expect(mockedFinance.refund).toHaveBeenCalledTimes(1);

    // Let it finish inside the test rather than after it, or React reports
    // the resulting state update as an unwrapped `act`.
    release({ refundId: 'r', amount: '1000.00', totalRefunded: '1000.00', bonusClawedBack: '0' });
    await screen.findByText(/Refunded 1000.00/);
  });
});
