import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PartnerSettlementStatus,
  Role,
  type AuthenticatedUserDto,
  type PartnerSettlementDto,
} from '@tutak/shared-types';
import AdminSettlementsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { settlementAdminApi } from '@/lib/api/financeApi';

/**
 * Maker/checker, made visible rather than merely enforced.
 *
 * The service already refuses self-approval, so every assertion here could
 * be called redundant. It is not: an admin who is refused by a 409 learns
 * that the app is unpredictable, while one who can see the reason next to a
 * missing button learns how the control works. The assertions about what is
 * *absent* — no edit on a paid settlement, no status button on an ambiguous
 * one — are the ones worth having.
 */

jest.mock('@/lib/api/financeApi', () => ({
  settlementAdminApi: {
    list: jest.fn(),
    approve: jest.fn(),
    markReady: jest.fn(),
    markPaid: jest.fn(),
    markFailed: jest.fn(),
    markAmbiguous: jest.fn(),
    markPaymentPending: jest.fn(),
    cancel: jest.fn(),
  },
}));

function buildUser(id: string): AuthenticatedUserDto {
  return {
    id,
    phone: '+37400000009',
    email: null,
    firstName: 'Finance',
    lastName: 'Person',
    roles: [Role.ADMIN],
    partnerScopes: {} as AuthenticatedUserDto['partnerScopes'],
    locale: 'hy',
    isPhoneVerified: true,
    avatar: null,
    showAvatarInReferralList: false,
    personalizedRecommendationsEnabled: false,
    mustChangePassword: false,
  };
}

function fixture(overrides: Partial<PartnerSettlementDto> = {}): PartnerSettlementDto {
  return {
    id: 'settlement-1',
    partnerId: 'partner-1',
    status: PartnerSettlementStatus.READY,
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-15T00:00:00.000Z',
    accruedAmount: '20000.0000',
    deductionAmount: '1500.0000',
    netPayableAmount: '18500.0000',
    currency: 'AMD',
    entryCount: 2,
    documentNumber: null,
    bankTransferReference: null,
    bankAccountId: null,
    createdByUserId: 'maker-1',
    createdAt: '2026-09-15T09:00:00.000Z',
    approvedByUserId: null,
    approvedAt: null,
    paidByUserId: null,
    paidAt: null,
    failedReason: null,
    cancelledByUserId: null,
    cancelledAt: null,
    cancelledReason: null,
    reconciliationSource: null,
    reconciliationReportedByUserId: null,
    reconciliationReportedAt: null,
    reconciliationOutcome: null,
    reconciliationEvidence: null,
    reconciliationProposedByUserId: null,
    reconciliationProposedAt: null,
    reconciliationConfirmedByUserId: null,
    reconciliationConfirmedAt: null,
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
      <AdminSettlementsPage />
    </QueryClientProvider>,
  );
  activeUnmount = result.unmount;
  return result;
}

describe('AdminSettlementsPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: buildUser('checker-1') });
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([fixture()]);
    (settlementAdminApi.approve as jest.Mock).mockResolvedValue(
      fixture({ status: PartnerSettlementStatus.APPROVED }),
    );
    (settlementAdminApi.markPaid as jest.Mock).mockResolvedValue(
      fixture({ status: PartnerSettlementStatus.PAID }),
    );
    (settlementAdminApi.markFailed as jest.Mock).mockResolvedValue(
      fixture({ status: PartnerSettlementStatus.FAILED }),
    );
  });

  afterEach(() => {
    activeUnmount?.();
    activeUnmount = undefined;
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  it('lets a second person approve what somebody else prepared', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await waitFor(() => expect(settlementAdminApi.approve).toHaveBeenCalledWith('settlement-1'));
  });

  it('refuses the maker their own approval, and says why', async () => {
    useAuthStore.setState({ user: buildUser('maker-1') });
    renderPage();
    expect(await screen.findByText(/you prepared this/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  /**
   * An older row with no recorded maker. The screen must not guess that
   * approval is forbidden — blocking work the service would have allowed is
   * worse than letting the server answer.
   */
  it('lets the server decide when the maker is unknown', async () => {
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({ createdByUserId: null }),
    ]);
    renderPage();
    expect(await screen.findByRole('button', { name: /approve/i })).toBeTruthy();
  });

  it('will not record a transfer without the bank’s own reference', async () => {
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({ status: PartnerSettlementStatus.PAYMENT_PENDING }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /transfer landed/i }));
    const confirm = screen.getAllByRole('button', { name: /transfer landed/i }).pop()!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/bank transfer reference/i), {
      target: { value: 'BANK-9' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /transfer landed/i }).pop()!);
    await waitFor(() =>
      expect(settlementAdminApi.markPaid).toHaveBeenCalledWith('settlement-1', 'BANK-9'),
    );
  });

  it('makes a bounced transfer say why, and keeps the settlement workable', async () => {
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({ status: PartnerSettlementStatus.FAILED, failedReason: 'Returned' }),
    ]);
    renderPage();
    // Not terminal: another transfer may be made against the same figure.
    expect(await screen.findByRole('button', { name: /transfer sent/i })).toBeTruthy();
  });

  it('offers nothing at all on a paid settlement', async () => {
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({
        status: PartnerSettlementStatus.PAID,
        paidAt: '2026-09-16T10:00:00.000Z',
        bankTransferReference: 'BANK-1',
      }),
    ]);
    renderPage();
    expect(await screen.findByText(/paid and immutable/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  /**
   * "The money did move" is a claim about the world. One admin must not be
   * able to make it with a status button — it goes through propose/confirm
   * by two different people.
   */
  it('gives an ambiguous settlement no status button at all', async () => {
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({ status: PartnerSettlementStatus.REQUIRES_RECONCILIATION }),
    ]);
    renderPage();
    expect(await screen.findByText(/two-person reconciliation/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
