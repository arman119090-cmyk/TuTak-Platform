import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ContributionRuleKind,
  PaymentRoute,
  PurchaseIntentStatus,
  Role,
  UnitOfMeasure,
  type AuthenticatedUserDto,
  type PurchaseIntentDto,
} from '@tutak/shared-types';
import PurchaseIntentsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';

/**
 * The cashier's screen, and the two things it must never let them do.
 *
 * A provider confirms that money moved; it cannot confirm that a sale
 * happened, and on this platform the *customer* types the gross and the
 * quantity. So staff agree the economics first — and once a purchase is
 * being paid inside TuTak, the cashier must have no way to say the money
 * arrived, because they cannot see the provider's ledger.
 */

jest.mock('@/lib/api/purchaseIntentApi', () => ({
  purchaseIntentApi: {
    list: jest.fn(),
    confirm: jest.fn(),
    approveForPayment: jest.fn(),
    reject: jest.fn(),
  },
}));

const api = purchaseIntentApi as jest.Mocked<typeof purchaseIntentApi>;

function intentFixture(overrides: Partial<PurchaseIntentDto> = {}): PurchaseIntentDto {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444455556666',
    customerId: 'customer-1',
    partnerId: 'partner-1',
    partnerBranchId: null,
    status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
    confirmationCode: '0042',
    grossAmount: '15000',
    bonusAmountRequested: '1000',
    ordinaryPaymentRemainder: '14000',
    prepaidAmountApplied: '0',
    refundedAmount: '0',
    paymentRoute: PaymentRoute.DIRECT_PARTNER,
    quantity: null,
    quantityUnit: null,
    unitPrice: null,
    contributionRuleKind: null,
    contributionRuleVersion: null,
    merchantApprovedAt: null,
    merchantApprovedByUserId: null,
    negotiatedRateBps: 500,
    maxBonusPaymentPercent: 100,
    partnerBrand: { partnerId: 'partner-1', displayName: 'HAZE', logo: null },
    confirmedByUserId: null,
    confirmation: null,
    rejectedByUserId: null,
    rejectionReason: null,
    createdAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt: new Date(Date.now() + 170_000).toISOString(),
    confirmedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

const perUnit = (overrides: Partial<PurchaseIntentDto> = {}) =>
  intentFixture({
    quantity: '50',
    quantityUnit: UnitOfMeasure.LITER,
    unitPrice: '300',
    contributionRuleKind: ContributionRuleKind.FIXED_PER_UNIT,
    contributionRuleVersion: 1,
    ...overrides,
  });

let activeUnmount: (() => void) | undefined;

let activeClient: QueryClient | undefined;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  const view = render(
    <QueryClientProvider client={client}>
      <PurchaseIntentsPage />
    </QueryClientProvider>,
  );
  activeUnmount = view.unmount;
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: {
      id: 'user-cashier',
      phone: '+37400000003',
      email: null,
      firstName: 'Cashier',
      lastName: 'Shift',
      roles: [Role.PARTNER_STAFF],
      partnerScopes: { PARTNER_STAFF: ['partner-1'] } as AuthenticatedUserDto['partnerScopes'],
      locale: 'hy',
    } as AuthenticatedUserDto,
  });
});

afterEach(() => {
  activeUnmount?.();
  activeUnmount = undefined;
});

