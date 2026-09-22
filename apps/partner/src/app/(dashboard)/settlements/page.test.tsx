import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import SettlementsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { settlementApi } from '@/lib/api/financeApi';
import { partnerApi } from '@/lib/api/partnerApi';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';
import {
  PartnerSettlementStatus,
  type PartnerActivityPageDto,
  type PartnerActivityRowDto,
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
    activity: jest.fn(),
    purchaseBreakdown: jest.fn(),
  },
}));

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: { listBranches: jest.fn() },
}));

jest.mock('@/lib/api/purchaseIntentApi', () => ({
  purchaseIntentApi: { history: jest.fn() },
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
    funding: {
      salesGross: '120000.0000',
      receivedDirectly: '95000.0000',
      receivedViaProvider: '0.0000',
      fundedByPrepaid: '20000.0000',
      fundedByBonus: '5000.0000',
      contribution: '6000.0000',
      refundedGross: '0.0000',
      owedToTuTak: '0.0000',
      collectionsConfirmed: '0.0000',
    },
    ...overrides,
  };
}

function activityRow(
  overrides: Partial<PartnerActivityRowDto> = {},
): PartnerActivityRowDto {
  return {
    postingId: 'posting-1',
    occurredAt: '2026-09-18T09:30:00.000Z',
    kind: 'partner.bonus_redemption_compensation',
    debtChange: '5000.0000',
    state: 'UNSETTLED',
    settlementId: null,
    sourceType: 'PurchaseIntent',
    sourceId: '11111111-2222-3333-4444-5555aabbccdd',
    reference: '5555AABB',
    branch: 'North',
    employeeCode: 'EMP-004',
    confirmationSource: 'STAFF',
    itemisable: true,
    ...overrides,
  };
}

function activityPage(
  overrides: Partial<PartnerActivityPageDto> = {},
): PartnerActivityPageDto {
  return {
    rows: [activityRow()],
    nextCursor: null,
    selection: { credits: '5000.0000', debits: '0.0000', net: '5000.0000', rowCount: 1 },
    filtered: false,
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
    (settlementApi.activity as jest.Mock).mockResolvedValue(activityPage());
    (purchaseIntentApi.history as jest.Mock).mockResolvedValue({
      purchaseIntentId: '11111111-2222-3333-4444-5555aabbccdd',
      reference: '5555AABB',
      status: 'CONFIRMED',
      events: [
        {
          type: 'CREATED',
          at: '2026-09-18T09:00:00.000Z',
          actor: { kind: 'CUSTOMER' },
          detail: { grossAmount: '10000.0000' },
        },
        {
          type: 'CONFIRMED',
          at: '2026-09-18T09:30:00.000Z',
          actor: { kind: 'STAFF', employeeCode: 'EMP-004', role: 'PARTNER_STAFF', frozen: true },
          detail: {},
        },
        {
          type: 'REFUNDED',
          at: '2026-09-20T11:00:00.000Z',
          actor: { kind: 'STAFF', employeeCode: 'EMP-001', frozen: false },
          detail: { amount: '1000.0000', reason: 'Customer returned an item' },
        },
      ],
    });
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      { id: 'branch-1', name: 'North' },
      { id: 'branch-2', name: 'South' },
    ]);
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

  it('tells the owner where the sales were paid from, and keeps till money out of what TuTak owes', async () => {
    renderPage();
    expect(await screen.findByText('Where your sales were paid from')).toBeTruthy();
    expect(screen.getByText('Received at your till')).toBeTruthy();
    expect(screen.getByText('Paid from TuTak balances')).toBeTruthy();
    expect(screen.getByText('95,000.00')).toBeTruthy();
    expect(screen.getByText('20,000.00')).toBeTruthy();
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
    // Twice on purpose: the headline names the state in words and the tile
    // repeats it over the figure. The headline is the one that has to be
    // there — a partner should not have to read a minus sign to find out
    // which way the balance points.
    expect((await screen.findAllByText('You owe TuTak')).length).toBe(2);
    expect(screen.getByTestId('position-headline').textContent).toContain('You owe TuTak');
    // The figure is shown as a positive amount under a label that says the
    // direction. "−2,500.00" under "You owe TuTak" reads as a credit.
    expect(screen.getByText('2,500.00')).toBeTruthy();
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
  it('names the third state when nothing is outstanding either way', async () => {
    (settlementApi.position as jest.Mock).mockResolvedValue(
      positionFixture({
        accrued: '0',
        deductions: '0',
        net: '0',
        ledgerBalance: '0',
        inOpenSettlements: '0',
        underReview: '0',
      }),
    );
    renderPage();
    const headline = await screen.findByTestId('position-headline');
    expect(headline.textContent).toContain('You and TuTak are square');
    // Neither of the other two may be claimed at the same time.
    expect(headline.textContent).not.toContain('TuTak owes you');
    expect(headline.textContent).not.toContain('You owe TuTak');
  });

  it('does not name any state while the balance is still loading', async () => {
    let release: (value: UnsettledPositionDto) => void = () => {};
    (settlementApi.position as jest.Mock).mockImplementation(
      () => new Promise<UnsettledPositionDto>((resolve) => { release = resolve; }),
    );
    renderPage();
    // A headline before the figure arrives would be a claim about money
    // nobody has read yet.
    await waitFor(() => expect(screen.getByText('Settlements')).toBeTruthy());
    expect(screen.queryByTestId('position-headline')).toBeNull();
    release(positionFixture());
    expect(await screen.findByTestId('position-headline')).toBeTruthy();
  });

  it('gives each movement a date, a quotable number, the employee code and the change', async () => {
    renderPage();
    expect(await screen.findByText('Everything that moved your balance')).toBeTruthy();
    expect(await screen.findByText('2026-09-18')).toBeTruthy();
    expect(screen.getByText('5555AABB')).toBeTruthy();
    expect(screen.getByText('EMP-004')).toBeTruthy();
    // Twice: the shop filter lists it and the row names it.
    expect(screen.getAllByText('North').length).toBe(2);
    expect(screen.getByText('+5,000.00')).toBeTruthy();
    expect(screen.getByText('Bonus points a customer spent with you')).toBeTruthy();
  });

  it('says a provider or a till confirmed a sale rather than inventing a person', async () => {
    (settlementApi.activity as jest.Mock).mockResolvedValue(
      activityPage({
        rows: [
          activityRow({ employeeCode: null, confirmationSource: 'PROVIDER' }),
          activityRow({
            postingId: 'posting-2',
            employeeCode: null,
            confirmationSource: 'INTEGRATION',
          }),
          activityRow({ postingId: 'posting-3', employeeCode: null, confirmationSource: null }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText('Payment provider')).toBeTruthy();
    expect(screen.getByText('Your till integration')).toBeTruthy();
    // The row that predates the column names nobody at all.
    expect(screen.queryByText(/EMP-/)).toBeNull();
  });

  it('never calls a filtered subtotal the position of the business', async () => {
    (settlementApi.activity as jest.Mock).mockResolvedValue(
      activityPage({
        filtered: true,
        selection: { credits: '900.0000', debits: '0.0000', net: '900.0000', rowCount: 1 },
      }),
    );
    renderPage();
    expect(await screen.findByText('Total of the lines you selected')).toBeTruthy();
    expect(
      screen.getByText(/not what TuTak owes your business/i),
    ).toBeTruthy();
  });

  it('pages forward with the cursor the server issued, and back without one', async () => {
    (settlementApi.activity as jest.Mock).mockResolvedValue(
      activityPage({ nextCursor: 'CURSOR-2' }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(settlementApi.activity).toHaveBeenCalledWith(
        'partner-1',
        expect.objectContaining({ cursor: 'CURSOR-2' }),
      ),
    );
    // Back is the cursor stack unwinding, not a subtraction: the first page
    // is the one with no cursor at all, and it is already in hand, so going
    // back does not need another request.
    // Both buttons are disabled while the next page is in flight, so wait
    // for it to land before pressing Back.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true),
    );
    expect(screen.getByText('5555AABB')).toBeTruthy();
  });

  it('sends the chosen filter and resets to the first page when it changes', async () => {
    (settlementApi.activity as jest.Mock).mockResolvedValue(
      activityPage({ nextCursor: 'CURSOR-2' }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(settlementApi.activity).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText('Shop'), { target: { value: 'branch-2' } });
    fireEvent.change(screen.getByLabelText('Where the money is'), {
      target: { value: 'PAID' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(settlementApi.activity).toHaveBeenLastCalledWith(
        'partner-1',
        // A new filter with the old cursor would page into a list the
        // cursor was never a position in.
        expect.objectContaining({ branchId: 'branch-2', state: 'PAID', cursor: undefined }),
      ),
    );
  });

  it('opens one sale and says where its money stands, without the pool split', async () => {
    (settlementApi.purchaseBreakdown as jest.Mock).mockResolvedValue({
      purchaseIntentId: '11111111-2222-3333-4444-5555aabbccdd',
      confirmationCode: '0042',
      confirmedAt: '2026-09-18T09:30:00.000Z',
      status: 'CONFIRMED',
      branchId: 'branch-1',
      confirmationSource: 'STAFF',
      employeeCode: 'EMP-004',
      grossAmount: '10000.0000',
      bonusApplied: '1000.0000',
      prepaidApplied: '0.0000',
      externalAmount: '9000.0000',
      paymentRoute: 'DIRECT_PARTNER',
      externalCollectedBy: 'PARTNER_TILL',
      refundedAmount: '0.0000',
      refunds: [],
      lines: [
        {
          kind: 'partner.bonus_redemption_compensation',
          amount: '1000.0000',
          occurredAt: '2026-09-18T09:30:00.000Z',
          state: 'UNSETTLED',
          settlementId: null,
        },
      ],
      effectOnDebt: '1000.0000',
      stillOwed: '1000.0000',
      inOpenSettlement: '0.0000',
      paid: '0.0000',
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /where is this from/i }));

    expect(await screen.findByText('What it did to the debt')).toBeTruthy();
    expect(screen.getByText('Taken at your till')).toBeTruthy();
    expect(screen.getByText('Yours already')).toBeTruthy();
    expect(screen.getByText('Still owed to you')).toBeTruthy();
    // Twice now: once as a filter option in the list above, once as this
    // sale's own figure. Only the second one is being asserted here.
    expect(screen.getAllByText('Held by an unpaid settlement').length).toBe(2);
    // TuTak's own share and the referral legs are not this partner's
    // business, and are not in the server's answer either.
    expect(screen.queryByText(/referrer|pool|tutak share/i)).toBeNull();
  });

  it('shows a load error for the movements instead of an empty account', async () => {
    (settlementApi.activity as jest.Mock).mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByText('Your account could not be loaded')).toBeTruthy();
    expect(screen.queryByText('Nothing has moved on your account yet.')).toBeNull();
  });
  it('shows the whole life of a sale, not just who confirmed it', async () => {
    (settlementApi.purchaseBreakdown as jest.Mock).mockResolvedValue({
      purchaseIntentId: '11111111-2222-3333-4444-5555aabbccdd',
      confirmationCode: '0042',
      confirmedAt: '2026-09-18T09:30:00.000Z',
      status: 'CONFIRMED',
      branchId: 'branch-1',
      confirmationSource: 'STAFF',
      employeeCode: 'EMP-004',
      grossAmount: '10000.0000',
      bonusApplied: '1000.0000',
      prepaidApplied: '0.0000',
      externalAmount: '9000.0000',
      paymentRoute: 'DIRECT_PARTNER',
      externalCollectedBy: 'PARTNER_TILL',
      refundedAmount: '1000.0000',
      refunds: [],
      lines: [],
      effectOnDebt: '0.0000',
      stillOwed: '0.0000',
      inOpenSettlement: '0.0000',
      paid: '0.0000',
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /where is this from/i }));

    expect(await screen.findByText('What happened to this sale')).toBeTruthy();
    expect(await screen.findByText('Customer opened this purchase')).toBeTruthy();
    expect(screen.getByText('Purchase confirmed')).toBeTruthy();
    // "Refunded" also labels the amount refunded against the sale in the
    // panel above; this is the timeline's own entry.
    expect(screen.getAllByText('Refunded').length).toBeGreaterThanOrEqual(1);
    // The two staff facts read differently: one is what the row froze that
    // day, the other is the payroll as it stands now.
    expect(screen.getByText(/EMP-004 \(partner staff, as recorded then\)/)).toBeTruthy();
    expect(screen.getByText(/EMP-001 \(your staff today\)/)).toBeTruthy();
  });

  it('shows a gap in the record as a gap, never as a name', async () => {
    (purchaseIntentApi.history as jest.Mock).mockResolvedValue({
      purchaseIntentId: '11111111-2222-3333-4444-5555aabbccdd',
      reference: '5555AABB',
      status: 'CONFIRMED',
      events: [
        {
          type: 'CONFIRMED',
          at: '2026-09-18T09:30:00.000Z',
          actor: { kind: 'NOT_RECORDED' },
          detail: {},
        },
      ],
    });
    (settlementApi.purchaseBreakdown as jest.Mock).mockResolvedValue({
      purchaseIntentId: '11111111-2222-3333-4444-5555aabbccdd',
      confirmationCode: null,
      confirmedAt: '2026-09-18T09:30:00.000Z',
      status: 'CONFIRMED',
      branchId: null,
      confirmationSource: null,
      employeeCode: null,
      grossAmount: '10000.0000',
      bonusApplied: '0.0000',
      prepaidApplied: '0.0000',
      externalAmount: '10000.0000',
      paymentRoute: 'DIRECT_PARTNER',
      externalCollectedBy: 'PARTNER_TILL',
      refundedAmount: '0.0000',
      refunds: [],
      lines: [],
      effectOnDebt: '0.0000',
      stillOwed: '0.0000',
      inOpenSettlement: '0.0000',
      paid: '0.0000',
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /where is this from/i }));

    const confirmed = await screen.findByText(/Purchase confirmed/);
    expect(screen.getAllByText(/Not recorded/).length).toBeGreaterThan(0);
    // Scoped to the timeline row: the activity table above has its own
    // rows with their own codes, and this assertion is about the sale whose
    // actor was never recorded.
    const line = confirmed.closest('li')!;
    expect(line.textContent).toContain('Not recorded');
    expect(line.textContent).not.toContain('EMP-');
  });
  it('offers the report control on a bounced transfer too', async () => {
    (settlementApi.statements as jest.Mock).mockResolvedValue([
      statementFixture({
        status: PartnerSettlementStatus.FAILED,
        paidAt: null,
        failedReason: 'Beneficiary account closed',
      }),
    ]);
    renderPage();
    // A bank can report a transfer as bounced and still have moved the
    // money. That is exactly the case worth hearing about, and the server
    // accepts a report here.
    expect(await screen.findByRole('button', { name: /report a problem/i })).toBeTruthy();
  });

  it('says the report changes nothing about what is owed', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /report a problem/i }));
    expect(
      screen.getByText(/does not change this settlement or what you are\s+owed/i),
    ).toBeTruthy();
  });
});
