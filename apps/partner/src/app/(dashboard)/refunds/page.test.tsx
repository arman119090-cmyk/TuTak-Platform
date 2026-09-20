import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import {
  PaymentRoute,
  PurchaseIntentStatus,
  RefundRequestStatus,
  Role,
  type AuthenticatedUserDto,
  type PurchaseIntentDto,
  type PurchaseIntentRefundRequestDto,
} from '@tutak/shared-types';
import RefundsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';
import { refundRequestApi } from '@/lib/api/refundRequestApi';

/**
 * A refund is never one person's tap: staff ask, an owner or manager
 * decides. The screen has to make that split visible, and — more
 * importantly — must not offer a cashier a control the server will only
 * ever answer 403 to.
 */

jest.mock('@/lib/api/refundRequestApi', () => ({
  refundRequestApi: {
    list: jest.fn(),
    create: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  },
}));
jest.mock('@/lib/api/purchaseIntentApi', () => ({
  purchaseIntentApi: {
    list: jest.fn(),
    pendingExternalRefunds: jest.fn().mockResolvedValue([]),
    confirmExternalRefund: jest.fn(),
  },
}));

function buildUser(role: Role): AuthenticatedUserDto {
  return {
    id: `user-${role}`,
    phone: '+37400000002',
    email: null,
    firstName: 'Partner',
    lastName: 'Person',
    roles: [role],
    partnerScopes: { [role]: ['partner-1'] } as AuthenticatedUserDto['partnerScopes'],
    locale: 'hy',
    isPhoneVerified: true,
    avatar: null,
    showAvatarInReferralList: false,
    personalizedRecommendationsEnabled: false,
    mustChangePassword: false,
  };
}

function requestFixture(
  overrides: Partial<PurchaseIntentRefundRequestDto> = {},
): PurchaseIntentRefundRequestDto {
  return {
    id: 'request-1',
    purchaseIntentId: 'aaaaaaaa-bbbb-cccc-dddd-eeee12345678',
    partnerId: 'partner-1',
    partnerBranchId: null,
    amount: '1500.0000',
    reason: 'Wrong size',
    status: RefundRequestStatus.PENDING,
    requestedByUserId: 'cashier-1',
    requestedAt: new Date('2026-09-12T10:00:00Z').toISOString(),
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    refundId: null,
    ...overrides,
  };
}

function purchaseFixture(overrides: Partial<PurchaseIntentDto> = {}): PurchaseIntentDto {
  return {
    id: 'ffffffff-1111-2222-3333-444455556666',
    customerId: 'customer-1',
    partnerId: 'partner-1',
    partnerBranchId: null,
    status: PurchaseIntentStatus.CONFIRMED,
    grossAmount: '10000',
    bonusAmountRequested: '0',
    ordinaryPaymentRemainder: '10000',
    prepaidAmountApplied: '0',
    refundedAmount: '0',
    // Added by the purchase-intent work this screen now sits alongside: the
    // till code (#36), the customer's own cancellation (#35) and who refused
    // a purchase (#41). A fixture that lies about the shape of a DTO is a
    // test that stops proving anything the day the real one changes.
    confirmationCode: '0042',
    rejectedByUserId: null,
    cancelledAt: null,
    negotiatedRateBps: 500,
    maxBonusPaymentPercent: 50,
    // The hybrid money flow (15.09.2026). A refunded purchase is a settled
    // one, so the ordinary till route with the economics already agreed is
    // the honest default here; the provider route has its own tests.
    paymentRoute: PaymentRoute.DIRECT_PARTNER,
    quantity: null,
    quantityUnit: null,
    unitPrice: null,
    contributionRuleKind: null,
    contributionRuleVersion: null,
    merchantApprovedAt: new Date('2026-09-12T09:01:00Z').toISOString(),
    merchantApprovedByUserId: 'owner-1',
    partnerBrand: { partnerId: 'partner-1', displayName: 'Verified Shop', logo: null },
    confirmedByUserId: 'owner-1',
    rejectionReason: null,
    createdAt: new Date('2026-09-12T09:00:00Z').toISOString(),
    expiresAt: new Date('2026-09-12T09:03:00Z').toISOString(),
    confirmedAt: new Date('2026-09-12T09:01:00Z').toISOString(),
    rejectedAt: null,
    ...overrides,
  };
}

let activeClient: QueryClient | undefined;
let activeUnmount: (() => void) | undefined;

const requestConfig = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

/** A request that never got an answer — offline, a dropped connection. */
function networkFailure() {
  return new AxiosError('Network Error', 'ERR_NETWORK', requestConfig);
}

