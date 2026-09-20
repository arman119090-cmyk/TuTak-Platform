import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import SettlementsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { settlementApi } from '@/lib/api/financeApi';
import {
  PartnerSettlementStatus,
  type PartnerSettlementDto,
  type UnsettledPositionDto,
} from '@tutak/shared-types';

/**
 * A partner reads their own money and cannot move it.
 *
 * The assertions worth having here are about what is *absent*: no control
 * that lets the payee declare a transfer arrived or missing, and no dispute
 * button on a settlement still being assembled. A screen that offers a
 * control the server answers 403 to teaches people the app is broken.
 */

jest.mock('@/lib/api/financeApi', () => ({
  settlementApi: {
    statements: jest.fn(),
    statement: jest.fn(),
    position: jest.fn(),
    reportProblem: jest.fn(),
  },
}));

function buildUser(): AuthenticatedUserDto {
  return {
    id: 'user-1',
    phone: '+37400000003',
    email: null,
    firstName: 'Partner',
    lastName: 'Owner',
    roles: [Role.PARTNER_OWNER],
    partnerScopes: { [Role.PARTNER_OWNER]: ['partner-1'] } as AuthenticatedUserDto['partnerScopes'],
    locale: 'hy',
    isPhoneVerified: true,
    avatar: null,
    showAvatarInReferralList: false,
    personalizedRecommendationsEnabled: false,
    mustChangePassword: false,
  };
}

/**
 * Typed as the shared DTO on purpose. `tsc` now refuses a fixture that
 * invents a field name — which is exactly how the `netAmount` bug got past
 * eight green tests before these types were shared.
 */
