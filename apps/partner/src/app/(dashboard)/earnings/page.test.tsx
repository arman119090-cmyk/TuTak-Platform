import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import EarningsPage from './page';
import { financeApi } from '@/lib/api/financeApi';
import { useAuthStore } from '@/lib/stores/authStore';

/**
 * The "Daily settlements" table used to read exclusively from the legacy
 * card-payment `Settlement` model, which stays empty for every partner
 * running only the live QR/PurchaseIntent flow — `CARD_PAYMENTS_ENABLED`
 * stays off in production (docs/LAUNCH_READINESS_2026-08-16.md). A QR-only partner saw
 * "Nothing settled yet" while real commission/discount activity was
 * happening under them. What matters here is that the new "QR purchase
 * activity" table renders real numbers from `financeApi.dailyActivity`
 * regardless of whether `settlements` has any rows, and that the legacy
 * table only appears when it actually has something to say.
 */

jest.mock('@/lib/api/financeApi', () => ({
  financeApi: {
    balance: jest.fn(),
    settlements: jest.fn(),
    payouts: jest.fn(),
    collections: jest.fn(),
    dailyActivity: jest.fn(),
  },
}));

const mockedFinance = financeApi as jest.Mocked<typeof financeApi>;

function buildUser(overrides: Partial<AuthenticatedUserDto> = {}): AuthenticatedUserDto {
  return {
    id: 'partner-user-1',
    phone: '+37400000002',
    email: null,
    firstName: 'Owner',
    lastName: 'User',
    roles: [Role.PARTNER_OWNER],
    partnerScopes: { PARTNER_OWNER: ['partner-1'] },
    locale: 'hy',
    isPhoneVerified: true,
    avatar: null,
    showAvatarInReferralList: false,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EarningsPage />
    </QueryClientProvider>,
  );
}

describe('EarningsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ user: buildUser() });
    mockedFinance.balance.mockResolvedValue({ availableBalance: '3800.00', currency: 'AMD' });
    mockedFinance.settlements.mockResolvedValue([]);
    mockedFinance.payouts.mockResolvedValue([]);
    mockedFinance.collections.mockResolvedValue([]);
    mockedFinance.dailyActivity.mockResolvedValue([]);
  });

  it('shows real QR purchase activity instead of "nothing settled yet"', async () => {
    mockedFinance.dailyActivity.mockResolvedValue([
      {
        periodStart: '2026-08-20T00:00:00.000Z',
        grossAmount: '12000.0000',
        discountGivenAmount: '5000.0000',
        commissionOwedAmount: '1200.0000',
        netAmount: '3800.0000',
        purchaseCount: 1,
      },
    ]);

    renderPage();

    expect(await screen.findByText('2026-08-20')).toBeTruthy();
    expect(screen.queryByText('No purchases yet')).toBeNull();
    // Doc §2's worked example, verbatim: 5,000 discount − 1,200 commission = 3,800 net.
    expect(screen.getByText('5,000.00')).toBeTruthy();
    expect(screen.getByText('1,200.00')).toBeTruthy();
    expect(screen.getByText('3,800.00')).toBeTruthy();
  });

  it('hides the legacy card-settlement table when there is nothing in it', async () => {
    renderPage();

    await waitFor(() => expect(mockedFinance.settlements).toHaveBeenCalled());
    expect(screen.queryByText('Daily settlements (card payments)')).toBeNull();
  });

  it('still shows the legacy card-settlement table for a partner who has real rows there', async () => {
    mockedFinance.settlements.mockResolvedValue([
      {
        id: 'settlement-1',
        periodStart: '2026-08-19T00:00:00.000Z',
        periodEnd: '2026-08-20T00:00:00.000Z',
        grossAmount: '4000.0000',
        commissionAmount: '400.0000',
        netAmount: '3600.0000',
        bonusAccrued: '80.0000',
        paymentCount: 2,
      },
    ]);

    renderPage();

    expect(await screen.findByText('Daily settlements (card payments)')).toBeTruthy();
  });

  it("shows this partner's own collections, not just payouts", async () => {
    mockedFinance.collections.mockResolvedValue([
      { id: 'collection-1', amount: '1200.00', bankReference: 'SWIFT-1', createdAt: '2026-08-21T00:00:00.000Z' },
    ]);

    renderPage();

    expect(await screen.findByText('SWIFT-1')).toBeTruthy();
    expect(screen.queryByText('No collections yet')).toBeNull();
  });
});
