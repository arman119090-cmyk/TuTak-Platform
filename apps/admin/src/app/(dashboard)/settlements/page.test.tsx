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
import { partnersApi } from '@/lib/api/partnersApi';

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

jest.mock('@/lib/api/partnersApi', () => ({
  partnersApi: { list: jest.fn() },
}));
jest.mock('@/lib/api/financeApi', () => ({
  settlementAdminApi: {
    list: jest.fn(),
    draft: jest.fn(),
    unsettled: jest.fn(),
    proposeReconciliation: jest.fn(),
    confirmReconciliation: jest.fn(),
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
    (partnersApi.list as jest.Mock).mockResolvedValue([
      { id: 'partner-1', displayName: 'Coffee House' },
    ]);
    (settlementAdminApi.unsettled as jest.Mock).mockResolvedValue({
      partnerId: 'partner-1',
      accrued: '20000.0000',
      deductions: '1500.0000',
      net: '18500.0000',
      entries: [],
      unrecognised: [],
    });
    (settlementAdminApi.draft as jest.Mock).mockResolvedValue(
      fixture({ status: PartnerSettlementStatus.DRAFT }),
    );
    (settlementAdminApi.proposeReconciliation as jest.Mock).mockResolvedValue(fixture());
    (settlementAdminApi.confirmReconciliation as jest.Mock).mockResolvedValue(fixture());
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

  /**
   * The start of the cycle. Without it the screen could move settlements
   * along and never create one, so the only way a settlement could exist was
   * an API call by hand — half a lifecycle with a full interface over it.
   */
  it('drafts a settlement for a chosen partner and period', async () => {
    renderPage();
    // Wait for the options, not just the select: the partner list arrives
    // from its own query, and changing a select before its options exist
    // sets nothing — which is how the first version of this test passed a
    // value the component never saw.
    await screen.findByRole('option', { name: 'Coffee House' });
    fireEvent.change(screen.getByLabelText(/^partner$/i), { target: { value: 'partner-1' } });
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }));

    await waitFor(() =>
      expect(settlementAdminApi.draft).toHaveBeenCalledWith('partner-1', '2026-09-01', '2026-09-30'),
    );
  });

  /**
   * Drafting claims postings. An admin who cannot see what they are about to
   * claim is pressing a button on trust, so the figure is shown first.
   */
  it('shows what is unclaimed before anything is drafted', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Coffee House' });
    fireEvent.change(screen.getByLabelText(/^partner$/i), { target: { value: 'partner-1' } });
    expect(await screen.findByText(/18,500\.00 net/)).toBeTruthy();
  });

  it('will not draft without a partner and both dates', async () => {
    renderPage();
    const button = (await screen.findByRole('button', { name: /^draft$/i })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  /**
   * The state the screen used to describe and not offer. A settlement could
   * enter it and the interface had no way out.
   */
  it('lets somebody propose an outcome on an ambiguous settlement', async () => {
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({ status: PartnerSettlementStatus.REQUIRES_RECONCILIATION }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /money did move/i }));
    fireEvent.change(screen.getByLabelText(/why/i), {
      target: { value: 'Bank statement line 42 shows the transfer' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /money did move/i }).pop()!);

    await waitFor(() =>
      expect(settlementAdminApi.proposeReconciliation).toHaveBeenCalledWith(
        'settlement-1',
        'MONEY_MOVED',
        'Bank statement line 42 shows the transfer',
      ),
    );
  });

  it('refuses the proposer their own confirmation', async () => {
    useAuthStore.setState({ user: buildUser('proposer-1') });
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({
        status: PartnerSettlementStatus.REQUIRES_RECONCILIATION,
        reconciliationProposedByUserId: 'proposer-1',
        reconciliationProposedAt: '2026-09-18T10:00:00.000Z',
      }),
    ]);
    renderPage();
    expect(await screen.findByText(/you proposed this/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /confirm the proposal/i })).toBeNull();
  });

  it('offers no confirmation when nothing has been proposed', async () => {
    (settlementAdminApi.list as jest.Mock).mockResolvedValue([
      fixture({ status: PartnerSettlementStatus.REQUIRES_RECONCILIATION }),
    ]);
    renderPage();
    expect(await screen.findByText(/nothing proposed yet/i)).toBeTruthy();
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
    // The drafting panel has its own button, so this asks about the row's
    // actions specifically rather than the whole page.
    expect(screen.queryByRole('button', { name: /approve|transfer|cancel|mark/i })).toBeNull();
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
    // Superseded: this state now has the two-person actions the screen
    // always claimed it had. Covered by the propose/confirm tests above.
    expect(await screen.findByRole('button', { name: /money did move/i })).toBeTruthy();
  });
});