function statementFixture(overrides: Partial<PartnerSettlementDto> = {}): PartnerSettlementDto {
  return {
    id: 'settlement-1',
    partnerId: 'partner-1',
    status: PartnerSettlementStatus.PAID,
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-15T00:00:00.000Z',
    accruedAmount: '20000.0000',
    deductionAmount: '1500.0000',
    netPayableAmount: '18500.0000',
    currency: 'AMD',
    bankTransferReference: 'TRF-77',
    entryCount: 2,
    documentNumber: 'DOC-1',
    bankAccountId: 'ba-1',
    createdByUserId: 'admin-1',
    createdAt: '2026-09-15T09:00:00.000Z',
    approvedByUserId: 'admin-2',
    approvedAt: '2026-09-15T09:30:00.000Z',
    paidByUserId: 'admin-2',
    paidAt: '2026-09-15T10:00:00.000Z',
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

function positionFixture(overrides: Partial<UnsettledPositionDto> = {}): UnsettledPositionDto {
  return {
    partnerId: 'partner-1',
    accrued: '5000.0000',
    deductions: '250.0000',
    net: '4750.0000',
    entries: [],
    unrecognised: [],
    ledgerBalance: '4750.0000',
    inOpenSettlements: '0.0000',
    underReview: '0.0000',
    paidTotal: '18500.0000',
    asOf: '2026-09-20T12:00:00.000Z',
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
      <SettlementsPage />
    </QueryClientProvider>,
  );
  activeUnmount = result.unmount;
  return result;
}

describe('SettlementsPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: buildUser() });
    (settlementApi.statements as jest.Mock).mockResolvedValue([statementFixture()]);
    (settlementApi.position as jest.Mock).mockResolvedValue(positionFixture());
    (settlementApi.reportProblem as jest.Mock).mockResolvedValue(statementFixture());
    (settlementApi.statement as jest.Mock).mockResolvedValue({
      settlement: statementFixture(),
      entries: [
        {
          id: 'entry-1',
          settlementId: 'settlement-1',
          ledgerPostingId: 'posting-1',
          partnerId: 'partner-1',
          amount: '14000.0000',
          direction: 'CREDIT',
          kind: 'psp.payment.captured',
          sourceType: 'PspPaymentAttempt',
          sourceId: 'attempt-1',
          occurredAt: '2026-09-10T12:00:00.000Z',
        },
      ],
    });
  });

  afterEach(() => {
    activeUnmount?.();
    activeUnmount = undefined;
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  it('shows what is accruing before anybody has drafted a settlement', async () => {
    renderPage();
    // Nothing has been drafted, so the total and the unsettled part coincide.
    expect((await screen.findAllByText('4,750.00')).length).toBe(2);
  });

  it('shows a paid statement with its transfer reference', async () => {
    renderPage();
    expect(await screen.findByText('TRF-77')).toBeTruthy();
    // Once in the statement row, once as "paid out so far".
    expect(screen.getAllByText('18,500.00').length).toBe(2);
  });

  /**
   * A bounced transfer does not change what is owed — the entries stay
   * claimed and another transfer may be made against the same figure. The
   * wording has to say so, or a partner reads FAILED as "my money is gone".
   */
  it('tells a partner a bounced transfer is still owed', async () => {
    (settlementApi.statements as jest.Mock).mockResolvedValue([
      statementFixture({ status: PartnerSettlementStatus.FAILED, paidAt: null }),
    ]);
    renderPage();
    expect(await screen.findByText(/still owed/i)).toBeTruthy();
  });

  it('offers no dispute on a settlement still being assembled', async () => {
    (settlementApi.statements as jest.Mock).mockResolvedValue([
      statementFixture({
        status: PartnerSettlementStatus.DRAFT,
        paidAt: null,
        bankTransferReference: null,
      }),
    ]);
    renderPage();
    await screen.findByText('Being prepared — not paid yet');
    expect(screen.queryByRole('button', { name: /report a problem/i })).toBeNull();
  });

  /**
   * The breakdown behind the figure.
   *
   * Its absence was the quiet failure of this screen: the partner could see
   * what they were paid and nothing about what it was made of, so the only
   * response available to a figure they disagreed with was to argue with it.
   */
  it('shows what a settlement is made of when asked', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /what is this made of/i }));

    await waitFor(() =>
      expect(settlementApi.statement).toHaveBeenCalledWith('partner-1', 'settlement-1'),
    );
    expect(await screen.findByText('psp.payment.captured')).toBeTruthy();
    expect(screen.getByText('14,000.00')).toBeTruthy();
  });

  /**
   * The posting kind is shown as stored rather than translated: a partner
   * querying a line has to quote something TuTak can look up.
   */
  it('shows the kind TuTak records, not a friendlier invention', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /what is this made of/i }));
    expect(await screen.findByText('psp.payment.captured')).toBeTruthy();
  });

  it('closes the detail again', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /what is this made of/i }));
    await screen.findByText('psp.payment.captured');
    fireEvent.click(screen.getByRole('button', { name: /hide detail/i }));
    await waitFor(() => expect(screen.queryByText('psp.payment.captured')).toBeNull());
  });

  it('says so when a settlement has no lines rather than showing an empty table', async () => {
    (settlementApi.statement as jest.Mock).mockResolvedValue({
      settlement: statementFixture(),
      entries: [],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /what is this made of/i }));
    expect(await screen.findByText(/no itemised lines/i)).toBeTruthy();
  });

  it('sends a problem report with the reason, as `reason`', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /report a problem/i }));
    fireEvent.change(screen.getByLabelText(/what is wrong with this transfer/i), {
      target: { value: 'Nothing reached our account' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(settlementApi.reportProblem).toHaveBeenCalledWith(
        'partner-1',
        'settlement-1',
        'Nothing reached our account',
      ),
    );
  });

  it('will not send an empty complaint — the server would refuse it anyway', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /report a problem/i }));
    const send = screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  /**
   * The absence that matters most: nothing on this screen lets the payee
   * assert that money moved. That decision takes two people at TuTak.
   */
  it('gives the payee no way to declare a transfer settled', async () => {
    renderPage();
    await screen.findByText('TRF-77');
    expect(screen.queryByRole('button', { name: /mark.*paid|confirm.*received/i })).toBeNull();
  });

  /**
   * The case from the audit (U09): TuTak owes 50 000, a DRAFT settlement
   * claims it, `net` reads zero. The page must still say 50 000 is owed and
   * must not say anything is closed or paid.
   */
  it('does not read a drafted settlement as money paid', async () => {
    (settlementApi.position as jest.Mock).mockResolvedValue(
      positionFixture({
        accrued: '0',
        deductions: '0',
        net: '0',
        ledgerBalance: '50000.0000',
        inOpenSettlements: '50000.0000',
        paidTotal: '0',
      }),
    );
    (settlementApi.statements as jest.Mock).mockResolvedValue([
      statementFixture({
        status: PartnerSettlementStatus.DRAFT,
        netPayableAmount: '50000.0000',
        paidAt: null,
        bankTransferReference: null,
      }),
    ]);
    renderPage();
    expect(await screen.findByText('TuTak owes you in total')).toBeTruthy();
    // 50 000 appears as the total, as "in settlements not yet paid" and in
    // the draft row, which says so in words.
    expect((await screen.findAllByText('50,000.00')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Being prepared — not paid yet')).toBeTruthy();
    expect(screen.queryByText(/closed|settled up|paid in full/i)).toBeNull();
  });

  it('says the partner owes TuTak when the ledger total is negative', async () => {
    (settlementApi.position as jest.Mock).mockResolvedValue(
      positionFixture({ net: '-2500.0000', ledgerBalance: '-2500.0000', accrued: '0', deductions: '2500.0000' }),
    );
    renderPage();
    expect(await screen.findByText('You owe TuTak')).toBeTruthy();
  });

  /** U01: no figure is a number until it has been received. */
  it('shows dashes, not zeros, while the balance is loading', () => {
    (settlementApi.position as jest.Mock).mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('0.00')).toBeNull();
    expect(screen.getAllByText('Loading…').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a load error for the balance, never a zero balance', async () => {
    (settlementApi.position as jest.Mock).mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByText('Your balance could not be loaded')).toBeTruthy();
    expect(screen.queryByText('0.00')).toBeNull();
    expect(screen.getAllByText('Could not load').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the last balance on screen, labelled as of a time, when a refresh fails', async () => {
    (settlementApi.position as jest.Mock)
      .mockResolvedValueOnce(positionFixture())
      .mockRejectedValueOnce(new Error('network'));
    renderPage();
    expect((await screen.findAllByText('4,750.00')).length).toBe(2);
    await activeClient!.refetchQueries({ queryKey: ['partner-position', 'partner-1'] });
    expect(await screen.findByText(/showing your balance as of/i)).toBeTruthy();
    // The figures are still there — they were true at that time.
    expect(screen.getAllByText('4,750.00').length).toBe(2);
    expect(screen.queryByText('Could not load')).toBeNull();
  });

  it('shows a load error for the statements instead of "no settlements yet"', async () => {
    (settlementApi.statements as jest.Mock).mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByText('Your settlements could not be loaded')).toBeTruthy();
    expect(screen.queryByText('No settlements yet')).toBeNull();
  });

  it('shows a load error for the itemisation instead of "no lines"', async () => {
    (settlementApi.statement as jest.Mock).mockRejectedValue(new Error('network'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /what is this made of/i }));
    expect(await screen.findByText('The itemisation could not be loaded')).toBeTruthy();
    expect(screen.queryByText(/no itemised lines/i)).toBeNull();
  });

  it('names a posting kind in plain words and keeps the code beside it', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /what is this made of/i }));
    expect(await screen.findByText('Customer paid in TuTak')).toBeTruthy();
    expect(screen.getByText('psp.payment.captured')).toBeTruthy();
  });

  it('surfaces unclassified activity rather than quietly excluding it', async () => {
    (settlementApi.position as jest.Mock).mockResolvedValue(
      positionFixture({ accrued: '0', deductions: '0', net: '0', ledgerBalance: '0', unrecognised: ['some.new.kind'] }),
    );
    renderPage();
    expect(await screen.findByText(/some\.new\.kind/)).toBeTruthy();
  });
});
