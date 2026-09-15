import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import SettlementsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { settlementApi, type PartnerSettlementRow } from '@/lib/api/financeApi';

/**
 * A partner reads their own money and cannot move it.
 *
 * The assertions worth having here are about what is *absent*: no control
 * that lets the payee declare a transfer arrived or missing, and no dispute
 * button on a settlement still being assembled. A screen that offers a
 * control the server answers 403 to teaches people the app is broken.
 */

jest.mock('@/lib/api/financeApi', () => ({
  settlementApi: { statements: jest.fn(), position: jest.fn(), reportProblem: jest.fn() },
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

function statementFixture(overrides: Partial<PartnerSettlementRow> = {}): PartnerSettlementRow {
  return {
    id: 'settlement-1',
    partnerId: 'partner-1',
    status: 'PAID',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-15T00:00:00.000Z',
    accruedAmount: '20000.0000',
    deductionAmount: '1500.0000',
    netPayableAmount: '18500.0000',
    currency: 'AMD',
    bankTransferReference: 'TRF-77',
    createdByUserId: 'admin-1',
    approvedByUserId: 'admin-2',
    paidAt: '2026-09-15T10:00:00.000Z',
    createdAt: '2026-09-15T09:00:00.000Z',
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
    (settlementApi.position as jest.Mock).mockResolvedValue({
      partnerId: 'partner-1',
      accrued: '5000.0000',
      deductions: '250.0000',
      net: '4750.0000',
      entries: [],
      unrecognised: [],
    });
    (settlementApi.reportProblem as jest.Mock).mockResolvedValue(statementFixture());
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
    expect(await screen.findByText('4,750.00')).toBeTruthy();
  });

  it('shows a paid statement with its transfer reference', async () => {
    renderPage();
    expect(await screen.findByText('TRF-77')).toBeTruthy();
    expect(screen.getByText('18,500.00')).toBeTruthy();
  });

  /**
   * A bounced transfer does not change what is owed — the entries stay
   * claimed and another transfer may be made against the same figure. The
   * wording has to say so, or a partner reads FAILED as "my money is gone".
   */
  it('tells a partner a bounced transfer is still owed', async () => {
    (settlementApi.statements as jest.Mock).mockResolvedValue([
      statementFixture({ status: 'FAILED', paidAt: null }),
    ]);
    renderPage();
    expect(await screen.findByText(/still owed/i)).toBeTruthy();
  });

  it('offers no dispute on a settlement still being assembled', async () => {
    (settlementApi.statements as jest.Mock).mockResolvedValue([
      statementFixture({ status: 'DRAFT', paidAt: null, bankTransferReference: null }),
    ]);
    renderPage();
    await screen.findByText(/being prepared/i);
    expect(screen.queryByRole('button', { name: /report a problem/i })).toBeNull();
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

  it('surfaces unclassified activity rather than quietly excluding it', async () => {
    (settlementApi.position as jest.Mock).mockResolvedValue({
      partnerId: 'partner-1',
      accrued: '0',
      deductions: '0',
      net: '0',
      entries: [],
      unrecognised: ['some.new.kind'],
    });
    renderPage();
    expect(await screen.findByText(/some\.new\.kind/)).toBeTruthy();
  });
});
