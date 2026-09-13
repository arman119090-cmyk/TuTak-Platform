import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
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
  purchaseIntentApi: { list: jest.fn() },
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
    refundedAmount: '0',
    negotiatedRateBps: 500,
    maxBonusPaymentPercent: 50,
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
});
