import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import OverviewPage from './page';
import { partnerApi } from '@/lib/api/partnerApi';
import { useAuthStore } from '@/lib/stores/authStore';

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: { get: jest.fn(), analytics: jest.fn() },
}));

const api = partnerApi as jest.Mocked<typeof partnerApi>;

function signIn(role: Role) {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      phone: '+37400000004',
      email: null,
      firstName: 'Partner',
      lastName: 'Person',
      roles: [role],
      partnerScopes: { [role]: ['partner-1'] } as AuthenticatedUserDto['partnerScopes'],
      locale: 'en',
      isPhoneVerified: true,
      avatar: null,
      showAvatarInReferralList: false,
      personalizedRecommendationsEnabled: false,
      mustChangePassword: false,
    },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OverviewPage />
    </QueryClientProvider>,
  );
}

const partner = {
  id: 'partner-1',
  displayName: 'Café Ararat',
  category: 'restaurant',
  bonusAccrualRateBps: 500,
  isActive: true,
};

describe('OverviewPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockResolvedValue(partner as never);
  });

  it('tells a cashier the figures are not theirs instead of showing a business with zero sales', async () => {
    signIn(Role.PARTNER_STAFF);
    api.analytics.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { response: { status: 403 } }),
    );
    renderPage();

    expect(
      await screen.findByText(/Sales figures for the whole business are for the owner/),
    ).toBeTruthy();
    expect(screen.queryByText('0 ֏')).toBeNull();
  });

  it('shows a dash, not zero, while the figures are on their way', async () => {
    signIn(Role.PARTNER_OWNER);
    api.analytics.mockReturnValue(new Promise(() => undefined));
    renderPage();

    expect(await screen.findByText('Restaurants')).toBeTruthy();
    expect(screen.queryByText('0 ֏')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the owner the real figures and the category in words', async () => {
    signIn(Role.PARTNER_OWNER);
    api.analytics.mockResolvedValue({
      netRevenue: '9000',
      totalRevenue: '10000',
      totalRefunded: '1000',
      totalTransactions: 12,
      uniqueCustomers: 7,
      totalBonusIssued: '500',
      totalBonusRedeemed: '200',
    } as never);
    renderPage();

    expect(await screen.findByText('9 000 ֏')).toBeTruthy();
    expect(screen.getByText('Restaurants')).toBeTruthy();
  });
});