/** The server answered and refused: the thing changed underneath. */
function stateFailure(message: string, status = 409) {
  return new AxiosError(message, 'ERR_BAD_REQUEST', requestConfig, undefined, {
    status,
    statusText: 'Conflict',
    headers: {},
    config: requestConfig,
    data: { statusCode: status, message },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  const result = render(
    <QueryClientProvider client={client}>
      <RefundsPage />
    </QueryClientProvider>,
  );
  activeUnmount = result.unmount;
  return result;
}

describe('RefundsPage', () => {
  beforeEach(() => {
    (refundRequestApi.list as jest.Mock).mockResolvedValue([requestFixture()]);
    (purchaseIntentApi.list as jest.Mock).mockResolvedValue([purchaseFixture()]);
    (refundRequestApi.approve as jest.Mock).mockResolvedValue(
      requestFixture({ status: RefundRequestStatus.APPROVED }),
    );
    (refundRequestApi.reject as jest.Mock).mockResolvedValue(
      requestFixture({ status: RefundRequestStatus.REJECTED }),
    );
    (refundRequestApi.create as jest.Mock).mockResolvedValue(requestFixture());
  });

  afterEach(() => {
    activeUnmount?.();
    activeUnmount = undefined;
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  it('lets an owner approve a waiting request', async () => {
    useAuthStore.setState({ user: buildUser(Role.PARTNER_OWNER) });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await waitFor(() => expect(refundRequestApi.approve).toHaveBeenCalledWith('request-1'));
  });

  it('lets a manager decide too — a shift manager is who is actually there', async () => {
    useAuthStore.setState({ user: buildUser(Role.PARTNER_MANAGER) });
    renderPage();

    expect(await screen.findByRole('button', { name: /approve/i })).toBeTruthy();
  });

  it('asks why before refusing, and sends the note', async () => {
    useAuthStore.setState({ user: buildUser(Role.PARTNER_OWNER) });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^refuse$/i }));
    fireEvent.change(screen.getByLabelText(/why this refund is refused/i), {
      target: { value: 'No receipt' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^refuse$/i }));

    await waitFor(() =>
      expect(refundRequestApi.reject).toHaveBeenCalledWith('request-1', { note: 'No receipt' }),
    );
  });

  it('offers a cashier no decision at all, only the waiting state', async () => {
    useAuthStore.setState({ user: buildUser(Role.PARTNER_STAFF) });
    renderPage();

    await screen.findByText(/waiting for an owner or manager/i);
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('lets a cashier ask for a refund on a completed sale', async () => {
    useAuthStore.setState({ user: buildUser(Role.PARTNER_STAFF) });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /ask for a refund/i }));
    fireEvent.change(screen.getByLabelText(/amount to return/i), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText(/reason for the refund/i), {
      target: { value: 'Damaged on opening' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send for a decision/i }));

    await waitFor(() =>
      expect(refundRequestApi.create).toHaveBeenCalledWith(
        'ffffffff-1111-2222-3333-444455556666',
        { amount: '2500', reason: 'Damaged on opening' },
      ),
    );
  });

  it('does not offer a second request on a sale that already has one waiting', async () => {
    (refundRequestApi.list as jest.Mock).mockResolvedValue([
      requestFixture({ purchaseIntentId: 'ffffffff-1111-2222-3333-444455556666' }),
    ]);
    useAuthStore.setState({ user: buildUser(Role.PARTNER_STAFF) });
    renderPage();

    // The server refuses a second undecided request, so the button is not
    // offered either — the cashier is told what is actually happening.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /ask for a refund/i })).toBeNull(),
    );
    expect(screen.getAllByText(/waiting for a decision/i).length).toBeGreaterThan(0);
  });

  /**
   * U08 — the two halves fail on their own, and a lost decision is never
   * assumed to have been lost.
   */
  describe('when the lists cannot be trusted', () => {
    it('says the requests are loading rather than "nothing waiting"', () => {
      (refundRequestApi.list as jest.Mock).mockReturnValue(new Promise(() => undefined));
      useAuthStore.setState({ user: buildUser(Role.PARTNER_OWNER) });
      renderPage();
      expect(screen.getByText('Loading refund requests…')).toBeTruthy();
      expect(screen.queryByText('Nothing waiting')).toBeNull();
    });

    it('shows a load error for the requests while the sales still load', async () => {
      (refundRequestApi.list as jest.Mock).mockRejectedValue(networkFailure());
      useAuthStore.setState({ user: buildUser(Role.PARTNER_STAFF) });
      renderPage();
      expect(await screen.findByText('Refund requests could not be loaded')).toBeTruthy();
      expect(screen.queryByText('Nothing waiting')).toBeNull();
      // The other half is unaffected: the completed sale is still there to act on.
      expect(await screen.findByRole('button', { name: /ask for a refund/i })).toBeTruthy();
    });

    it('shows a load error for the sales, not "no completed sales yet"', async () => {
      (purchaseIntentApi.list as jest.Mock).mockRejectedValue(networkFailure());
      useAuthStore.setState({ user: buildUser(Role.PARTNER_STAFF) });
      renderPage();
      expect(await screen.findByText('Completed sales could not be loaded')).toBeTruthy();
      expect(screen.queryByText(/no completed sales yet/i)).toBeNull();
      expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy();
    });

    it('keeps the waiting request on screen, labelled stale, when a refresh fails', async () => {
      (refundRequestApi.list as jest.Mock)
        .mockResolvedValueOnce([requestFixture()])
        .mockRejectedValueOnce(networkFailure());
      useAuthStore.setState({ user: buildUser(Role.PARTNER_OWNER) });
      renderPage();
      expect(await screen.findByText('Wrong size')).toBeTruthy();
      await activeClient!.refetchQueries({ queryKey: ['refund-requests', 'partner-1'] });
      expect(await screen.findByText(/showing refund requests as of/i)).toBeTruthy();
      expect(screen.getByText('Wrong size')).toBeTruthy();
    });

    it('re-reads the request and keeps the note when the refusal gets no answer', async () => {
      (refundRequestApi.reject as jest.Mock).mockRejectedValue(networkFailure());
      useAuthStore.setState({ user: buildUser(Role.PARTNER_OWNER) });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /^refuse$/i }));
      fireEvent.change(screen.getByLabelText(/why this refund is refused/i), {
        target: { value: 'No receipt' },
      });
      (refundRequestApi.list as jest.Mock).mockClear();
      fireEvent.click(screen.getByRole('button', { name: /^refuse$/i }));

      expect(await screen.findByText(/outcome is unknown/i)).toBeTruthy();
      // Typed text survives; the request was re-read before the message appeared.
      expect((screen.getByLabelText(/why this refund is refused/i) as HTMLInputElement).value).toBe(
        'No receipt',
      );
      await waitFor(() => expect(refundRequestApi.list).toHaveBeenCalled());
      // Nothing is re-sent on its own.
      expect(refundRequestApi.reject).toHaveBeenCalledTimes(1);
    });

    it('explains a decision that landed first instead of retrying it', async () => {
      (refundRequestApi.approve as jest.Mock).mockRejectedValue(
        stateFailure('Refund request is not pending'),
      );
      (refundRequestApi.list as jest.Mock)
        .mockResolvedValueOnce([requestFixture()])
        .mockResolvedValue([
          requestFixture({ status: RefundRequestStatus.REJECTED, decisionNote: 'Duplicate' }),
        ]);
      useAuthStore.setState({ user: buildUser(Role.PARTNER_OWNER) });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
      // The request is now shown decided, in words — not as the enum.
      expect(await screen.findByText('Refused')).toBeTruthy();
      expect(screen.queryByText('REJECTED')).toBeNull();
      expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
      expect(refundRequestApi.approve).toHaveBeenCalledTimes(1);
    });

    it('does not lose the refund form when the request gets no answer', async () => {
      (refundRequestApi.create as jest.Mock).mockRejectedValue(networkFailure());
      useAuthStore.setState({ user: buildUser(Role.PARTNER_STAFF) });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /ask for a refund/i }));
      fireEvent.change(screen.getByLabelText(/reason for the refund/i), {
        target: { value: 'Damaged on opening' },
      });
      fireEvent.click(screen.getByRole('button', { name: /send for a decision/i }));

      expect(await screen.findByText(/outcome is unknown/i)).toBeTruthy();
      expect((screen.getByLabelText(/reason for the refund/i) as HTMLInputElement).value).toBe(
        'Damaged on opening',
      );
    });

    it('finds a completed sale by its till code', async () => {
      (purchaseIntentApi.list as jest.Mock).mockResolvedValue([
        purchaseFixture(),
        purchaseFixture({ id: '99999999-1111-2222-3333-444455556666', confirmationCode: '0077' }),
      ]);
      useAuthStore.setState({ user: buildUser(Role.PARTNER_STAFF) });
      renderPage();

      expect((await screen.findAllByRole('button', { name: /ask for a refund/i })).length).toBe(2);
      fireEvent.change(screen.getByLabelText(/find a completed sale/i), { target: { value: '0077' } });
      expect(screen.getAllByRole('button', { name: /ask for a refund/i }).length).toBe(1);
      fireEvent.change(screen.getByLabelText(/find a completed sale/i), { target: { value: '0000' } });
      expect(screen.getByText(/no completed sale matches/i)).toBeTruthy();
      expect(screen.queryByText(/no completed sales yet/i)).toBeNull();
    });
  });
});