describe('the cashier queue', () => {
  it('says "collect 0" in words when TuTak funds the whole purchase, and never "paid"', async () => {
    api.list.mockResolvedValue([
      intentFixture({ bonusAmountRequested: '1000', prepaidAmountApplied: '14000', ordinaryPaymentRemainder: '0' }),
    ]);
    renderPage();

    expect(await screen.findByText('Collect 0 ֏ — paid through TuTak after you confirm')).toBeTruthy();
    expect(screen.getByText('0 ֏')).toBeTruthy();
    expect(screen.getByText(/14[\s\u00a0\u202f]?000/)).toBeTruthy();
    expect(screen.queryByText(/^Paid$/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('shows a till purchase with Confirm, as it always did', async () => {
    api.list.mockResolvedValue([intentFixture()]);
    renderPage();

    expect(await screen.findByText('At the till')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    // The amount to actually take, still the loudest figure in the row.
    expect(screen.getByText('14 000 ֏')).toBeTruthy();
  });

  it('offers approval, not confirmation, for a purchase paid in TuTak', async () => {
    api.list.mockResolvedValue([intentFixture({ paymentRoute: PaymentRoute.TUTAK_PSP })]);
    renderPage();

    expect(await screen.findByText('In TuTak')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve for payment' })).toBeTruthy();
    // There is no Confirm here, because confirming would mean asserting the
    // customer's money arrived — which the cashier cannot know.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('leaves an approved TuTak purchase with no action at all', async () => {
    api.list.mockResolvedValue([
      intentFixture({
        paymentRoute: PaymentRoute.TUTAK_PSP,
        merchantApprovedAt: new Date().toISOString(),
        merchantApprovedByUserId: 'user-cashier',
      }),
    ]);
    renderPage();

    expect(await screen.findByText('Waiting for payment')).toBeTruthy();
    expect(screen.getByText(/do not take cash for it/i)).toBeTruthy();
    for (const label of ['Confirm', 'Approve for payment', 'Reject']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('shows the line item for a per-unit partner and sends it back on confirm', async () => {
    api.list.mockResolvedValue([perUnit()]);
    api.confirm.mockResolvedValue(perUnit());
    renderPage();

    // 50 × 300 = 15,000, and the cashier can see that it closes.
    expect(await screen.findByDisplayValue('50')).toBeTruthy();
    expect(screen.getByDisplayValue('300')).toBeTruthy();
    expect(screen.getByText(/paid per L/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(api.confirm).toHaveBeenCalledWith(perUnit().id, {
        quantity: '50',
        quantityUnit: UnitOfMeasure.LITER,
        unitPrice: '300',
      }),
    );
  });

  it('shows the cashier when the arithmetic does not close', async () => {
    api.list.mockResolvedValue([perUnit()]);
    renderPage();

    const quantity = await screen.findByDisplayValue('50');
    // The pump said 40, not the 50 the customer typed.
    fireEvent.change(quantity, { target: { value: '40' } });

    expect(await screen.findByText(/does not match the purchase/i)).toBeTruthy();
    // Deliberately still clickable: the server is the authority and will
    // refuse it. A disabled button would teach staff that the screen decides,
    // and the screen is a mirror.
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('does not flag a correct fuel sale because of floating-point drift', async () => {
    // 33.3 × 480 is 15983.999999999998 in floating point and 15984 exactly.
    api.list.mockResolvedValue([
      perUnit({ quantity: '33.3000', unitPrice: '480.0000', grossAmount: '15984.0000' }),
    ]);
    renderPage();

    expect(await screen.findByDisplayValue('33.3000')).toBeTruthy();
    expect(screen.queryByText(/does not match the purchase/i)).toBeNull();
  });

  it('sends a comma-decimal quantity with a dot, which is what the API accepts', async () => {
    api.list.mockResolvedValue([
      perUnit({ quantity: '33.3000', unitPrice: '480.0000', grossAmount: '15984.0000' }),
    ]);
    api.confirm.mockResolvedValue(perUnit());
    renderPage();

    fireEvent.change(await screen.findByDisplayValue('33.3000'), { target: { value: '33,3' } });
    expect(screen.queryByText(/does not match the purchase/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(api.confirm).toHaveBeenCalledWith(
        perUnit().id,
        expect.objectContaining({ quantity: '33.3', unitPrice: '480.0000' }),
      ),
    );
  });

  it('freezes the line item once the purchase has been approved', async () => {
    api.list.mockResolvedValue([
      perUnit({
        paymentRoute: PaymentRoute.TUTAK_PSP,
        merchantApprovedAt: new Date().toISOString(),
        merchantApprovedByUserId: 'user-cashier',
      }),
    ]);
    renderPage();

    // Approved economics are frozen at the database level; the screen agrees
    // rather than offering an edit the server would refuse.
    expect((await screen.findByDisplayValue('50')).hasAttribute('disabled')).toBe(true);
  });

  it('sends no line item for a percentage partner', async () => {
    api.list.mockResolvedValue([intentFixture()]);
    api.confirm.mockResolvedValue(intentFixture());
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    // Nothing to check, so nothing is asked for — demanding a figure here
    // would train staff to type numbers they never looked at.
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith(intentFixture().id, {}));
  });
});

/**
 * U02 / U12 from the audit of 20.09.2026: an unreachable queue must never
 * look like an empty one, and a decline that did not go through must not
 * eat the reason the cashier typed.
 */
describe('when the queue cannot be trusted', () => {
  const networkError = () => {
    const error = new Error('Network Error') as Error & { isAxiosError: boolean; response?: undefined };
    error.isAxiosError = true;
    return error;
  };
  const stateError = (status: number, message: string) => {
    const error = new Error(message) as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { message: string } };
    };
    error.isAxiosError = true;
    error.response = { status, data: { message } };
    return error;
  };

  it('says it is loading, not that there are no requests', () => {
    api.list.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByText('Loading the queue…')).toBeTruthy();
    expect(screen.queryByText('No pending requests')).toBeNull();
  });

  it('shows a load error with a retry when nothing has arrived', async () => {
    api.list.mockRejectedValue(networkError());
    renderPage();
    expect(await screen.findByText('The queue could not be loaded')).toBeTruthy();
    expect(screen.queryByText('No pending requests')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps the queue on screen, labelled as of a time, when the poll starts failing', async () => {
    api.list.mockResolvedValueOnce([intentFixture()]).mockRejectedValueOnce(networkError());
    renderPage();
    expect(await screen.findByText('At the till')).toBeTruthy();
    await activeClient!.refetchQueries({ queryKey: ['purchase-intents', 'partner-1'] });
    expect(await screen.findByText(/showing the queue as of/i)).toBeTruthy();
    // The row is still there — the purchase may still be live.
    expect(screen.getByText('At the till')).toBeTruthy();
    expect(screen.queryByText('No pending requests')).toBeNull();
  });

  it('keeps the typed reason and the form when a decline cannot reach the server', async () => {
    api.list.mockResolvedValue([intentFixture()]);
    api.reject.mockRejectedValue(networkError());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText('Reason for declining'), { target: { value: 'wrong amount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));

    expect(await screen.findByText(/not sent — the server could not be reached/i)).toBeTruthy();
    expect((screen.getByLabelText('Reason for declining') as HTMLInputElement).value).toBe('wrong amount');
    expect(screen.getByRole('button', { name: 'Confirm decline' })).toBeTruthy();
  });

  it('explains a decline the server refused because the purchase had already changed, and re-reads the queue', async () => {
    api.list.mockResolvedValue([intentFixture()]);
    api.reject.mockRejectedValue(stateError(400, 'This purchase intent has expired'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText('Reason for declining'), { target: { value: 'late' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));

    expect(await screen.findByText(/this purchase intent has expired/i)).toBeTruthy();
    expect(screen.queryByLabelText('Reason for declining')).toBeNull();
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('never offers to create a new purchase as a way past a connection problem', async () => {
    api.list.mockRejectedValue(networkError());
    renderPage();
    await screen.findByText('The queue could not be loaded');
    expect(screen.queryByText(/new purchase|create a purchase/i)).toBeNull();
  });
});
